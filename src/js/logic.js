/**
 * 核心业务逻辑模块
 * 处理 EPG 下载、流式传输、缓存以及 DIYP 接口逻辑
 * [优化] 引入实例级内存缓存，进一步减少 CPU 解析开销
 */

import { smartFind, isGzipContent } from './utils.js';

const DEFAULT_CACHE_TTL = 300; // 默认缓存 5 分钟

// [新增] 全局内存缓存 (Worker 实例级别)
// 用于缓存解压后的 XML 文本，避免重复调用 response.text() 带来的巨大 CPU/IO 开销
// 注意：Worker 可能会因内存限制被重置，这是正常的，缓存只是为了加速热启动后的请求
const IN_MEMORY_CACHE = {
  url: null,      // 当前缓存的源地址
  text: null,     // 解析后的 XML 文本内容
  expireTime: 0   // 过期时间戳
};

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
  // 源文件缓存使用 Upstream URL 作为 Key，确保全网复用
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
  
  // [优化] 构造标准化缓存键 (Canonical Cache Key)
  // 仅使用 URL 和 method，忽略 Header 差异 (如 User-Agent)
  // 这样无论是什么播放器请求同一个频道，都能命中同一份缓存
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  
  // 1. 尝试从缓存获取 API 结果
  let cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
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

  // 2. 执行查询 (优先主源，失败则备用源)
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
  } else {
    finalResponse = new Response(JSON.stringify(result.response), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${cacheTtl}`,
        ...CORS_HEADERS
      }
    });

    // 4. 将成功的结果写入缓存 (使用标准化的 cacheKey)
    ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
  }

  return finalResponse;
}

// 内部辅助：获取流 -> 解压 -> 解析
// [更新] 增加了内存缓存逻辑
async function fetchAndFind(ctx, sourceUrl, ch, date, originUrl, env, currentPath) {
  try {
    const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
    const now = Date.now();

    // --- 内存缓存检查 ---
    // 如果 URL 匹配且未过期，直接使用内存中的文本
    if (IN_MEMORY_CACHE.url === sourceUrl && 
        IN_MEMORY_CACHE.text && 
        now < IN_MEMORY_CACHE.expireTime) {
      // console.log("Memory Cache Hit!"); // 调试用
      return smartFind(IN_MEMORY_CACHE.text, ch, date, originUrl, currentPath);
    }

    // --- 内存未命中，执行标准获取流程 ---
    const source = await getSourceStream(ctx, sourceUrl, env);
    let stream = source.stream;
    
    if (source.isGzip) {
      stream = stream.pipeThrough(new DecompressionStream('gzip'));
    }

    // 读取并转换为文本 (耗时操作)
    const xmlText = await new Response(stream).text();

    // --- 更新内存缓存 ---
    // 只有当文本长度在合理范围内时才缓存（防止 OOM，例如限制 80MB）
    // Cloudflare Worker 限制通常为 128MB，这里不做硬性限制，由用户自行控制源大小
    IN_MEMORY_CACHE.url = sourceUrl;
    IN_MEMORY_CACHE.text = xmlText;
    IN_MEMORY_CACHE.expireTime = now + (cacheTtl * 1000);

    return smartFind(xmlText, ch, date, originUrl, currentPath);
  } catch (e) {
    console.error(`Error processing source ${sourceUrl}:`, e);
    return { programs: [], response: {} };
  }
}