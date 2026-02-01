/**
 * 核心业务逻辑模块
 * 处理 EPG 下载、流式传输、缓存以及 DIYP 接口逻辑
 * [v2.7 性能重构] 大幅提升缓存阈值，实现请求合并，彻底解决大文件解析慢的问题
 */

import { smartFind, isGzipContent } from './utils.js';

// [性能优化] 默认缓存时间调整为 1 小时 (3600秒)
// EPG 数据通常每天仅更新 1-2 次，5分钟的缓存太短且浪费资源
const DEFAULT_CACHE_TTL = 3600; 
const FETCH_TIMEOUT = 20000;   // 上游请求超时时间 20秒

// [性能优化] 内存缓存最大字符数阈值提升至 4000万
// 40,000,000 字符 ≈ 80MB 内存占用
// 这足以覆盖绝大多数包含7天回看的超大 EPG XML 文件
const MAX_MEMORY_CACHE_CHARS = 40 * 1024 * 1024;

// [安全配置] 最大允许下载的源文件大小 (字节) - 约 150MB
// 针对 Gzip 压缩文件，150MB 压缩包解压后可能极大，需设防
const MAX_SOURCE_SIZE_BYTES = 150 * 1024 * 1024;

// [全局内存缓存]
// Key: Source URL, Value: { text: string, expireTime: number }
const MEMORY_CACHE_MAP = new Map();

// [并发优化] 进行中的请求队列 (请求合并/Request Coalescing)
// 防止多人同时请求同一个未缓存的源时，触发多次下载造成 CPU 爆炸
// Key: Source URL, Value: Promise<ParsedData>
const PENDING_REQUESTS = new Map();

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// =========================================================
// 1. 数据源获取与缓存
// =========================================================

export async function getSourceStream(ctx, targetUrl, env) {
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
      // 写入 Cache API (磁盘/边缘缓存)
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
  
  // 1. 优先检查 API 结果缓存 (极速返回)
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

  // 2. 智能获取数据 (内存 -> 合并请求 -> 网络)
  // 即使100个人同时请求不同频道，只要源是同一个，fetchAndFind 内部会处理并发
  let result = await fetchAndFind(ctx, env.EPG_URL, ch, date, url.origin, env, currentPath);

  // 备用源逻辑
  if (result.programs.length === 0 && env.EPG_URL_BACKUP) {
    console.log(`Primary source empty for ${ch}, trying backup...`);
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
 * 核心并发控制逻辑
 * 实现了：内存缓存优先 -> 请求合并 -> 网络下载
 */
async function fetchAndFind(ctx, sourceUrl, ch, date, originUrl, env, currentPath) {
  const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
  const now = Date.now();

  // --- 阶段 A: 极速内存缓存 (微秒级) ---
  if (MEMORY_CACHE_MAP.has(sourceUrl)) {
    const cachedItem = MEMORY_CACHE_MAP.get(sourceUrl);
    // 检查是否过期
    if (cachedItem.text && now < cachedItem.expireTime) {
      // console.log(`[Memory] Hit for ${sourceUrl}`);
      return smartFind(cachedItem.text, ch, date, originUrl, currentPath);
    } else {
      console.log(`[Memory] Expired for ${sourceUrl}`);
      MEMORY_CACHE_MAP.delete(sourceUrl);
    }
  }

  // --- 阶段 B: 请求合并 (Request Coalescing) ---
  // 如果当前已经有一个请求正在下载该 URL，后续请求直接等待结果，不重复发起 fetch
  if (PENDING_REQUESTS.has(sourceUrl)) {
    // console.log(`[Coalescing] Waiting for pending fetch: ${sourceUrl}`);
    try {
        const xmlText = await PENDING_REQUESTS.get(sourceUrl);
        return smartFind(xmlText, ch, date, originUrl, currentPath);
    } catch (e) {
        // 如果等待的请求失败了，这里会捕获到，下面会尝试重新发起
        console.error("Pending request failed, retrying...");
        PENDING_REQUESTS.delete(sourceUrl);
    }
  }

  // --- 阶段 C: 真实网络请求与解析 ---
  // 创建 Promise 并存入 Map，锁住后续请求
  const fetchPromise = (async () => {
    try {
        const source = await getSourceStream(ctx, sourceUrl, env);
        let stream = source.stream;
        
        if (source.isGzip) {
          stream = stream.pipeThrough(new DecompressionStream('gzip'));
        }

        // 耗时操作：解压并转为字符串
        const text = await new Response(stream).text();
        return text;
    } catch (e) {
        throw e;
    }
  })();

  // 存入队列
  PENDING_REQUESTS.set(sourceUrl, fetchPromise);

  try {
    const xmlText = await fetchPromise;
    
    // --- 阶段 D: 写入内存缓存 ---
    // 只有在成功获取后才写入
    if (xmlText.length < MAX_MEMORY_CACHE_CHARS) {
        // 简单 LRU 策略：如果缓存满了 (例如缓存了5个大源)，删掉最早的
        if (MEMORY_CACHE_MAP.size >= 5) {
            const firstKey = MEMORY_CACHE_MAP.keys().next().value;
            MEMORY_CACHE_MAP.delete(firstKey);
        }
        
        MEMORY_CACHE_MAP.set(sourceUrl, {
            text: xmlText,
            expireTime: now + (cacheTtl * 1000)
        });
        console.log(`[Memory] Stored ${xmlText.length} chars. TTL: ${cacheTtl}s`);
    } else {
        console.warn(`[Memory] Skip: Too large (${xmlText.length} > ${MAX_MEMORY_CACHE_CHARS})`);
    }

    return smartFind(xmlText, ch, date, originUrl, currentPath);
  } catch (e) {
    console.error(`Error processing source ${sourceUrl}:`, e.message);
    return { programs: [], response: {} };
  } finally {
    // 无论成功失败，请求结束都必须移除 Pending 锁
    PENDING_REQUESTS.delete(sourceUrl);
  }
}