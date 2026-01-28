/**
 * Cloudflare Worker EPG Server (终极通用版)
 * 功能：
 * 1. 自动识别 .gz 或 .xml 源格式
 * 2. 智能频道名匹配 (支持 cctv-1 匹配 CCTV1，同时区分 CCTV5 和 CCTV5+)
 * 3. 高性能索引查找，防止 CPU 超时
 */

// 配置：在此处替换您的 EPG 源地址 (支持 .xml 或 .xml.gz)
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
  const date = url.searchParams.get('date'); // 格式 2023-10-27

  if (!ch || !date) {
    return new Response(JSON.stringify({ code: 400, message: "Missing 'ch' or 'date'" }), {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  try {
    // 1. 获取并清洗 XML 数据
    const xmlText = await fetchEPGData(ctx);
    
    // 2. 智能查找
    const result = smartFind(xmlText, ch, date, url.origin);

    if (result.programs.length === 0) {
      // 如果没找到，返回 404，方便客户端处理
      return new Response(JSON.stringify({ 
        code: 404, 
        message: "No programs found",
        debug_info: `Channel '${ch}' not matched in EPG.` 
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

// ---------------------------------------------------------
// 核心逻辑层
// ---------------------------------------------------------

/**
 * 智能获取数据
 * 自动判断是否需要解压 Gzip
 */
async function fetchEPGData(ctx) {
  const cache = caches.default;
  const cacheKey = new Request(EPG_URL, { method: "GET" });
  let response = await cache.match(cacheKey);

  if (!response) {
    const originResponse = await fetch(EPG_URL);
    if (!originResponse.ok) throw new Error(`Failed to fetch EPG: ${originResponse.status}`);

    // 判断是否为 Gzip
    // 逻辑：如果 URL 结尾是 .gz，或者 Header 声明了 gzip，则解压
    const isGzip = EPG_URL.endsWith('.gz') || 
                   (originResponse.headers.get('content-type') || '').includes('gzip') ||
                   (originResponse.headers.get('content-encoding') || '').includes('gzip');

    let stream = originResponse.body;
    if (isGzip) {
       // 使用 Web 标准 API 解压
       stream = originResponse.body.pipeThrough(new DecompressionStream('gzip'));
    }

    const text = await new Response(stream).text();

    // 存入缓存 (缓存解压后的纯文本，提高后续性能)
    response = new Response(text, {
      headers: { 'Cache-Control': `public, max-age=${CACHE_TTL}` }
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return text;
  }
  return response.text();
}

/**
 * 智能查找逻辑
 * 1. 先遍历所有 Channel 进行模糊匹配，找到准确的 ID
 * 2. 再根据 ID 进行极速索引查找节目表
 */
function smartFind(xml, userChannelName, targetDateStr, originUrl) {
  // --- 第一步：匹配频道 ID (Fuzzy Match) ---
  
  // 1. 归一化用户输入的频道名 (去除符号，保留加号，转大写)
  // 例: "cctv-1" -> "CCTV1", "CCTV 5+" -> "CCTV5+"
  const normalizedInput = normalizeName(userChannelName);
  
  let channelID = "";
  let icon = "";
  let realDisplayName = "";

  // 2. 提取 XML 中所有的 <channel> 定义
  // 正则解释：匹配 <channel id="..."> ... <display-name>...</display-name>
  // 这种正则遍历只针对头部元数据，速度很快，不会超时
  const channelRegex = /<channel id="([^"]+)">[\s\S]*?<display-name[^>]*>([^<]+)<\/display-name>[\s\S]*?(?:<icon src="([^"]+)" \/>)?[\s\S]*?<\/channel>/g;
  
  let match;
  while ((match = channelRegex.exec(xml)) !== null) {
    const id = match[1];
    const nameInXml = match[2];
    const iconInXml = match[3] || "";
    
    // 归一化 XML 中的频道名
    const normalizedXmlName = normalizeName(nameInXml);

    // 比较
    if (normalizedInput === normalizedXmlName) {
      channelID = id;
      realDisplayName = nameInXml; // 使用 XML 里真实的名称
      icon = iconInXml;
      break; // 找到后立即停止
    }
  }

  // 如果没找到频道，直接返回
  if (!channelID) {
    return { programs: [], response: {} };
  }

  // --- 第二步：根据 ID 查找节目 (High Performance Index Search) ---
  
  const programs = [];
  const targetDateCompact = targetDateStr.replace(/-/g, ''); // 20231027
  const channelAttr = `channel="${channelID}"`; // 搜索关键词，例如 channel="CCTV1"
  
  let pos = xml.indexOf(channelAttr);
  
  // 循环查找该频道的节目
  while (pos !== -1) {
    // 确定当前这个 channel="..." 所在的 programme 标签范围
    const startTagIndex = xml.lastIndexOf('<programme', pos);
    const endTagIndex = xml.indexOf('</programme>', pos);

    if (startTagIndex !== -1 && endTagIndex !== -1) {
      const progStr = xml.substring(startTagIndex, endTagIndex + 12);
      
      // 提取时间进行比对
      const startMatch = progStr.match(/start="([^"]+)"/);
      
      // 只有当节目日期匹配时，才提取详情 (极大提升性能)
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

    // 继续查找下一个
    pos = xml.indexOf(channelAttr, pos + 1);
  }

  return {
    programs: programs,
    response: {
      code: 200,
      message: "请求成功",
      channel_id: channelID,
      channel_name: realDisplayName, // 返回 XML 中定义的标准名称
      date: targetDateStr,
      url: `${originUrl}/epg/diyp`,
      icon: icon,
      epg_data: programs
    }
  };
}

/**
 * 频道名归一化工具
 * 规则：转大写 -> 移除非数字非字母的字符(保留加号) -> 比较
 * 举例：
 * "CCTV-1" -> "CCTV1"
 * "CCTV 1" -> "CCTV1"
 * "CCTV5+" -> "CCTV5+" (保留加号，防止与 CCTV5 混淆)
 */
function normalizeName(name) {
  if (!name) return "";
  // \w 匹配字母数字下划线，我们额外允许 + 号
  // 也就是：把所有 非(字母、数字、下划线、加号) 的字符替换为空
  return name.toUpperCase().replace(/[^A-Z0-9+]/g, '');
}

// 格式化时间 HH:mm
function formatTime(raw) {
  if (!raw || raw.length < 12) return "";
  return `${raw.substring(8, 10)}:${raw.substring(10, 12)}`;
}