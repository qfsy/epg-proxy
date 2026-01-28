/**
 * Cloudflare Worker EPG Server (零依赖在线版)
 * 功能：下载 Gzip XML -> 解压 -> 正则解析 -> JSON
 * 无需 NPM install，可直接在 Cloudflare 网页端部署
 */

// 配置
const EPG_URL = "https://raw.githubusercontent.com/kuke31/xmlgz/main/all.xml.gz";
const CACHE_TTL = 300; // 缓存时间 300秒

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 路由匹配
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
    // 1. 获取并解压数据
    const xmlText = await fetchEPGData(ctx);
    
    // 2. 解析与筛选 (使用原生逻辑，不依赖库)
    const result = parseAndFind(xmlText, ch, date, url.origin);

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

// 获取、解压并缓存 XML 文本
async function fetchEPGData(ctx) {
  const cache = caches.default;
  const cacheKey = new Request(EPG_URL, { method: "GET" });

  let response = await cache.match(cacheKey);

  if (!response) {
    console.log("Cache miss, fetching...");
    const originResponse = await fetch(EPG_URL);
    if (!originResponse.ok) throw new Error("Failed to fetch EPG xml");

    // 处理 Gzip 解压 (Web Standard API)
    let stream = originResponse.body;
    // 简单判断：如果以 .gz 结尾或 content-type 包含 gzip
    if (EPG_URL.endsWith('.gz') || (originResponse.headers.get('content-type') || '').includes('gzip')) {
       stream = originResponse.body.pipeThrough(new DecompressionStream('gzip'));
    }

    const text = await new Response(stream).text();

    // 存入缓存
    response = new Response(text, {
      headers: { 'Cache-Control': `public, max-age=${CACHE_TTL}` }
    });
    // waitUntil 确保在返回前缓存不被中断
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return text;
  }
  
  return response.text();
}

/**
 * 核心逻辑：使用正则解析 XML 字符串
 * 替代 fast-xml-parser 库
 */
function parseAndFind(xml, targetChannelName, targetDateStr, originUrl) {
  // 1. 查找频道 ID 和 Icon
  // 正则匹配 <channel id="..."> ... <display-name>CCTV1</display-name>
  // 注意：XML 可能包含换行，使用 [\s\S]*? 或 [^]*? 来匹配多行
  
  let channelID = "";
  let icon = "";
  
  // 简单的正则提取频道块
  const channelRegex = /<channel id="([^"]+)">[\s\S]*?<display-name>([^<]+)<\/display-name>[\s\S]*?(?:<icon src="([^"]+)" \/>)?[\s\S]*?<\/channel>/g;
  
  let match;
  while ((match = channelRegex.exec(xml)) !== null) {
    const id = match[1];
    const name = match[2]; // display-name
    const iconSrc = match[3] || ""; // icon (可能为空)

    if (name === targetChannelName) {
      channelID = id;
      icon = iconSrc;
      break; // 找到了就退出
    }
  }

  if (!channelID) {
    return { programs: [], response: {} };
  }

  // 2. 格式化目标日期 (2023-10-27 -> 20231027)
  const targetDateCompact = targetDateStr.replace(/-/g, ''); 

  // 3. 查找节目单
  // 匹配 <programme start="..." stop="..." channel="..."> ... <title>...</title> ... </programme>
  const programs = [];
  
  // 优化：只查找包含该频道ID的 programme 标签，提高正则效率
  // 这一步正则比较重，但对于 EPG 这种结构通常没问题
  // 格式: <programme start="20231027000000 +0800" stop="..." channel="CCTV1">
  const progRegex = new RegExp(`<programme start="([^"]+)" stop="([^"]+)" channel="${escapeRegExp(channelID)}"[^>]*>[\\s\\S]*?<title[^>]*>([^<]+)<\\/title>(?:[\\s\\S]*?<desc[^>]*>([\\s\\S]*?)<\\/desc>)?`, 'g');

  let pMatch;
  while ((pMatch = progRegex.exec(xml)) !== null) {
    const startRaw = pMatch[1]; // 20231027000000 +0800
    const stopRaw = pMatch[2];
    const title = pMatch[3];
    const desc = pMatch[4] || "";

    // 检查日期是否匹配 (取前8位)
    if (startRaw.startsWith(targetDateCompact)) {
      programs.push({
        start: formatTime(startRaw),
        end: formatTime(stopRaw),
        title: title,
        desc: desc
      });
    }
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

// 辅助：转义正则中的特殊字符
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 辅助：提取时间 HH:mm
function formatTime(raw) {
  // raw 格式通常是 "20231027183200 +0800"
  if (!raw || raw.length < 12) return "";
  return `${raw.substring(8, 10)}:${raw.substring(10, 12)}`;
}