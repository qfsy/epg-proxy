/**
 * Cloudflare Worker EPG Server (全功能终极版)
 * 功能：
 * 1. DIYP 接口：/epg/diyp (支持模糊匹配、高性能搜索)
 * 2. XML 直连：/epg/epg.xml (支持源格式自动转换，流式输出)
 * 3. GZ 直连： /epg/epg.xml.gz (支持源格式自动转换，流式输出)
 */

// 配置：源地址 (支持 .xml 或 .xml.gz)
const EPG_URL = "https://raw.githubusercontent.com/kuke31/xmlgz/main/all.xml.gz";
const CACHE_TTL = 300; // 缓存 5 分钟

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 路由分发
    switch (url.pathname) {
      case '/epg/diyp':
        return handleDiyp(request, url, ctx);
      case '/epg/epg.xml':
        return handleDownload(ctx, 'xml');
      case '/epg/epg.xml.gz':
        return handleDownload(ctx, 'gz');
      default:
        return new Response('Usage:\n1. /epg/diyp?ch=CCTV1&date=2024-01-01\n2. /epg/epg.xml\n3. /epg/epg.xml.gz', { status: 404 });
    }
  },
};

// =========================================================
// 1. 文件下载处理模块 (XML / GZ) - 使用流式传输，不占内存
// =========================================================

async function handleDownload(ctx, targetFormat) {
  try {
    const cache = caches.default;
    const cacheKey = new Request(EPG_URL, { method: "GET" });
    
    // 尝试从缓存获取源 Response
    let originResponse = await cache.match(cacheKey);

    if (!originResponse) {
      // 缓存未命中，回源抓取
      originResponse = await fetch(EPG_URL);
      if (!originResponse.ok) return new Response("Source Error", { status: 502 });

      // 存入缓存 (克隆一份用于缓存，一份用于后续处理)
      const responseToCache = new Response(originResponse.body, originResponse);
      responseToCache.headers.set("Cache-Control", `public, max-age=${CACHE_TTL}`);
      ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
    } else {
      // 这里的 originResponse 是从 Cache API 拿出来的，body 已经被使用过一次了
      // Cache API 返回的 Response body 是可以读取的
    }

    // 判断源文件的格式
    const isSourceGzip = EPG_URL.endsWith('.gz') || 
                         (originResponse.headers.get('content-type') || '').includes('gzip') ||
                         (originResponse.headers.get('content-encoding') || '').includes('gzip');

    let finalStream = originResponse.body;
    let contentType = "";

    // 核心转换逻辑：流管道 (Pipe)
    if (targetFormat === 'xml') {
      contentType = "application/xml; charset=utf-8";
      if (isSourceGzip) {
        // 源是 gz，目标是 xml -> 解压
        finalStream = finalStream.pipeThrough(new DecompressionStream('gzip'));
      }
      // 源是 xml，目标是 xml -> 直接透传 (Pass-through)
    
    } else if (targetFormat === 'gz') {
      contentType = "application/gzip";
      if (!isSourceGzip) {
        // 源是 xml，目标是 gz -> 压缩
        finalStream = finalStream.pipeThrough(new CompressionStream('gzip'));
      }
      // 源是 gz，目标是 gz -> 直接透传
    }

    return new Response(finalStream, {
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": `public, max-age=${CACHE_TTL}`
      }
    });

  } catch (e) {
    return new Response(`Stream Error: ${e.message}`, { status: 500 });
  }
}

// =========================================================
// 2. DIYP 接口处理模块 (JSON) - 保留之前的完美逻辑
// =========================================================

async function handleDiyp(request, url, ctx) {
  const ch = url.searchParams.get('ch');
  const date = url.searchParams.get('date');

  if (!ch || !date) {
    return new Response(JSON.stringify({ code: 400, message: "Missing 'ch' or 'date'" }), {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  try {
    // DIYP 需要纯文本内容进行搜索，所以这里单独处理文本获取
    const xmlText = await fetchEPGText(ctx);
    const result = smartFind(xmlText, ch, date, url.origin);

    if (result.programs.length === 0) {
      return new Response(JSON.stringify({ 
        code: 404, 
        message: "No programs found",
        debug_info: `Requested '${ch}', normalized to '${normalizeName(ch)}'.` 
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

  } catch (e) {
    return new Response(JSON.stringify({ code: 500, message: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
}

// 辅助：获取并解压为文本 (专供 DIYP 搜索使用)
async function fetchEPGText(ctx) {
  const cache = caches.default;
  const cacheKey = new Request(EPG_URL, { method: "GET" });
  let response = await cache.match(cacheKey);

  if (!response) {
    const originResponse = await fetch(EPG_URL);
    if (!originResponse.ok) throw new Error("Fetch failed");
    
    // 克隆流，一份存缓存，一份读取
    // 注意：这里我们缓存原始响应（可能是gz），这样既能服务下载，也能服务文本读取
    const responseToCache = new Response(originResponse.body, originResponse);
    responseToCache.headers.set("Cache-Control", `public, max-age=${CACHE_TTL}`);
    ctx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
    
    response = responseToCache;
  }

  const isGzip = EPG_URL.endsWith('.gz') || 
                 (response.headers.get('content-type') || '').includes('gzip') ||
                 (response.headers.get('content-encoding') || '').includes('gzip');

  let stream = response.body;
  if (isGzip) {
     stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  return new Response(stream).text();
}

// ---------------------------------------------------------
// 3. 搜索算法与工具函数
// ---------------------------------------------------------

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