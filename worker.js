/**
 * Cloudflare Worker EPG Server (主备双源版)
 *
 * 环境变量说明 (在 Cloudflare 后台设置):
 * 1. EPG_URL: (必填) 主 EPG 源地址, 例如 https://example.com/main.xml.gz
 * 2. EPG_URL_BACKUP: (可选) 备选 EPG 源地址, 当主源查不到时使用
 * 3. CACHE_TTL: (可选) 缓存时间(秒), 默认 300
 */

const DEFAULT_CACHE_TTL = 300; // 默认缓存 5 分钟

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 检查是否配置了主 EPG_URL
    if (!env.EPG_URL) {
      return new Response(getSetupGuideHTML(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    try {
      switch (url.pathname) {
        case '/epg/diyp':
          return handleDiyp(request, url, ctx, env);
        case '/epg/epg.xml':
          // 文件下载仅提供主源，避免合并大文件导致超时
          return handleDownload(ctx, 'xml', env.EPG_URL, env);
        case '/epg/epg.xml.gz':
          return handleDownload(ctx, 'gz', env.EPG_URL, env);
        default:
          return new Response(getUsageHTML(request.url), {
             headers: { "Content-Type": "text/html; charset=utf-8" }
          });
      }
    } catch (e) {
      return new Response(`Server Error: ${e.message}`, { status: 500 });
    }
  },
};

// =========================================================
// 1. 通用数据获取模块 (支持指定 URL)
// =========================================================

async function getSourceStream(ctx, targetUrl, env) {
  // 获取 TTL，优先使用环境变量，否则使用默认值
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
  responseToCache.headers.set("Cache-Control", `public, max-age=${cacheTtl}`);
  ctx.waitUntil(cache.put(cacheKey, responseToCache));

  return {
    stream: streamForUse,
    headers: originRes.headers,
    isGzip: isGzipContent(originRes.headers, targetUrl)
  };
}

function isGzipContent(headers, urlStr) {
  return urlStr.endsWith('.gz') || 
         (headers.get('content-type') || '').includes('gzip') ||
         (headers.get('content-encoding') || '').includes('gzip');
}

// =========================================================
// 2. 下载处理模块
// =========================================================

async function handleDownload(ctx, targetFormat, sourceUrl, env) {
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
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": `public, max-age=${cacheTtl}`
    }
  });
}

// =========================================================
// 3. DIYP 接口处理模块 (核心更新：支持主备切换)
// =========================================================

async function handleDiyp(request, url, ctx, env) {
  const ch = url.searchParams.get('ch');
  const date = url.searchParams.get('date');

  if (!ch || !date) {
    return new Response(JSON.stringify({ code: 400, message: "Missing params" }), {
      headers: { 'content-type': 'application/json' }
    });
  }

  // 1. 尝试主源
  let result = await fetchAndFind(ctx, env.EPG_URL, ch, date, url.origin, env);

  // 2. 如果主源没找到，且配置了备用源，则尝试备用源
  if (result.programs.length === 0 && env.EPG_URL_BACKUP) {
    console.log(`Primary source failed for ${ch}, trying backup...`);
    const backupResult = await fetchAndFind(ctx, env.EPG_URL_BACKUP, ch, date, url.origin, env);
    
    // 如果备用源找到了，就使用备用源的结果
    if (backupResult.programs.length > 0) {
      result = backupResult;
    }
  }

  if (result.programs.length === 0) {
    return new Response(JSON.stringify({ 
      code: 404, 
      message: "No programs found in all sources",
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

// 辅助函数：获取流、解压并查找
async function fetchAndFind(ctx, sourceUrl, ch, date, originUrl, env) {
  try {
    const source = await getSourceStream(ctx, sourceUrl, env);
    let stream = source.stream;
    
    if (source.isGzip) {
      stream = stream.pipeThrough(new DecompressionStream('gzip'));
    }

    const xmlText = await new Response(stream).text();
    return smartFind(xmlText, ch, date, originUrl);
  } catch (e) {
    console.error(`Error fetching/parsing source ${sourceUrl}:`, e);
    // 出错时返回空结果，以便逻辑能继续处理（例如尝试下一个源）
    return { programs: [], response: {} };
  }
}

// =========================================================
// 4. 工具函数 & HTML 模板
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

// 提示 HTML
function getSetupGuideHTML() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>服务未配置 - EPG Proxy</title>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem; color: #333; }
        .container { background: #f9f9f9; padding: 2rem; border-radius: 8px; border: 1px solid #eee; }
        h1 { color: #e53e3e; }
        code { background: #e2e8f0; padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace; }
        .step { margin-bottom: 1.5rem; }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚠️ 服务尚未配置</h1>
        <p>您已成功部署 Worker，但尚未设置必要的环境变量。</p>
        <hr>
        <h3>如何解决：</h3>
        <div class="step">
            1. 登录 Cloudflare Dashboard，进入您的 Worker 项目。
        </div>
        <div class="step">
            2. 点击 <strong>Settings (设置)</strong> -> <strong>Variables (变量)</strong>。
        </div>
        <div class="step">
            3. 点击 <strong>Add Variable</strong>，添加以下变量：
            <ul>
                <li><code>EPG_URL</code> (必填): 主 EPG 源地址。</li>
                <li><code>EPG_URL_BACKUP</code> (可选): 备用 EPG 源地址。</li>
                <li><code>CACHE_TTL</code> (可选): 缓存时间(秒)，例如 300。</li>
            </ul>
        </div>
        <div class="step">
            4. 点击 <strong>Save and Deploy</strong>，然后刷新此页面。
        </div>
    </div>
</body>
</html>`;
}

// 首页 HTML
function getUsageHTML(baseUrl) {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const beijingTime = new Date(utc + (3600000 * 8));
  
  const yyyy = beijingTime.getFullYear();
  const mm = String(beijingTime.getMonth() + 1).padStart(2, '0');
  const dd = String(beijingTime.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>EPG Proxy is Running</title>
    <style>
        body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2rem; color: #333; }
        .container { background: #f0fff4; padding: 2rem; border-radius: 8px; border: 1px solid #c6f6d5; }
        h1 { color: #2f855a; }
        code { background: #fff; padding: 0.2rem 0.4rem; border-radius: 4px; border: 1px solid #ddd; display: block; margin: 0.5rem 0; overflow-x: auto;}
    </style>
</head>
<body>
    <div class="container">
        <h1>✅ EPG 服务运行中 (主备模式)</h1>
        <p>配置已加载，服务就绪。可用接口如下：</p>
        
        <h3>1. DIYP 接口 (智能聚合)</h3>
        <p>优先查主源，无结果自动查备源。</p>
        <code>${baseUrl}epg/diyp?ch=CCTV1&date=${dateStr}</code>
        
        <h3>2. XML 下载 (仅主源)</h3>
        <code>${baseUrl}epg/epg.xml</code>
        
        <h3>3. GZ 下载 (仅主源)</h3>
        <code>${baseUrl}epg/epg.xml.gz</code>
    </div>
</body>
</html>`;
}