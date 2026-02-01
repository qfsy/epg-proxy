// 文件路径: src/js/logic.js
/**
 * 核心业务逻辑模块
 * 处理 EPG 下载、流式传输、缓存以及 DIYP 接口逻辑
 * [v2.9 配置增强] 支持通过环境变量配置核心参数 (超时、缓存大小、熔断时间等)
 * [v3.0 状态增强] 导出数据源更新时间供前端显示
 * [v3.1 修复] 即使请求失败也记录最后尝试时间，以便前端展示状态
 * [v3.2 优化] 利用 Cache API 持久化更新时间，解决 Worker 切换导致的显示闪烁
 */

import { smartFind, isGzipContent } from './utils.js';

// --- 默认配置常量 (当环境变量未设置时生效) ---
const DEFAULT_CACHE_TTL = 3600;           // 默认缓存 1 小时
const DEFAULT_FETCH_TIMEOUT = 20000;      // 默认请求超时 20 秒
const DEFAULT_MAX_MEMORY_CACHE = 40 * 1024 * 1024; // 默认内存缓存 40M 字符 (约80MB)
const DEFAULT_MAX_SOURCE_SIZE = 150 * 1024 * 1024; // 默认最大源文件 150MB
const DEFAULT_ERROR_COOLDOWN = 2 * 60 * 1000;      // 默认熔断冷却 2 分钟

// [全局内存缓存]
// Key: Source URL
// Value: { text, expireTime, fetchTime, lastErrorTime, errorMsg }
const MEMORY_CACHE_MAP = new Map();

// [并发优化] 进行中的请求队列
const PENDING_REQUESTS = new Map();

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// =========================================================
// 1. 数据源获取 (底层网络层)
// =========================================================

export async function getSourceStream(ctx, targetUrl, env) {
  // 读取环境变量配置
  const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
  const fetchTimeout = parseInt(env.FETCH_TIMEOUT) || DEFAULT_FETCH_TIMEOUT;
  const maxSourceSize = parseInt(env.MAX_SOURCE_SIZE_BYTES) || DEFAULT_MAX_SOURCE_SIZE;

  const cache = (typeof caches !== 'undefined') ? caches.default : null;
  const cacheKey = new Request(targetUrl, { method: "GET" });
  
  if (cache) {
    let cachedRes = await cache.match(cacheKey);
    if (cachedRes) {
      return {
        stream: cachedRes.body,
        headers: cachedRes.headers,
        isGzip: isGzipContent(cachedRes.headers, targetUrl)
      };
    }
  }

  console.log(`[Network] Fetch start: ${targetUrl}`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

  try {
    const originRes = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!originRes.ok) throw new Error(`Status ${originRes.status}`);

    const contentLength = originRes.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > maxSourceSize) {
        throw new Error(`Too large (${contentLength} bytes)`);
    }

    if (cache) {
      const [streamForCache, streamForUse] = originRes.body.tee();
      const responseToCache = new Response(streamForCache, {
        headers: originRes.headers,
        status: originRes.status,
        statusText: originRes.statusText
      });
      responseToCache.headers.set("Cache-Control", `public, max-age=${cacheTtl}`);
      
      // [v3.2] 将更新时间写入缓存头，实现跨实例持久化
      responseToCache.headers.set("X-EPG-Fetch-Time", Date.now().toString());

      ctx.waitUntil(cache.put(cacheKey, responseToCache));

      return {
        stream: streamForUse,
        headers: originRes.headers,
        isGzip: isGzipContent(originRes.headers, targetUrl)
      };
    } else {
      return {
        stream: originRes.body,
        headers: originRes.headers,
        isGzip: isGzipContent(originRes.headers, targetUrl)
      };
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
        throw new Error(`Timeout (${fetchTimeout}ms)`);
    }
    throw err;
  }
}

// =========================================================
// 2. 文件下载处理 (XML/GZ)
// =========================================================

