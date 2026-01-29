// 文件路径: src/js/logic.js
/**
 * 核心业务逻辑模块
 * 处理 EPG 下载、流式传输、缓存以及 DIYP 接口逻辑
 * [优化] 导出 CORS_HEADERS 供 index.js 复用
 */

import { smartFind, isGzipContent } from './utils.js';

const DEFAULT_CACHE_TTL = 300; // 默认缓存 5 分钟

// [优化] 导出常量，供 index.js 处理 OPTIONS 请求时使用
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type', // 补充常用头
};

// =========================================================
// 1. 数据源获取与缓存
// =========================================================

export async function getSourceStream(ctx, targetUrl, env) {
  const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
  const cache = caches.default;
  const cacheKey = new Request(targetUrl, { method: "GET" });
  
  // 尝试从缓存获取
  let cachedRes = await cache.match(cacheKey);
  if (cachedRes) {
    return {
      stream: cachedRes.body,
      headers: cachedRes.headers,
      isGzip: isGzipContent(cachedRes.headers, targetUrl)
    };
  }

  // 缓存未命中，回源拉取
  console.log(`Cache miss, fetching from: ${targetUrl}`);
  const originRes = await fetch(targetUrl);
  if (!originRes.ok) throw new Error(`Source fetch failed: ${originRes.status}`);

  // 复制流：一份用于缓存，一份用于当前响应
  const [streamForCache, streamForUse] = originRes.body.tee();

  const responseToCache = new Response(streamForCache, {
    headers: originRes.headers,
    status: originRes.status,
    statusText: originRes.statusText
  });
  
  // 设置缓存时间
  responseToCache.headers.set("Cache-Control", `public, max-age=${cacheTtl}`);
  ctx.waitUntil(cache.put(cacheKey, responseToCache));

  return {
    stream: streamForUse,
    headers: originRes.headers,
    isGzip: isGzipContent(originRes.headers, targetUrl)
  };
}

// =========================================================
// 2. 文件下载处理 (XML/GZ)
// =========================================================

export async function handleDownload(ctx, targetFormat, sourceUrl, env) {
  const source = await getSourceStream(ctx, sourceUrl, env);
  const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
  
  let finalStream = source.stream;
  let contentType = "";

  if (targetFormat === 'xml') {
    contentType = "application/xml; charset=utf-8";
    // 如果源是 Gzip 但请求 XML，则解压
    if (source.isGzip) {
      finalStream = finalStream.pipeThrough(new DecompressionStream('gzip'));
    }
  } else if (targetFormat === 'gz') {
    contentType = "application/gzip";
    // 如果源不是 Gzip 但请求 GZ，则压缩
    if (!source.isGzip) {
      finalStream = finalStream.pipeThrough(new CompressionStream('gzip'));
    }
  }

  return new Response(finalStream, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": `public, max-age=${cacheTtl}`,
      ...CORS_HEADERS // 复用导出常量
    }
  });
}

// =========================================================
// 3. DIYP / 超级直播 接口处理
// =========================================================

export async function handleDiyp(request, url, ctx, env) {
  // 兼容性优化：支持 ch, channel, id 三种参数名
  const ch = url.searchParams.get('ch') || url.searchParams.get('channel') || url.searchParams.get('id');
  const date = url.searchParams.get('date');
  const currentPath = url.pathname; 

  if (!ch || !date) {
    return new Response(JSON.stringify({ code: 400, message: "Missing params: ch (or channel/id) or date" }), {
      headers: { 
        'content-type': 'application/json',
        ...CORS_HEADERS 
      }
    });
  }

  // 1. 尝试主源
  let result = await fetchAndFind(ctx, env.EPG_URL, ch, date, url.origin, env, currentPath);

  // 2. 如果主源没找到，且配置了备用源，则尝试备用源
  if (result.programs.length === 0 && env.EPG_URL_BACKUP) {
    console.log(`Primary source failed for ${ch}, trying backup...`);
    const backupResult = await fetchAndFind(ctx, env.EPG_URL_BACKUP, ch, date, url.origin, env, currentPath);
    
    // 如果备用源找到了，就使用备用源的结果
    if (backupResult.programs.length > 0) {
      result = backupResult;
    }
  }

  if (result.programs.length === 0) {
    return new Response(JSON.stringify({ 
      code: 404, 
      message: "No programs found",
      debug_info: { channel: ch, date: date }
    }), {
      headers: { 
        'content-type': 'application/json; charset=utf-8',
        ...CORS_HEADERS
      },
      status: 404
    });
  }

  return new Response(JSON.stringify(result.response), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  });
}

// 内部辅助：获取流 -> 解压 -> 解析
async function fetchAndFind(ctx, sourceUrl, ch, date, originUrl, env, currentPath) {
  try {
    const source = await getSourceStream(ctx, sourceUrl, env);
    let stream = source.stream;
    
    // 解析需要文本，如果是 Gzip 必须解压
    if (source.isGzip) {
      stream = stream.pipeThrough(new DecompressionStream('gzip'));
    }

    const xmlText = await new Response(stream).text();
    // 传递当前路径给 smartFind
    return smartFind(xmlText, ch, date, originUrl, currentPath);
  } catch (e) {
    console.error(`Error processing source ${sourceUrl}:`, e);
    return { programs: [], response: {} };
  }
}