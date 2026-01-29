/**
 * 工具函数模块
 * 包含：XML智能匹配、名称归一化、时间格式化等
 * [优化] 性能极致优化版：移除耗时的全局正则，改用 indexOf 扫描算法
 */

// === 正则常量定义 (仅保留必要的短正则) ===
// 匹配节目信息的特定属性 (在小片段中使用，性能无忧)
const PROG_START_REGEX = /start="([^"]+)"/;
const PROG_STOP_REGEX = /stop="([^"]+)"/;
const PROG_TITLE_REGEX = /<title[^>]*>([\s\S]*?)<\/title>/;
const PROG_DESC_REGEX = /<desc[^>]*>([\s\S]*?)<\/desc>/;
// 匹配 CDATA 标记
const CDATA_REGEX = /<!\[CDATA\[([\s\S]*?)\]\]>/gi;
// 归一化清理正则
const NORMALIZE_REGEX = /[\s\-_]/g;

export function smartFind(xml, userChannelName, targetDateStr, originUrl, currentPath = '/epg/diyp') {
  // 1. 获取频道信息（ID, Name, Icon）
  const channelInfo = findChannelInfo(xml, userChannelName);

  if (!channelInfo) {
    return { programs: [], response: {} };
  }

  // 2. 提取节目单
  return extractPrograms(xml, channelInfo, targetDateStr, originUrl, currentPath);
}

/**
 * 核心查找逻辑：精确匹配优先 -> 模糊匹配兜底
 */
function findChannelInfo(xml, userChannelName) {
  const normalizedInput = normalizeName(userChannelName);
  const escapedName = userChannelName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // --- 阶段 A: 极速精确匹配 (Fast Path) ---
  // 保持不变，这部分已经很快
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

  // --- 阶段 B: 全量遍历模糊匹配 (优化版) ---
  // [重大优化] 放弃使用全局正则 (CHANNEL_REGEX) 遍历大文件。
  // 改用 indexOf 循环定位 <channel> 标签，每次只截取几百字节的片段进行正则匹配。
  // 这种方式不仅内存极其节省，而且避免了正则引擎在大字符串上的回溯性能问题。
  
  let pos = xml.indexOf('<channel');
  while (pos !== -1) {
    const endPos = xml.indexOf('</channel>', pos);
    if (endPos !== -1) {
      // 截取单个频道块 (通常很小，<1KB)
      const channelBlock = xml.substring(pos, endPos + 10);
      
      // 在小块中匹配 display-name
      const nameMatch = channelBlock.match(/<display-name[^>]*>([^<]+)<\/display-name>/);
      if (nameMatch) {
        const nameInXml = nameMatch[1];
        if (normalizeName(nameInXml) === normalizedInput) {
          // 命中！再提取 ID 和 Icon
          const idMatch = channelBlock.match(/id="([^"]+)"/);
          const iconMatch = channelBlock.match(/<icon src="([^"]+)"/);
          return {
            id: idMatch ? idMatch[1] : "", // 理论上必然有 ID
            name: nameInXml,
            icon: iconMatch ? iconMatch[1] : ""
          };
        }
      }
      // 继续找下一个
      pos = xml.indexOf('<channel', endPos);
    } else {
      break;
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
  
  // 使用 indexOf 快速定位节目单 (比正则快很多)
  let pos = xml.indexOf(channelAttr);
  while (pos !== -1) {
    const startTagIndex = xml.lastIndexOf('<programme', pos);
    const endTagIndex = xml.indexOf('</programme>', pos);

    if (startTagIndex !== -1 && endTagIndex !== -1) {
      // 截取单个节目片段
      const progStr = xml.substring(startTagIndex, endTagIndex + 12);
      
      // 使用预编译正则
      const startMatch = progStr.match(PROG_START_REGEX);
      
      // 匹配日期 (利用字符串前缀匹配，避免解析整个日期)
      if (startMatch && startMatch[1].startsWith(targetDateCompact)) {
        const stopMatch = progStr.match(PROG_STOP_REGEX);
        const titleMatch = progStr.match(PROG_TITLE_REGEX);
        const descMatch = progStr.match(PROG_DESC_REGEX);

        programs.push({
          start: formatTime(startMatch[1]),
          end: stopMatch ? formatTime(stopMatch[1]) : "",
          title: titleMatch ? cleanContent(titleMatch[1]) : "节目",
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
 */
function cleanContent(str) {
  if (!str) return "";
  return str.replace(CDATA_REGEX, '$1').trim();
}

export function normalizeName(name) {
  if (!name) return "";
  // 核心模糊匹配：转大写，移除空格、横线、下划线
  return name.trim().toUpperCase().replace(NORMALIZE_REGEX, '');
}

export function formatTime(raw) {
  if (!raw || raw.length < 12) return "";
  return `${raw.substring(8, 10)}:${raw.substring(10, 12)}`;
}

export function isGzipContent(headers, urlStr) {
  if (urlStr.endsWith('.gz')) return true;
  const type = headers.get('content-type') || '';
  if (type.includes('application/gzip') || type.includes('application/x-gzip')) return true;
  return false;
}