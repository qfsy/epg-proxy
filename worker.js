/**
 * Cloudflare Worker EPG Server (中文修复版)
 * 修复问题：解决中文频道（江苏卫视、湖南卫视）无法匹配的问题
 */

const EPG_URL = "https://raw.githubusercontent.com/kuke31/xmlgz/main/all.xml.gz";
const CACHE_TTL = 300; 

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/epg/diyp') {
      return handleDiyp(request, url, ctx);
    }
    return new Response('Not Found. Please use /epg/diyp', { status: 404 });
  },
};

async function handleDiyp(request, url, ctx) {
  const ch = url.searchParams.get('ch');
  const date = url.searchParams.get('date'); 

  if (!ch || !date) {
    return new Response(JSON.stringify({ code: 400, message: "Missing 'ch' or 'date'" }), {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  try {
    const xmlText = await fetchEPGData(ctx);
    const result = smartFind(xmlText, ch, date, url.origin);

    if (result.programs.length === 0) {
      return new Response(JSON.stringify({ 
        code: 404, 
        message: "No programs found",
        // 返回调试信息，告诉你实际匹配了什么
        debug_info: `Requested '${ch}', normalized to '${normalizeName(ch)}'. Check channel name accuracy.` 
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

async function fetchEPGData(ctx) {
  const cache = caches.default;
  const cacheKey = new Request(EPG_URL, { method: "GET" });
  let response = await cache.match(cacheKey);

  if (!response) {
    const originResponse = await fetch(EPG_URL);
    if (!originResponse.ok) throw new Error(`Failed to fetch EPG: ${originResponse.status}`);

    const isGzip = EPG_URL.endsWith('.gz') || 
                   (originResponse.headers.get('content-type') || '').includes('gzip') ||
                   (originResponse.headers.get('content-encoding') || '').includes('gzip');

    let stream = originResponse.body;
    if (isGzip) {
       stream = originResponse.body.pipeThrough(new DecompressionStream('gzip'));
    }

    const text = await new Response(stream).text();
    response = new Response(text, {
      headers: { 'Cache-Control': `public, max-age=${CACHE_TTL}` }
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return text;
  }
  return response.text();
}

function smartFind(xml, userChannelName, targetDateStr, originUrl) {
  // 1. 归一化用户输入
  const normalizedInput = normalizeName(userChannelName);
  
  let channelID = "";
  let icon = "";
  let realDisplayName = "";

  // 2. 正则查找 Channel
  const channelRegex = /<channel id="([^"]+)">[\s\S]*?<display-name[^>]*>([^<]+)<\/display-name>[\s\S]*?(?:<icon src="([^"]+)" \/>)?[\s\S]*?<\/channel>/g;
  
  let match;
  while ((match = channelRegex.exec(xml)) !== null) {
    const id = match[1];
    const nameInXml = match[2];
    const iconInXml = match[3] || "";
    
    // 归一化 XML 中的名称并对比
    if (normalizeName(nameInXml) === normalizedInput) {
      channelID = id;
      realDisplayName = nameInXml;
      icon = iconInXml;
      break; 
    }
  }

  if (!channelID) {
    return { programs: [], response: {} };
  }

  // 3. 索引查找 Programs
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

/**
 * 修复后的归一化函数：
 * 只移除空格、横杠、下划线，保留中文和特殊字符（如+号）
 */
function normalizeName(name) {
  if (!name) return "";
  // 1. 转大写 (CCTV -> CCTV)
  // 2. 移除空格、横杠、下划线
  // 结果： "CCTV-1" -> "CCTV1", "江苏卫视" -> "江苏卫视"
  return name.trim().toUpperCase().replace(/[\s\-_]/g, '');
}

function formatTime(raw) {
  if (!raw || raw.length < 12) return "";
  return `${raw.substring(8, 10)}:${raw.substring(10, 12)}`;
}