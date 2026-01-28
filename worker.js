/**
 * Cloudflare Worker EPG Server (流锁定修复版)
 * 修复：解决 "ReadableStream is currently locked" 报错
 * 功能：
 * 1. DIYP 接口：/epg/diyp
 * 2. XML 直连：/epg/epg.xml (流式解压)
 * 3. GZ 直连： /epg/epg.xml.gz (流式压缩)
 */

const EPG_URL = "https://raw.githubusercontent.com/kuke31/xmlgz/main/all.xml.gz";
const CACHE_TTL = 300; // 缓存 5 分钟

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        case '/epg/diyp':
          return handleDiyp(request, url, ctx);
        case '/epg/epg.xml':
          return handleDownload(ctx, 'xml');
        case '/epg/epg.xml.gz':
          return handleDownload(ctx, 'gz');
        default:
          return new Response('Usage:\n1. /epg/diyp\n2. /epg/epg.xml\n3. /epg/epg.xml.gz', { status: 404 });
      }
    } catch (e) {
      return new Response(`Server Error: ${e.message}`, { status: 500 });
    }
  },
};

// =========================================================
// 1. 通用数据获取模块 (核心修复点)
// =========================================================

/**
 * 获取源数据流，并处理缓存逻辑
 * 使用 stream.tee() 解决流锁定问题
 */
async function getSourceStream(ctx) {
  const cache = caches.default;
  const cacheKey = new Request(EPG_URL, { method: "GET" });
  
  // 1. 尝试读缓存
  let cachedRes = await cache.match(cacheKey);
  if (cachedRes) {
    // 缓存命中：直接返回缓存的流和头部信息
    return {
      stream: cachedRes.body,
      headers: cachedRes.headers,
      isGzip: isGzipContent(cachedRes.headers, EPG_URL)
    };
  }

  // 2. 缓存未命中：回源抓取
  console.log("Cache miss, fetching from origin...");
  const originRes = await fetch(EPG_URL);
  if (!originRes.ok) throw new Error(`Source fetch failed: ${originRes.status}`);

  // 关键修复：使用 tee() 将流一分为二
  // streamForCache -> 用于存入缓存
  // streamForUse   -> 用于当前处理返回
  const [streamForCache, streamForUse] = originRes.body.tee();

  // 3. 异步存入缓存 (使用 streamForCache)
  // 构造一个新的 Response 对象用于缓存
  const responseToCache = new Response(streamForCache, {
    headers: originRes.headers,
    status: originRes.status,
    statusText: originRes.statusText
  });
  // 强制设置缓存时间
  responseToCache.headers.set("Cache-Control", `public, max-age=${CACHE_TTL}`);
  // 使用 waitUntil 确保请求结束后缓存操作继续执行
  ctx.waitUntil(cache.put(cacheKey, responseToCache));

  // 4. 返回可用的流 (streamForUse)
  return {
    stream: streamForUse,
    headers: originRes.headers,
    isGzip: isGzipContent(originRes.headers, EPG_URL)
  };
}

// 辅助：判断是否为 Gzip
function isGzipContent(headers, urlStr) {
  return urlStr.endsWith('.gz') || 
         (headers.get('content-type') || '').includes('gzip') ||
         (headers.get('content-encoding') || '').includes('gzip');
}

// =========================================================
// 2. 下载处理模块 (XML / GZ)
// =========================================================

async function handleDownload(ctx, targetFormat) {
  // 获取源数据流 (这里已经处理好了 tee，不会锁死)
  const source = await getSourceStream(ctx);
  
  let finalStream = source.stream;
  let contentType = "";

  // 转换逻辑
  if (targetFormat === 'xml') {
    contentType = "application/xml; charset=utf-8";
    if (source.isGzip) {
      // 源是 gz -> 解压
      finalStream = finalStream.pipeThrough(new DecompressionStream('gzip'));
    }
  } else if (targetFormat === 'gz') {
    contentType = "application/gzip";
    if (!source.isGzip) {
      // 源是 xml -> 压缩
      finalStream = finalStream.pipeThrough(new CompressionStream('gzip'));
    }
  }

  return new Response(finalStream, {
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      // 这里的缓存控制是给浏览器看的
      "Cache-Control": `public, max-age=${CACHE_TTL}`
    }
  });
}

