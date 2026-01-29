/**
 * 核心业务逻辑模块
 * 处理 EPG 下载、流式传输、缓存以及 DIYP 接口逻辑
 * [v2.3 优化] 升级内存缓存为 Map 结构，支持多源并发缓存，解决主备源切换时的缓存颠簸问题
 */

import { smartFind, isGzipContent } from './utils.js';

const DEFAULT_CACHE_TTL = 300; // 默认缓存 5 分钟

// [安全配置] 内存缓存最大字符数阈值
// 10,000,000 字符 ≈ 20MB 内存占用 (JS 字符串通常占用 2字节/字符)
const MAX_MEMORY_CACHE_CHARS = 10 * 1024 * 1024;

// [全局内存缓存 v2.3]
// 使用 Map 代替单一对象，防止主备源切换时互相覆盖导致缓存失效
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
  
  // [兼容性修复] 检查 caches 是否存在 (防止在非 Worker/Wrangler 的纯 Node 环境报错)
  const cache = (typeof caches !== 'undefined') ? caches.default : null;
  
  // 源文件缓存使用 Upstream URL 作为 Key
  const cacheKey = new Request(targetUrl, { method: "GET" });
  
  // 如果环境支持 Cache API，尝试读取
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

  console.log(`Cache miss, fetching from: ${targetUrl}`);
  const originRes = await fetch(targetUrl);
  if (!originRes.ok) throw new Error(`Source fetch failed: ${originRes.status}`);

  // 只有当有 Cache API 时才需要 tee 流
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
    // 无 Cache 环境直接返回流
    return {
      stream: originRes.body,
      headers: originRes.headers,
      isGzip: isGzipContent(originRes.headers, targetUrl)
    };
  }
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
  const cache = (typeof caches !== 'undefined') ? caches.default : null;
  
  // [优化] 构造标准化缓存键
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  
  // 1. 尝试从缓存获取 API 结果
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

    // 4. 将成功的结果写入缓存
    if (cache) {
      ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
    }
  }

  return finalResponse;
}

// 内部辅助：获取流 -> 解压 -> 解析
// [更新] 包含内存缓存熔断机制 + 多源支持
async function fetchAndFind(ctx, sourceUrl, ch, date, originUrl, env, currentPath) {
  try {
    const cacheTtl = parseInt(env.CACHE_TTL) || DEFAULT_CACHE_TTL;
    const now = Date.now();

    // --- 1. 内存缓存检查 (v2.3 Map 支持) ---
    // 检查对应 URL 的缓存是否存在且未过期
    if (MEMORY_CACHE_MAP.has(sourceUrl)) {
      const cachedItem = MEMORY_CACHE_MAP.get(sourceUrl);
      if (cachedItem.text && now < cachedItem.expireTime) {
        // console.log(`Memory Cache Hit for ${sourceUrl}`);
        return smartFind(cachedItem.text, ch, date, originUrl, currentPath);
      } else {
        // 过期清理
        MEMORY_CACHE_MAP.delete(sourceUrl);
      }
    }

    // --- 2. 网络获取 ---
    const source = await getSourceStream(ctx, sourceUrl, env);
    let stream = source.stream;
    
    if (source.isGzip) {
      stream = stream.pipeThrough(new DecompressionStream('gzip'));
    }

    // 读取文本 (最耗时的步骤)
    const xmlText = await new Response(stream).text();

    // --- 3. 写入内存缓存 (带熔断保护) ---
    // 只有当文件大小在安全范围内时，才写入内存
    if (xmlText.length < MAX_MEMORY_CACHE_CHARS) {
        // [防止 OOM] 如果 Map 太大 (例如缓存了超过 5 个源)，先清理最早的一个
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
        console.warn(`[Cache] Skipped memory cache: Content too large (${xmlText.length} chars > ${MAX_MEMORY_CACHE_CHARS})`);
    }

    return smartFind(xmlText, ch, date, originUrl, currentPath);
  } catch (e) {
    console.error(`Error processing source ${sourceUrl}:`, e);
    return { programs: [], response: {} };
  }
}