export async function handleDownload(ctx, targetFormat, sourceUrl, env) {
  try {
    const source = await getSourceStream(ctx, sourceUrl, env);
    const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
    
    let finalStream = source.stream;
    let contentType = "";

    if (targetFormat === 'xml') {
      contentType = "application/xml; charset=utf-8";
      if (source.isGzip) {
        finalStream = finalStream.pipeThrough(new DecompressionStream('gzip'));
      }
    } else if (targetFormat === 'gz') {
      contentType = "application/gzip";
      if (!source.isGzip) {
        finalStream = finalStream.pipeThrough(new CompressionStream('gzip'));
      }
    }

    return new Response(finalStream, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${cacheTtl}`,
        ...CORS_HEADERS
      }
    });
  } catch (e) {
    return new Response(`Download Error: ${e.message}`, { status: 502, headers: CORS_HEADERS });
  }
}

// =========================================================
// 3. DIYP / 超级直播 接口处理
// =========================================================

export async function handleDiyp(request, url, ctx, env) {
  const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
  const cache = (typeof caches !== 'undefined') ? caches.default : null;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  
  if (cache) {
    let cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
  }

  const ch = url.searchParams.get('ch') || url.searchParams.get('channel') || url.searchParams.get('id');
  const date = url.searchParams.get('date');
  const currentPath = url.pathname; 

  if (!ch || !date) {
    return new Response(JSON.stringify({ code: 400, message: "Missing params: ch (or channel/id) or date" }), {
      headers: { 'content-type': 'application/json', ...CORS_HEADERS }
    });
  }

  // 获取数据 (包含容灾逻辑)
  let result = await fetchAndFind(ctx, env.EPG_URL, ch, date, url.origin, env, currentPath);

  // 备用源逻辑
  if (result.programs.length === 0 && env.EPG_URL_BACKUP) {
    console.log(`Primary source empty/failed, trying backup...`);
    const backupResult = await fetchAndFind(ctx, env.EPG_URL_BACKUP, ch, date, url.origin, env, currentPath);
    if (backupResult.programs.length > 0) {
      result = backupResult;
    }
  }

  let finalResponse;
  if (result.programs.length === 0) {
    finalResponse = new Response(JSON.stringify({ 
      code: 404, 
      message: "No programs found",
      debug_info: { channel: ch, date: date }
    }), {
      headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
      status: 404
    });
  } else {
    finalResponse = new Response(JSON.stringify(result.response), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${cacheTtl}`,
        ...CORS_HEADERS
      }
    });

    if (cache) {
      ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
    }
  }

  return finalResponse;
}

/**
 * 核心并发与容灾逻辑
 */
