/**
 * 核心业务逻辑模块
 * 处理 EPG 下载、流式传输、缓存以及 DIYP 接口逻辑
 * [v2.4 优化] 增加网络请求超时控制 (Timeout) 和 Content-Length 预检，防止 OOM
 */

import { smartFind, isGzipContent } from './utils.js';

const DEFAULT_CACHE_TTL = 300; // 默认缓存 5 分钟
const FETCH_TIMEOUT = 15000;   // [新增] 上游请求超时时间 15秒

// [安全配置] 内存缓存最大字符数阈值
const MAX_MEMORY_CACHE_CHARS = 10 * 1024 * 1024;
// [新增] 最大允许下载的源文件大小 (字节) - 约 60MB
// 防止下载超大文件导致 Worker 直接 OOM 崩溃
const MAX_SOURCE_SIZE_BYTES = 60 * 1024 * 1024;

// [全局内存缓存]
// Key: Source URL, Value: { text: string, expireTime: number }
const MEMORY_CACHE_MAP = new Map();

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

  console.log(`Fetch start: ${targetUrl}`);
  
  // [优化] 使用带超时的 fetch
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const originRes = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeoutId); // 请求成功，清除定时器

    if (!originRes.ok) throw new Error(`Source fetch failed: ${originRes.status}`);

    // [优化] 预检 Content-Length (如果存在)
    const contentLength = originRes.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_SOURCE_SIZE_BYTES) {
        throw new Error(`Source too large (${contentLength} bytes), limit is ${MAX_SOURCE_SIZE_BYTES}`);
    }

    // 处理缓存流逻辑
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

  let result = await fetchAndFind(ctx, env.EPG_URL, ch, date, url.origin, env, currentPath);

  if (result.programs.length === 0 && env.EPG_URL_BACKUP) {
    console.log(`Primary source failed/empty for ${ch}, trying backup...`);
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

// 内部辅助：获取流 -> 解压 -> 解析
async function fetchAndFind(ctx, sourceUrl, ch, date, originUrl, env, currentPath) {
  try {
    const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
    const now = Date.now();

    // 1. 内存缓存检查
    if (MEMORY_CACHE_MAP.has(sourceUrl)) {
      const cachedItem = MEMORY_CACHE_MAP.get(sourceUrl);
      if (cachedItem.text && now < cachedItem.expireTime) {
        return smartFind(cachedItem.text, ch, date, originUrl, currentPath);
      } else {
        MEMORY_CACHE_MAP.delete(sourceUrl);
      }
    }

    // 2. 网络获取 (已包含超时和大小检查)
    const source = await getSourceStream(ctx, sourceUrl, env);
    let stream = source.stream;
    
    if (source.isGzip) {
      stream = stream.pipeThrough(new DecompressionStream('gzip'));
    }

    // 读取文本 (最耗时的步骤，如果文件巨大可能会在这里 OOM)
    // 但前面的 getSourceStream 已经通过 Content-Length 拦截了一部分
    const xmlText = await new Response(stream).text();

    // 3. 写入内存缓存
    if (xmlText.length < MAX_MEMORY_CACHE_CHARS) {
        if (MEMORY_CACHE_MAP.size >= 5) {
            const firstKey = MEMORY_CACHE_MAP.keys().next().value;
            MEMORY_CACHE_MAP.delete(firstKey);
        }
        MEMORY_CACHE_MAP.set(sourceUrl, {
            text: xmlText,
            expireTime: now + (cacheTtl * 1000)
        });
        console.log(`[Cache] Stored ${xmlText.length} chars in memory for ${sourceUrl}`);
    } else {
        console.warn(`[Cache] Skipped memory cache: Too large`);
    }

    return smartFind(xmlText, ch, date, originUrl, currentPath);
  } catch (e) {
    console.error(`Error processing source ${sourceUrl}:`, e.message);
    return { programs: [], response: {} };
  }
}