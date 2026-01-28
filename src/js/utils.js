/**
 * 工具函数模块
 * 包含：XML智能匹配、名称归一化、时间格式化等
 */

export function smartFind(xml, userChannelName, targetDateStr, originUrl, currentPath = '/epg/diyp') {
  const normalizedInput = normalizeName(userChannelName);
  const upperInput = userChannelName.trim().toUpperCase(); // 用于精确匹配比较
  
  let channelID = "";
  let icon = "";
  let realDisplayName = "";

  // 正则匹配：查找频道定义
  // 匹配 <channel id="..."> ... <display-name>...</display-name>
  const channelRegex = /<channel id="([^"]+)">[\s\S]*?<display-name[^>]*>([^<]+)<\/display-name>[\s\S]*?(?:<icon src="([^"]+)" \/>)?[\s\S]*?<\/channel>/g;
  
  let match;
  let bestMatch = null;

  // 1. 遍历所有频道，寻找最佳匹配 (精确匹配 > 模糊匹配)
  while ((match = channelRegex.exec(xml)) !== null) {
    const id = match[1];
    const nameInXml = match[2];
    const iconInXml = match[3] || "";
    
    // 检查是否为精确匹配 (忽略大小写，但字符完全一致)
    // 例如：输入 "CCTV1"，XML中有 "CCTV1" -> 命中精确匹配
    if (nameInXml.trim().toUpperCase() === upperInput) {
      bestMatch = { id, name: nameInXml, icon: iconInXml };
      break; // 找到最完美的匹配，直接结束循环
    }
    
    // 检查是否为模糊匹配
    // 例如：输入 "CCTV1"，XML中有 "CCTV-1" -> 命中模糊匹配
    // 逻辑：如果还没有找到任何匹配，就先暂存这个模糊匹配结果；继续往后找，万一后面有精确匹配的呢？
    if (!bestMatch && normalizeName(nameInXml) === normalizedInput) {
      bestMatch = { id, name: nameInXml, icon: iconInXml };
    }
  }

  // 如果遍历完连模糊匹配都没找到，返回空
  if (!bestMatch) return { programs: [], response: {} };

  channelID = bestMatch.id;
  realDisplayName = bestMatch.name;
  icon = bestMatch.icon;

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
      url: `${originUrl}${currentPath}`, // 修复：使用动态路径
      icon: icon,
      epg_data: programs
    }
  };
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