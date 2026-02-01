/**
 * 核心业务逻辑模块
 * 处理 EPG 下载、流式传输、缓存以及 DIYP 接口逻辑
 * [v2.8 容灾增强] 新增 Stale-If-Error 兜底策略与错误冷却熔断机制
 */

import { smartFind, isGzipContent } from './utils.js';

// 基础配置
const DEFAULT_CACHE_TTL = 3600; // 缓存有效期 1 小时
const FETCH_TIMEOUT = 20000;    // 网络请求超时 20 秒
const MAX_MEMORY_CACHE_CHARS = 40 * 1024 * 1024; // 内存缓存上限 (字符数)
const MAX_SOURCE_SIZE_BYTES = 150 * 1024 * 1024; // 源文件体积上限 (字节)

// [容灾配置 v2.8]
// 当源站请求失败时，进入"冷却期"，在此期间直接返回过期数据，不再尝试请求源站
// 初始冷却 2 分钟，避免在源站维护期间(0:00-0:30)频繁打扰
const ERROR_COOLDOWN_MS = 2 * 60 * 1000; 

// [全局内存缓存]
// Key: Source URL
// Value: { 
//    text: string,       // XML 内容
//    expireTime: number, // 过期时间戳 (用于判断是否需要更新)
//    fetchTime: number,  // 数据获取时间戳 (用于 Debug)
//    lastErrorTime: number // 上次请求失败的时间戳 (用于熔断冷却)
// }
const MEMORY_CACHE_MAP = new Map();

// [并发优化] 进行中的请求队列 (请求合并)
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
  // 注意：handleDownload 仍使用此函数，下载接口不走 stale-if-error，因为下载需要原样透传
  const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
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
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const originRes = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!originRes.ok) throw new Error(`Source fetch failed: ${originRes.status}`);

    const contentLength = originRes.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_SOURCE_SIZE_BYTES) {
        throw new Error(`Source too large (${contentLength} bytes), limit is ${MAX_SOURCE_SIZE_BYTES}`);
    }

    if (cache) {
      const [streamForCache, streamForUse] = originRes.body.tee();
      const responseToCache = new Response(streamForCache, {
        headers: originRes.headers,
        status: originRes.status,
        statusText: originRes.statusText
      });
      responseToCache.headers.set("Cache-Control", `public, max-age=${cacheTtl}`);
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
        throw new Error(`Source fetch timed out after ${FETCH_TIMEOUT}ms`);
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

  // 如果主源完全没数据（连过期缓存都没有），且配置了备用源，则尝试备用源
  if (result.programs.length === 0 && env.EPG_URL_BACKUP) {
    // 只有当 result 是真正的“空”而不是“未找到频道”时才切换，这里简化为只要没节目就切
    console.log(`Primary source empty/failed, trying backup...`);
    const backupResult = await fetchAndFind(ctx, env.EPG_URL_BACKUP, ch, date, url.origin, env, currentPath);
    if (backupResult.programs.length > 0) {
      result = backupResult;
    }
  }

  let finalResponse;
  // 如果还是空，说明真的挂了
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
    // 构造成功响应
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
 * 核心并发与容灾逻辑 (v2.8)
 * 策略：
 * 1. 内存有未过期数据 -> 直接返回
 * 2. 内存有过期数据 + 处于冷却期 -> 返回过期数据 (Stale)
 * 3. 内存无数据/可更新 -> 发起网络请求
 * a. 成功 -> 更新缓存，返回新数据
 * b. 失败 + 内存有过期数据 -> 进入冷却期，返回过期数据 (兜底)
 * c. 失败 + 内存无数据 -> 抛出异常/返回空
 */
async function fetchAndFind(ctx, sourceUrl, ch, date, originUrl, env, currentPath) {
  const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
  const now = Date.now();
  
  // 获取当前缓存状态
  let cachedItem = MEMORY_CACHE_MAP.get(sourceUrl);

  // --- 阶段 A: 检查冷却期 (Circuit Breaker) ---
  if (cachedItem && cachedItem.lastErrorTime) {
    const elapsed = now - cachedItem.lastErrorTime;
    if (elapsed < ERROR_COOLDOWN_MS) {
      console.warn(`[Circuit Breaker] Source in cooldown (${Math.floor(elapsed/1000)}s / ${ERROR_COOLDOWN_MS/1000}s). Returning STALE data.`);
      // 这里的 cachedItem.text 可能是很久以前的，但在冷却期内我们信任它
      return smartFind(cachedItem.text, ch, date, originUrl, currentPath);
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
        console.error("Pending request failed, retrying...");
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
    
    // 更新成功：清除错误标记，更新内容
    if (xmlText.length < MAX_MEMORY_CACHE_CHARS) {
        if (MEMORY_CACHE_MAP.size >= 5 && !MEMORY_CACHE_MAP.has(sourceUrl)) {
            const firstKey = MEMORY_CACHE_MAP.keys().next().value;
            MEMORY_CACHE_MAP.delete(firstKey);
        }
        
        MEMORY_CACHE_MAP.set(sourceUrl, {
            text: xmlText,
            expireTime: now + (cacheTtl * 1000),
            fetchTime: now,
            lastErrorTime: 0 // 重置错误时间
        });
        console.log(`[Memory] Updated ${xmlText.length} chars. TTL: ${cacheTtl}s`);
    }

    return smartFind(xmlText, ch, date, originUrl, currentPath);

  } catch (e) {
    console.error(`[Fetch Failed] Source: ${sourceUrl}, Error: ${e.message}`);
    
    // --- 阶段 E: 失败兜底逻辑 (Stale-If-Error) ---
    if (cachedItem && cachedItem.text) {
        console.warn(`[Stale-If-Error] Serving EXPIRED data due to fetch failure.`);
        
        // 更新错误时间，触发冷却机制
        // 注意：保留原有的 text 和 expireTime，只更新 lastErrorTime
        cachedItem.lastErrorTime = now;
        MEMORY_CACHE_MAP.set(sourceUrl, cachedItem);
        
        return smartFind(cachedItem.text, ch, date, originUrl, currentPath);
    }

    // 如果连老数据都没有，那就真的没办法了
    return { programs: [], response: {} };
  } finally {
    PENDING_REQUESTS.delete(sourceUrl);
  }
}