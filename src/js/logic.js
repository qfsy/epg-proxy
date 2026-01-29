/**
 * 核心业务逻辑模块
 * 处理 EPG 下载、流式传输、缓存以及 DIYP 接口逻辑
 * [优化] 增加 API 结果缓存 (Cache API)，大幅减少重复计算
 */

import { smartFind, isGzipContent } from './utils.js';

const DEFAULT_CACHE_TTL = 300; // 默认缓存 5 分钟

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
  const cache = caches.default;
  const cacheKey = new Request(targetUrl, { method: "GET" });
  
  let cachedRes = await cache.match(cacheKey);
  if (cachedRes) {
    return {
      stream: cachedRes.body,
      headers: cachedRes.headers,
      isGzip: isGzipContent(cachedRes.headers, targetUrl)
    };
  }

  console.log(`Cache miss, fetching from: ${targetUrl}`);
  const originRes = await fetch(targetUrl);
  if (!originRes.ok) throw new Error(`Source fetch failed: ${originRes.status}`);

  const [streamForCache, streamForUse] = originRes.body.tee();

  const responseToCache = new Response(streamForCache, {
    headers: originRes.headers,
    status: originRes.status,
    statusText: originRes.statusText
  });
  
  // 源文件缓存
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
}

// =========================================================
// 3. DIYP / 超级直播 接口处理
// =========================================================

export async function handleDiyp(request, url, ctx, env) {
  const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
  const cache = caches.default;
  
  // [新增] 1. 尝试从缓存获取 API 结果
  // Cloudflare Cache API 使用 request 对象作为 key
  // 相同的 URL 参数 (ch=CCTV1&date=...) 将命中同一个缓存
  let cachedResponse = await cache.match(request);
  if (cachedResponse) {
    // 命中缓存：直接返回，跳过 XML 解析！性能提升 100x
    return cachedResponse;
  }

  const ch = url.searchParams.get('ch') || url.searchParams.get('channel') || url.searchParams.get('id');
  const date = url.searchParams.get('date');
  const currentPath = url.pathname; 

  if (!ch || !date) {
    return new Response(JSON.stringify({ code: 400, message: "Missing params: ch (or channel/id) or date" }), {
      headers: { 'content-type': 'application/json', ...CORS_HEADERS }
    });
  }

  // 2. 执行查询逻辑 (耗时操作)
  let result = await fetchAndFind(ctx, env.EPG_URL, ch, date, url.origin, env, currentPath);

  if (result.programs.length === 0 && env.EPG_URL_BACKUP) {
    console.log(`Primary source failed for ${ch}, trying backup...`);
    const backupResult = await fetchAndFind(ctx, env.EPG_URL_BACKUP, ch, date, url.origin, env, currentPath);
    if (backupResult.programs.length > 0) {
      result = backupResult;
    }
  }

  // 3. 构造响应
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
    // 404 响应通常不缓存，或缓存很短时间，这里暂不写入 Cache API
  } else {
    finalResponse = new Response(JSON.stringify(result.response), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // [关键] 设置 Cache-Control 允许 Cloudflare 和浏览器缓存此结果
        'Cache-Control': `public, max-age=${cacheTtl}`,
        ...CORS_HEADERS
      }
    });

    // [新增] 4. 将成功的结果写入缓存
    // 必须使用 response.clone() 因为 put 会消耗流
    ctx.waitUntil(cache.put(request, finalResponse.clone()));
  }

  return finalResponse;
}

// 内部辅助：获取流 -> 解压 -> 解析
async function fetchAndFind(ctx, sourceUrl, ch, date, originUrl, env, currentPath) {
  try {
    const source = await getSourceStream(ctx, sourceUrl, env);
    let stream = source.stream;
    
    if (source.isGzip) {
      stream = stream.pipeThrough(new DecompressionStream('gzip'));
    }

    const xmlText = await new Response(stream).text();
    return smartFind(xmlText, ch, date, originUrl, currentPath);
  } catch (e) {
    console.error(`Error processing source ${sourceUrl}:`, e);
    return { programs: [], response: {} };
  }
}