async function fetchAndFind(ctx, sourceUrl, ch, date, originUrl, env, currentPath) {
  // 读取环境变量配置
  const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
  const errorCooldown = parseInt(env.ERROR_COOLDOWN_MS) || DEFAULT_ERROR_COOLDOWN;
  const maxMemoryCache = parseInt(env.MAX_MEMORY_CACHE_CHARS) || DEFAULT_MAX_MEMORY_CACHE;
  
  const now = Date.now();
  let cachedItem = MEMORY_CACHE_MAP.get(sourceUrl);

  // --- 阶段 A: 检查冷却期 ---
  if (cachedItem && cachedItem.lastErrorTime) {
    const elapsed = now - cachedItem.lastErrorTime;
    if (elapsed < errorCooldown) {
      console.warn(`[Circuit Breaker] Source in cooldown (${Math.floor(elapsed/1000)}s / ${errorCooldown/1000}s).`);
      // 如果有旧文本，即使在冷却期也尝试用旧的匹配
      if (cachedItem.text) {
          return smartFind(cachedItem.text, ch, date, originUrl, currentPath);
      }
      return { programs: [], response: {} };
    }
  }

  // --- 阶段 B: 检查有效缓存 ---
  if (cachedItem && cachedItem.text && now < cachedItem.expireTime) {
    return smartFind(cachedItem.text, ch, date, originUrl, currentPath);
  }

  // --- 阶段 C: 准备更新 (请求合并) ---
  if (PENDING_REQUESTS.has(sourceUrl)) {
    try {
        const xmlText = await PENDING_REQUESTS.get(sourceUrl);
        return smartFind(xmlText, ch, date, originUrl, currentPath);
    } catch (e) {
        PENDING_REQUESTS.delete(sourceUrl);
    }
  }

  // --- 阶段 D: 发起网络请求 ---
  const fetchPromise = (async () => {
    try {
        const source = await getSourceStream(ctx, sourceUrl, env);
        let stream = source.stream;
        if (source.isGzip) {
          stream = stream.pipeThrough(new DecompressionStream('gzip'));
        }
        return await new Response(stream).text();
    } catch (e) {
        throw e;
    }
  })();

  PENDING_REQUESTS.set(sourceUrl, fetchPromise);

  try {
    const xmlText = await fetchPromise;
    
    // 写入内存缓存
    if (xmlText.length < maxMemoryCache) {
        if (MEMORY_CACHE_MAP.size >= 5 && !MEMORY_CACHE_MAP.has(sourceUrl)) {
            const firstKey = MEMORY_CACHE_MAP.keys().next().value;
            MEMORY_CACHE_MAP.delete(firstKey);
        }
        
        MEMORY_CACHE_MAP.set(sourceUrl, {
            text: xmlText,
            expireTime: now + (cacheTtl * 1000),
            fetchTime: now,
            lastErrorTime: 0,
            errorMsg: null // 成功清除错误
        });
        console.log(`[Memory] Updated ${xmlText.length} chars. TTL: ${cacheTtl}s`);
    }

    return smartFind(xmlText, ch, date, originUrl, currentPath);

  } catch (e) {
    console.error(`[Fetch Failed] Source: ${sourceUrl}, Error: ${e.message}`);
    
    // --- [v3.1 修复] 记录失败状态到内存 ---
    // 即使失败，也更新 Map，以便首页能显示 "更新失败: Timeout"
    const existing = MEMORY_CACHE_MAP.get(sourceUrl) || {};
    MEMORY_CACHE_MAP.set(sourceUrl, {
        ...existing,
        lastErrorTime: now,
        fetchTime: now, // 记录这次尝试的时间
        errorMsg: e.message
    });
    
    // --- 阶段 E: 失败兜底逻辑 ---
    if (existing && existing.text) {
        console.warn(`[Stale-If-Error] Serving EXPIRED data.`);
        return smartFind(existing.text, ch, date, originUrl, currentPath);
    }

    return { programs: [], response: {} };
  } finally {
    PENDING_REQUESTS.delete(sourceUrl);
  }
}

/**
 * 获取数据源最后更新时间 (v3.2 优化：RAM + Cache 双重检查)
 * 供前端展示使用，优先读取内存，内存缺失时尝试读取缓存头
 */
export async function getLastUpdateTimes(env) {
  const mainUrl = env.EPG_URL;
  const backupUrl = env.EPG_URL_BACKUP;
  const cache = (typeof caches !== 'undefined') ? caches.default : null;

  // 格式化时间戳为北京时间 (MM-DD HH:mm:ss)
  const formatTime = (ts) => {
    if (!ts) return "等待更新";
    const date = new Date(ts);
    return date.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
  };

  const getStatus = async (url) => {
     if (!url) return null;
     
     // 1. 优先检查内存 (RAM)
     // 内存中的数据最准确，包含最新的错误信息
     const item = MEMORY_CACHE_MAP.get(url);
     if (item) {
         const timeStr = formatTime(item.fetchTime);
         if (item.errorMsg) {
             return `${timeStr} <span style="color:red;font-size:0.8em">(${item.errorMsg})</span>`;
         }
         return `${timeStr} <span style="color:green;font-size:0.8em">(RAM)</span>`;
     }

     // 2. 内存没有，检查 Cache API (持久层)
     // 如果当前是新启动的 Worker 实例，尝试从 Cloudflare 缓存头中恢复上次更新时间
     if (cache) {
         try {
             const cachedRes = await cache.match(new Request(url, { method: "GET" }));
             if (cachedRes) {
                 const ts = cachedRes.headers.get("X-EPG-Fetch-Time");
                 if (ts) {
                     // 只有成功的请求才会写入缓存头，所以这里必然是成功的
                     return `${formatTime(parseInt(ts))} <span style="color:green;font-size:0.8em">(Cache)</span>`;
                 }
             }
         } catch (e) {
             // 忽略缓存读取错误
         }
     }
     
     return "等待调用";
  };

  return {
    main: await getStatus(mainUrl),
    backup: await getStatus(backupUrl)
  };
}