// =========================================================
// 3. DIYP 接口处理模块 (JSON)
// =========================================================

async function handleDiyp(request, url, ctx) {
  const ch = url.searchParams.get('ch');
  const date = url.searchParams.get('date');

  if (!ch || !date) {
    return new Response(JSON.stringify({ code: 400, message: "Missing params" }), {
      headers: { 'content-type': 'application/json' }
    });
  }

  // 获取流
  const source = await getSourceStream(ctx);
  let stream = source.stream;

  // 如果源是 Gzip，先解压成文本流
  if (source.isGzip) {
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }

  // 转为文本进行搜索
  const xmlText = await new Response(stream).text();
  const result = smartFind(xmlText, ch, date, url.origin);

  if (result.programs.length === 0) {
    return new Response(JSON.stringify({ 
      code: 404, 
      message: "No programs found",
      debug_info: `Requested '${ch}' normalized to '${normalizeName(ch)}'` 
    }), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
      status: 404
    });
  }

  return new Response(JSON.stringify(result.response), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*'
    }
  });
}

// =========================================================
// 4. 搜索工具函数
// =========================================================

function smartFind(xml, userChannelName, targetDateStr, originUrl) {
  const normalizedInput = normalizeName(userChannelName);
  let channelID = "";
  let icon = "";
  let realDisplayName = "";

  const channelRegex = /<channel id="([^"]+)">[\s\S]*?<display-name[^>]*>([^<]+)<\/display-name>[\s\S]*?(?:<icon src="([^"]+)" \/>)?[\s\S]*?<\/channel>/g;
  
  let match;
  while ((match = channelRegex.exec(xml)) !== null) {
    const id = match[1];
    const nameInXml = match[2];
    const iconInXml = match[3] || "";
    
    if (normalizeName(nameInXml) === normalizedInput) {
      channelID = id;
      realDisplayName = nameInXml;
      icon = iconInXml;
      break; 
    }
  }

  if (!channelID) return { programs: [], response: {} };

  const programs = [];
  const targetDateCompact = targetDateStr.replace(/-/g, '');
  const channelAttr = `channel="${channelID}"`;
  
  let pos = xml.indexOf(channelAttr);
  while (pos !== -1) {
    const startTagIndex = xml.lastIndexOf('<programme', pos);
    const endTagIndex = xml.indexOf('</programme>', pos);

    if (startTagIndex !== -1 && endTagIndex !== -1) {
      const progStr = xml.substring(startTagIndex, endTagIndex + 12);
      const startMatch = progStr.match(/start="([^"]+)"/);
      
      if (startMatch && startMatch[1].startsWith(targetDateCompact)) {
        const stopMatch = progStr.match(/stop="([^"]+)"/);
        const titleMatch = progStr.match(/<title[^>]*>([^<]+)<\/title>/);
        const descMatch = progStr.match(/<desc[^>]*>([\s\S]*?)<\/desc>/); 

        programs.push({
          start: formatTime(startMatch[1]),
          end: stopMatch ? formatTime(stopMatch[1]) : "",
          title: titleMatch ? titleMatch[1] : "节目",
          desc: descMatch ? descMatch[1] : ""
        });
      }
    }
    pos = xml.indexOf(channelAttr, pos + 1);
  }

  return {
    programs: programs,
    response: {
      code: 200,
      message: "请求成功",
      channel_id: channelID,
      channel_name: realDisplayName,
      date: targetDateStr,
      url: `${originUrl}/epg/diyp`,
      icon: icon,
      epg_data: programs
    }
  };
}

function normalizeName(name) {
  if (!name) return "";
  return name.trim().toUpperCase().replace(/[\s\-_]/g, '');
}

function formatTime(raw) {
  if (!raw || raw.length < 12) return "";
  return `${raw.substring(8, 10)}:${raw.substring(10, 12)}`;
}