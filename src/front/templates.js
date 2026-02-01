// 文件路径: src/front/templates.js
/**
 * 页面内容模板模块
 * 专注于生成具体页面的 HTML 内容结构，不再包含 CSS/JS 实现细节
 */

import { renderPage } from './layout.js';

/**
 * 生成配置引导页面 (当未配置环境变量时显示)
 */
export function getSetupGuideHTML() {
  const title = "服务未配置 - EPG Proxy";
  const content = `
        <div class="header-wrapper">
          <div class="header-main">
            <h1><span class="icon">⚠️</span> 服务尚未配置</h1>
            <p>EPG Proxy 已成功运行，但检测到核心环境变量缺失。请按照以下步骤完成配置。</p>
          </div>
        </div>
        
        <div class="card">
            <h3>第一步：环境配置</h3>
            <p>如果是 Cloudflare Workers，请进入 <strong>Settings</strong> -> <strong>Variables</strong>。<br>如果是 Docker 部署，请检查环境变量设置。</p>
        </div>

        <div class="card">
            <h3>第二步：添加环境变量</h3>
            <p>点击 <strong>Add Variable</strong>，添加以下变量（点击下方卡片可直接复制变量名）：</p>

            <div class="sub-label">
                <span>1. 主源地址变量名</span>
                <span class="tag">必填</span>
            </div>
            <div class="code-box" onclick="copyText(this, 'EPG_URL')">
                <code>EPG_URL</code>
                <div class="status">✅ 已复制</div>
            </div>
            <p class="desc" style="margin-top: 5px; font-size: 0.85rem;">您的主 EPG 文件直连地址 (支持 .xml 或 .xml.gz)</p>

            <div class="sub-label">
                <span>2. 备用源地址变量名</span>
                <span class="tag optional">可选</span>
            </div>
            <div class="code-box" onclick="copyText(this, 'EPG_URL_BACKUP')">
                <code>EPG_URL_BACKUP</code>
                <div class="status">✅ 已复制</div>
            </div>
            <p class="desc" style="margin-top: 5px; font-size: 0.85rem;">主源查询失败时自动切换的备用地址</p>

            <div class="sub-label">
                <span>3. 缓存时间变量名</span>
                <span class="tag optional">可选</span>
            </div>
            <div class="code-box" onclick="copyText(this, 'CACHE_TTL')">
                <code>CACHE_TTL</code>
                <div class="status">✅ 已复制</div>
            </div>
            <p class="desc" style="margin-top: 5px; font-size: 0.85rem;">源文件在边缘节点的缓存时间(秒)，默认 300</p>
        </div>

        <div class="card">
            <h3>第三步：保存并刷新</h3>
            <p>配置生效后刷新此页面即可看到服务状态。</p>
        </div>`;
  
  return renderPage(title, content);
}

/**
 * 生成使用说明页面 (服务正常运行时的主页)
 * [v3.0 更新] 
 * 1. 接收 env 参数以判断是否有备用源
 * 2. 接收 updateTimes 参数以显示最近更新时间
 * [v3.2 更新]
 * 1. 更新底部注释，解释 RAM 和 Cache 的区别
 */
