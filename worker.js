/**
 * Cloudflare Worker EPG Server (高性能版)
 * 优化：放弃全文正则，改用 indexOf 跳跃查找，解决 CPU 超时问题
 */

const EPG_URL = "https://raw.githubusercontent.com/kuke31/xmlgz/main/all.xml.gz";
const CACHE_TTL = 300; // 缓存 5 分钟

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
  const date = url.searchParams.get('date'); // 2023-10-27

  if (!ch || !date) {
    return new Response(JSON.stringify({ code: 400, message: "Missing 'ch' or 'date'" }), {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  try {
    // 1. 获取 XML 文本 (带缓存)
    const xmlText = await fetchEPGData(ctx);
    
    // 2. 极速筛选
    const result = quickFind(xmlText, ch, date, url.origin);

    if (result.programs.length === 0) {
      return new Response(JSON.stringify({ code: 404, message: "No programs found" }), {
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

// 获取、解压并缓存 XML 文本 (这部分没变)
async function fetchEPGData(ctx) {
  const cache = caches.default;
  const cacheKey = new Request(EPG_URL, { method: "GET" });
  let response = await cache.match(cacheKey);

  if (!response) {
    const originResponse = await fetch(EPG_URL);
    if (!originResponse.ok) throw new Error("Failed to fetch EPG xml");

    let stream = originResponse.body;
    if (EPG_URL.endsWith('.gz') || (originResponse.headers.get('content-type') || '').includes('gzip')) {
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

/**
 * 核心优化逻辑：使用 indexOf 代替全局正则
 * 速度极快，CPU 占用极低
 */
function quickFind(xml, targetChannelName, targetDateStr, originUrl) {
  // 1. 查找频道 ID (Channel ID)
  // 策略：直接搜索 ">频道名<"，然后往前找 id="..."
  const nameTag = `>${targetChannelName}<`;
  const nameIndex = xml.indexOf(nameTag);
  
  let channelID = "";
  let icon = "";

  if (nameIndex !== -1) {
    // 截取频道名之前的一小段文本来找 ID (避免处理整个文件)
    // 假设 <channel> 标签不会超过 500 个字符
    const searchArea = xml.substring(Math.max(0, nameIndex - 500), nameIndex);
    // 匹配 id="xxx"
    const idMatch = searchArea.match(/id="([^"]+)"/);
    if (idMatch) channelID = idMatch[1];

    // 顺便找 icon (往后找)
    const iconArea = xml.substring(nameIndex, nameIndex + 500);
    const iconMatch = iconArea.match(/<icon src="([^"]+)"/);
    if (iconMatch) icon = iconMatch[1];
  }

  if (!channelID) {
    return { programs: [], response: {} };
  }

  // 2. 查找节目 (Programmes)
  // 策略：不遍历所有节目，直接搜索 `channel="CHANNEL_ID"`
  const programs = [];
  const targetDateCompact = targetDateStr.replace(/-/g, ''); // 20231027
  const channelAttr = `channel="${channelID}"`; // 搜索关键词
  
  let pos = xml.indexOf(channelAttr);
  
  // 循环查找该频道的节目，直到找不到为止
  while (pos !== -1) {
    // 找到 channel="id" 后，我们需要找到整个 <programme> 标签的范围
    // 1. 往前找 '<programme'
    const startTagIndex = xml.lastIndexOf('<programme', pos);
    // 2. 往后找 '</programme>'
    const endTagIndex = xml.indexOf('</programme>', pos);

    if (startTagIndex !== -1 && endTagIndex !== -1) {
      // 提取这一条节目的完整 XML 字符串
      const progStr = xml.substring(startTagIndex, endTagIndex + 12);
      
      // 3. 在这短短的一行字符串里提取时间
      // 格式通常是 start="20231027..."
      const startMatch = progStr.match(/start="([^"]+)"/);
      const stopMatch = progStr.match(/stop="([^"]+)"/);
      
      if (startMatch && startMatch[1].startsWith(targetDateCompact)) {
        // 只有日期匹配才提取标题
        const titleMatch = progStr.match(/<title[^>]*>([^<]+)<\/title>/);
        const descMatch = progStr.match(/<desc[^>]*>([\s\S]*?)<\/desc>/); // desc 可能有换行

        programs.push({
          start: formatTime(startMatch[1]),
          end: stopMatch ? formatTime(stopMatch[1]) : "",
          title: titleMatch ? titleMatch[1] : "无标题",
          desc: descMatch ? descMatch[1] : ""
        });
      }
    }

    // 继续查找下一个同频道的节目
    pos = xml.indexOf(channelAttr, pos + 1);
  }

  return {
    programs: programs,
    response: {
      code: 200,
      message: "请求成功",
      channel_id: channelID,
      channel_name: targetChannelName,
      date: targetDateStr,
      url: `${originUrl}/epg/diyp`,
      icon: icon,
      epg_data: programs
    }
  };
}

function formatTime(raw) {
  // raw: "20231027183200 +0800" -> "18:32"
  if (!raw || raw.length < 12) return "";
  return `${raw.substring(8, 10)}:${raw.substring(10, 12)}`;
}