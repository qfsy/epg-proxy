/**
 * 工具函数模块
 * 包含：XML智能匹配、名称归一化、时间格式化等
 */

export function smartFind(xml, userChannelName, targetDateStr, originUrl, currentPath = '/epg/diyp') {
  // 1. 获取频道信息（ID, Name, Icon）
  // 采用 "精确优先 + 性能优先" 策略
  const channelInfo = findChannelInfo(xml, userChannelName);

  if (!channelInfo) {
    return { programs: [], response: {} };
  }

  // 2. 提取节目单（复用逻辑）
  return extractPrograms(xml, channelInfo, targetDateStr, originUrl, currentPath);
}

/**
 * 核心查找逻辑：精确匹配优先 -> 模糊匹配兜底
 */
function findChannelInfo(xml, userChannelName) {
  const normalizedInput = normalizeName(userChannelName);
  const escapedName = userChannelName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // --- 阶段 A: 极速精确匹配 (Fast Path) ---
  try {
    const exactRegex = new RegExp(`<display-name[^>]*>\\s*${escapedName}\\s*<\\/display-name>`, 'i');
    const exactMatch = xml.match(exactRegex);

    if (exactMatch) {
      const nameIndex = exactMatch.index;
      const channelStartIndex = xml.lastIndexOf('<channel', nameIndex);
      
      if (channelStartIndex !== -1) {
        const channelEndIndex = xml.indexOf('</channel>', nameIndex);
        if (channelEndIndex !== -1) {
          const channelBlock = xml.substring(channelStartIndex, channelEndIndex + 10);
          const idMatch = channelBlock.match(/id="([^"]+)"/);
          const iconMatch = channelBlock.match(/<icon src="([^"]+)"/);

          if (idMatch) {
            return {
              id: idMatch[1],
              name: userChannelName.trim(),
              icon: iconMatch ? iconMatch[1] : ""
            };
          }
        }
      }
    }
  } catch (e) {
    console.error("Fast path error:", e);
  }

  // --- 阶段 B: 全量遍历模糊匹配 (Slow Path) ---
  const channelRegex = /<channel id="([^"]+)">[\s\S]*?<display-name[^>]*>([^<]+)<\/display-name>[\s\S]*?(?:<icon src="([^"]+)" \/>)?[\s\S]*?<\/channel>/g;
  let match;

  while ((match = channelRegex.exec(xml)) !== null) {
    const nameInXml = match[2];
    
    if (normalizeName(nameInXml) === normalizedInput) {
      return {
        id: match[1],
        name: nameInXml,
        icon: match[3] || ""
      };
    }
  }

  return null;
}

/**
 * 节目单提取逻辑
 */
function extractPrograms(xml, channelInfo, targetDateStr, originUrl, currentPath) {
  const programs = [];
  const targetDateCompact = targetDateStr.replace(/-/g, '');
  const channelAttr = `channel="${channelInfo.id}"`;
  
  // 使用 indexOf 快速定位节目单
  let pos = xml.indexOf(channelAttr);
  while (pos !== -1) {
    const startTagIndex = xml.lastIndexOf('<programme', pos);
    const endTagIndex = xml.indexOf('</programme>', pos);

    if (startTagIndex !== -1 && endTagIndex !== -1) {
      const progStr = xml.substring(startTagIndex, endTagIndex + 12);
      const startMatch = progStr.match(/start="([^"]+)"/);
      
      // 匹配日期
      if (startMatch && startMatch[1].startsWith(targetDateCompact)) {
        const stopMatch = progStr.match(/stop="([^"]+)"/);
        const titleMatch = progStr.match(/<title[^>]*>([\s\S]*?)<\/title>/); // 优化正则以支持换行
        const descMatch = progStr.match(/<desc[^>]*>([\s\S]*?)<\/desc>/); // 确保捕获 desc

        programs.push({
          start: formatTime(startMatch[1]),
          end: stopMatch ? formatTime(stopMatch[1]) : "",
          title: titleMatch ? cleanContent(titleMatch[1]) : "节目",
          // 关键修复：保留 desc 并清洗 CDATA
          desc: descMatch ? cleanContent(descMatch[1]) : "" 
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
      channel_id: channelInfo.id,
      channel_name: channelInfo.name,
      date: targetDateStr,
      url: `${originUrl}${currentPath}`,
      icon: channelInfo.icon,
      epg_data: programs
    }
  };
}

/**
 * 清洗 XML 内容：去除 CDATA 标签，去除首尾空格
 * 很多 EPG 的 desc 包含 <![CDATA[...]]>，如果不去除，播放器可能不显示
 */
function cleanContent(str) {
  if (!str) return "";
  return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
}

export function normalizeName(name) {
  if (!name) return "";
  // 核心模糊匹配：转大写，移除空格、横线、下划线
  // 注意：保留了 "+" 号，因此 "CCTV5" 和 "CCTV5+" 会被视为不同频道，满足精确性要求
  // "CCTV-1" -> "CCTV1", "CCTV 1" -> "CCTV1"
  return name.trim().toUpperCase().replace(/[\s\-_]/g, '');
}

export function formatTime(raw) {
  if (!raw || raw.length < 12) return "";
  return `${raw.substring(8, 10)}:${raw.substring(10, 12)}`;
}

export function isGzipContent(headers, urlStr) {
  // 1. 如果 URL 以 .gz 结尾，认为是 Gzip 文件
  if (urlStr.endsWith('.gz')) return true;

  // 2. 如果 Content-Type 明确指示是 Gzip
  const type = headers.get('content-type') || '';
  if (type.includes('application/gzip') || type.includes('application/x-gzip')) return true;

  // 3. 注意：不检测 Content-Encoding。
  // 因为 Cloudflare Worker 的 fetch 会自动处理 Transport Layer 的解压。
  // 如果源是 XML 但传输用了 gzip，fetch 拿到的 body 已经是解压后的文本，我们不应该再次解压。
  return false;
}