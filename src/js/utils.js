/**
 * 工具函数模块
 * 包含：XML智能匹配、名称归一化、时间格式化等
 */

export function smartFind(xml, userChannelName, targetDateStr, originUrl) {
  const normalizedInput = normalizeName(userChannelName);
  let channelID = "";
  let icon = "";
  let realDisplayName = "";

  // 正则匹配：查找频道定义
  const channelRegex = /<channel id="([^"]+)">[\s\S]*?<display-name[^>]*>([^<]+)<\/display-name>[\s\S]*?(?:<icon src="([^"]+)" \/>)?[\s\S]*?<\/channel>/g;
  
  let match;
  while ((match = channelRegex.exec(xml)) !== null) {
    const id = match[1];
    const nameInXml = match[2];
    const iconInXml = match[3] || "";
    
    // 频道名归一化比较
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
  
  // 使用 indexOf 快速定位节目单，性能优化版
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

export function normalizeName(name) {
  if (!name) return "";
  // 核心模糊匹配：转大写，移除空格、横线、下划线
  return name.trim().toUpperCase().replace(/[\s\-_]/g, '');
}

export function formatTime(raw) {
  if (!raw || raw.length < 12) return "";
  return `${raw.substring(8, 10)}:${raw.substring(10, 12)}`;
}

export function isGzipContent(headers, urlStr) {
  return urlStr.endsWith('.gz') || 
         (headers.get('content-type') || '').includes('gzip') ||
         (headers.get('content-encoding') || '').includes('gzip');
}