export function getUsageHTML(baseUrl, env, updateTimes) {
  // 获取当前北京时间
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const beijingTime = new Date(utc + (3600000 * 8));
  const yyyy = beijingTime.getFullYear();
  const mm = String(beijingTime.getMonth() + 1).padStart(2, '0');
  const dd = String(beijingTime.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  
  // 构造地址
  const diypBase = `${baseUrl}epg/diyp`;
  const diypExample = `${diypBase}?ch=CCTV1&date=${dateStr}`;
  
  const superLiveBase = `${baseUrl}epg/epginfo`;
  const superLiveExample = `${superLiveBase}?ch=CCTV1&date=${dateStr}`;
  
  const xmlUrl = `${baseUrl}epg/epg.xml`;
  const gzUrl = `${baseUrl}epg/epg.xml.gz`;

  // [v3.0] 判断是否有备用源
  const hasBackup = !!env.EPG_URL_BACKUP;

  // [v3.0] 动态文案
  const descriptionText = hasBackup
    ? "配置加载成功，主备双源模式就绪。点击下方链接即可复制。"
    : "配置加载成功，当前未设置备用源，将采用单源模式运行。点击下方链接即可复制。";

  const downloadNote = hasBackup ? "（仅主源）" : "";

  // [v3.0] 构造状态看板 HTML
  let statusPanelHTML = `
    <div class="status-panel">
      <span class="status-title">数据源状态 (边缘缓存)</span>
      <div class="status-row">
        <span class="status-label">主源</span>
        <span class="status-value">${updateTimes.main}</span>
      </div>`;
  
  if (hasBackup) {
    statusPanelHTML += `
      <div class="status-row">
        <span class="status-label">备用源</span>
        <span class="status-value">${updateTimes.backup}</span>
      </div>`;
  }
  
  // [v3.2] 增加持久化提示
  statusPanelHTML += `
      <div style="margin-top:8px; font-size:0.7rem; color:#94a3b8; border-top:1px dashed var(--border); padding-top:4px;">
        * RAM: 当前节点内存 (实时)<br>
        * Cache: 边缘缓存 (持久)<br>
        * 错误状态仅在 RAM 中暂存
      </div>
    </div>`;

  const title = "EPG Proxy 服务运行中";
  const content = `
        <div class="header-wrapper">
          <div class="header-main">
            <h1><span class="icon">✅</span> EPG Proxy 服务运行中</h1>
            <p>${descriptionText}</p>
          </div>
          ${statusPanelHTML}
        </div>
        
        <div class="card">
            <h3>1. DIYP 接口 (智能聚合)</h3>
            <p class="desc">适用于 DIYP影音、百川、TVBox 等播放器。</p>
            
            <div class="sub-label">
                <span>接口地址</span>
                <span class="badge">配置用</span>
            </div>
            <div class="code-box" onclick="copyText(this, '${diypBase}')">
                <code>${diypBase}</code>
                <div class="status">✅ 已复制</div>
            </div>

            <div class="sub-label">
                <span>测试示例</span>
                <span class="badge">浏览器访问</span>
            </div>
            <div class="code-box" onclick="copyText(this, '${diypExample}')">
                <code>${diypExample}</code>
                <div class="status">✅ 已复制</div>
            </div>
        </div>

        <div class="card">
            <h3>2. 超级直播接口 (epginfo)</h3>
            <p class="desc">适用于 超级直播、友窝 等，兼容 <code>ch/channel/id</code> 参数。</p>
            
            <div class="sub-label">
                <span>接口地址</span>
                <span class="badge">配置用</span>
            </div>
            <div class="code-box" onclick="copyText(this, '${superLiveBase}')">
                <code>${superLiveBase}</code>
                <div class="status">✅ 已复制</div>
            </div>

            <div class="sub-label">
                <span>测试示例</span>
                <span class="badge">浏览器访问</span>
            </div>
            <div class="code-box" onclick="copyText(this, '${superLiveExample}')">
                <code>${superLiveExample}</code>
                <div class="status">✅ 已复制</div>
            </div>
        </div>
        
        <div class="card">
            <h3>3. XML 下载 ${downloadNote}</h3>
            <p class="desc">标准 XML 格式，适合不支持接口查询的播放器。</p>
            <div class="code-box" onclick="copyText(this, '${xmlUrl}')">
                <code>${xmlUrl}</code>
                <div class="status">✅ 已复制</div>
            </div>
        </div>
        
        <div class="card">
            <h3>4. GZ 下载 ${downloadNote}</h3>
            <p class="desc">Gzip 压缩格式，推荐 TiviMate 使用，节省带宽。</p>
            <div class="code-box" onclick="copyText(this, '${gzUrl}')">
                <code>${gzUrl}</code>
                <div class="status">✅ 已复制</div>
            </div>
        </div>`;

  const footerExtra = `Server Time: ${beijingTime.toLocaleString('zh-CN')}`;
  return renderPage(title, content, footerExtra);
}