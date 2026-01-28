/**
 * Cloudflare Worker EPG Server
 * 功能：下载 Gzip XML -> 解压 -> 解析 -> 按需筛选 JSON
 */

import { XMLParser } from 'fast-xml-parser';

// 配置
const EPG_URL = "https://raw.githubusercontent.com/kuke31/xmlgz/main/all.xml.gz";
const CACHE_TTL = 300; // 缓存时间 300秒 (5分钟)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 路由匹配: 只处理 /epg/diyp
    if (url.pathname === '/epg/diyp') {
      return handleDiyp(request, url);
    }

    // 默认返回 404
    return new Response('Not Found', { status: 404 });
  },
};

async function handleDiyp(request, url) {
  const ch = url.searchParams.get('ch');
  const date = url.searchParams.get('date'); // 格式 2023-10-27

  if (!ch || !date) {
    return new Response(JSON.stringify({ code: 400, message: "Missing 'ch' or 'date' parameters" }), {
      headers: { 'content-type': 'application/json' }
    });
  }

  try {
    // 1. 获取 EPG 数据 (带缓存机制)
    const tvData = await fetchEPGData(request);
    
    // 2. 筛选节目
    const result = findPrograms(tvData, ch, date, url.origin);

    if (!result.programs || result.programs.length === 0) {
      return new Response(JSON.stringify({ code: 404, message: "No programs found" }), {
        headers: { 'content-type': 'application/json' },
        status: 404
      });
    }

    // 3. 返回结果
    return new Response(JSON.stringify(result.response), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*' // 允许跨域
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ code: 500, message: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}

// 获取并解析 XML 数据
async function fetchEPGData(request) {
  const cache = caches.default;
  const cacheKey = new Request(EPG_URL, { method: "GET" }); // 使用源 URL 作为缓存键

  // 1. 尝试从 Cloudflare 缓存获取
  let response = await cache.match(cacheKey);

  let xmlText = "";

  if (!response) {
    console.log("Cache miss, fetching from origin...");
    // 2. 缓存未命中，下载文件
    const originResponse = await fetch(EPG_URL);
    
    if (!originResponse.ok) throw new Error("Failed to fetch EPG xml");

    // 3. 处理 Gzip 解压
    // 注意：如果是 .gz 文件，Response body 是个流，我们需要通过 DecompressionStream 解压
    // 如果服务器 header 已经声明了 gzip，fetch 会自动解压，但 raw git 文件通常被视为二进制
    let decompressedStream = originResponse.body;
    if (EPG_URL.endsWith('.gz') || originResponse.headers.get('content-type') === 'application/gzip') {
       decompressedStream = originResponse.body.pipeThrough(new DecompressionStream('gzip'));
    }

    // 读取解压后的文本
    xmlText = await new Response(decompressedStream).text();

    // 4. 存入缓存 (设置 Cache-Control)
    // 我们缓存的是解压后的纯文本，避免每次都解压，节省 CPU
    const responseToCache = new Response(xmlText, {
      headers: { 
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
        'Content-Type': 'application/xml'
      }
    });
    // 使用 ctx.waitUntil 可能会导致此处逻辑复杂，直接 put 简单
    await cache.put(cacheKey, responseToCache.clone());
  } else {
    console.log("Cache hit");
    xmlText = await response.text();
  }

  // 5. 解析 XML
  const parser = new XMLParser({
    ignoreAttributes: false, // 读取属性 (id, start, stop)
    attributeNamePrefix: "", // 不使用前缀
    isArray: (name, jpath, isLeafNode, isAttribute) => { 
        // 强制 channel 和 programme 为数组，防止只有一个节目时变成对象
        return name === "channel" || name === "programme"; 
    }
  });

  return parser.parse(xmlText);
}

// 核心筛选逻辑
function findPrograms(tvData, channelName, dateStr, originUrl) {
  const tv = tvData.tv;
  if (!tv) throw new Error("Invalid XML format");

  let channelID = "";
  let icon = "";
  let channelNameFound = "";

  // 1. 查找频道 ID
  // Go代码逻辑：遍历 Channels 找到对应 DisplayName
  const targetChannel = tv.channel?.find(c => c["display-name"] === channelName);
  
  if (targetChannel) {
    channelID = targetChannel.id;
    icon = targetChannel.icon?.src || ""; // icon 可能是对象也可能是属性，根据 fast-xml-parser 行为调整
    channelNameFound = targetChannel["display-name"];
  } else {
    // 如果找不到频道，直接返回空
    return { programs: [] };
  }

  // 2. 格式化目标日期用于比较 (Input: 2023-10-27 -> Compare: 20231027)
  const targetDateCompact = dateStr.replace(/-/g, ''); 

  // 3. 筛选节目
  const programs = [];
  
  if (tv.programme) {
    for (const p of tv.programme) {
      if (p.channel === channelID) {
        // XML 时间格式通常是: 20231027120000 +0800
        // 我们只需要前8位判断日期
        const pStartRaw = p.start; // "20231027183200 +0800"
        const pDatePart = pStartRaw.substring(0, 8);

        if (pDatePart === targetDateCompact) {
          // 格式化时间 HH:mm
          const startTime = formatTime(p.start);
          const endTime = formatTime(p.stop);

          programs.push({
            start: startTime,
            end: endTime,
            title: p.title,
            desc: p.desc || ""
          });
        }
      }
    }
  }

  return {
    programs: programs,
    response: {
      code: 200,
      message: "请求成功",
      channel_id: channelID,
      channel_name: channelNameFound,
      date: dateStr,
      url: `${originUrl}/epg/diyp`, // 动态获取 Worker 的域名
      icon: icon,
      epg_data: programs
    }
  };
}

// 辅助函数：从 "20231027183200 +0800" 提取 "18:32"
function formatTime(raw) {
  if (!raw || raw.length < 12) return "";
  const hour = raw.substring(8, 10);
  const minute = raw.substring(10, 12);
  return `${hour}:${minute}`;
}