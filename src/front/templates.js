/**
 * 前端页面模板模块
 * 存放 HTML 字符串，实现逻辑与视图分离
 */

// 通用样式与脚本 (包含 CSS 和 复制功能的 JS)
const COMMON_ASSETS = `
<style>
  :root {
    --primary: #2563eb;
    --primary-hover: #1d4ed8;
    --bg: #f8fafc;
    --card-bg: #ffffff;
    --text: #1e293b;
    --text-muted: #64748b;
    --border: #e2e8f0;
    --code-bg: #f1f5f9;
    --success: #10b981;
    --success-bg: #ecfdf5;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --border: #334155;
      --code-bg: #020617;
      --success-bg: #064e3b;
    }
  }
  body { 
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
    background: var(--bg); 
    color: var(--text); 
    line-height: 1.6; 
    margin: 0; 
    padding: 20px; 
    display: flex; 
    justify-content: center; 
    align-items: center; 
    min-height: 100vh; 
  }
  .container { background: var(--card-bg); width: 100%; max-width: 800px; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid var(--border); }
  h1 { font-size: 1.8rem; font-weight: 700; margin-bottom: 1rem; color: var(--text); display: flex; align-items: center; gap: 10px; }
  h1 .icon { font-size: 2rem; }
  p { color: var(--text-muted); margin-bottom: 1.5rem; }
  .card { border: 1px solid var(--border); border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; background: var(--bg); }
  .card h3 { margin-top: 0; font-size: 1.1rem; color: var(--text); margin-bottom: 0.5rem; }
  .card p.desc { font-size: 0.9rem; margin-bottom: 1.2rem; }
  
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; background: var(--primary); color: white; margin-left: 8px; }
  .tag.optional { background: var(--text-muted); }
  
  /* === 新增：子标题样式 === */
  .sub-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
      margin-top: 1.2rem;
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
  }
  .sub-label:first-of-type { margin-top: 0; }
  .badge {
      font-size: 0.75rem;
      font-weight: normal;
      background: var(--border);
      color: var(--text-muted);
      padding: 2px 6px;
      border-radius: 4px;
  }

  /* === 核心交互样式 === */
  .code-box { 
    position: relative; /* 关键：作为绝对定位子元素的参考基准 */
    background: var(--code-bg); 
    border: 1px solid var(--border); 
    border-radius: 6px; 
    margin-top: 0.5rem; 
    cursor: pointer; 
    transition: all 0.2s ease;
    overflow: hidden; /* 防止圆角溢出 */
  }
  
  .code-box:hover {
    border-color: var(--primary);
    background-color: rgba(37, 99, 235, 0.05);
  }

  /* 复制成功时的边框颜色 */
  .code-box.copied {
    border-color: var(--success) !important;
  }

  /* 全局通用 code 样式 */
  code { 
    font-family: 'Menlo', 'Monaco', 'Courier New', monospace; 
    font-size: 0.9em; 
    color: var(--primary); 
    background: var(--code-bg); 
    padding: 0.2rem 0.4rem;
    border-radius: 4px;
  }

  /* URL 容器内的 code 样式 */
  .code-box code {
    display: block;          
    background: transparent; 
    padding: 0.8rem 1rem;    
    word-break: break-all;   
    user-select: none;       
    border-radius: 0;
  }

  /* === 新增：状态覆盖层 === */
  /* 这个层平时隐藏，复制成功时显示并覆盖在 URL 上 */
  /* 因为 URL 还在下面占位，所以高度不会变 */
  .status {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: var(--success-bg);
    color: var(--success);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 0.95rem;
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none; /* 让点击穿透（虽然覆盖了，但保持逻辑清晰） */
  }

  /* 激活状态：显示覆盖层 */
  .code-box.copied .status {
    opacity: 1;
  }

  /* === 悬浮提示文字 (Tooltip) === */
  .code-box::after {
    content: "点击复制";
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.75rem;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
    background: var(--card-bg);
    padding: 2px 6px;
    border-radius: 4px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.1);
  }
  .code-box:hover::after {
    opacity: 1;
  }
  /* 复制成功时隐藏 tooltip */
  .code-box.copied::after {
    opacity: 0 !important;
  }

  ul { padding-left: 1.2rem; color: var(--text-muted); }
  li { margin-bottom: 0.5rem; }
  a { color: var(--primary); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .footer { margin-top: 2rem; text-align: center; font-size: 0.85rem; color: var(--text-muted); border-top: 1px solid var(--border); padding-top: 1rem; }
</style>
<script>
  function copyText(box, text) {
    // 防止重复点击
    if (box.classList.contains('copied')) return;

    navigator.clipboard.writeText(text).then(() => {
      // 仅切换 CSS 类，不修改 innerText，保持高度不变
      box.classList.add('copied');
      
      // 1.5秒后恢复
      setTimeout(() => {
        box.classList.remove('copied');
      }, 1500);
    }).catch(err => {
      console.error('Copy failed', err);
      alert('复制失败，请手动复制');
    });
  }
</script>
`;

/**
 * 通用页面布局渲染函数 (内部辅助)
 * * 封装了 HTML 骨架、头部资源引用和页脚逻辑，消除重复代码
 * * @param {string} title 页面标题
 * @param {string} mainContent 主要内容 HTML
 * @param {string} footerExtra 页脚附加信息 (可选)
 */
function renderPage(title, mainContent, footerExtra = "") {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    ${COMMON_ASSETS}
</head>
<body>
    <div class="container">
        ${mainContent}
        <div class="footer">
            Powered by EPG Proxy${footerExtra ? ' &bull; ' + footerExtra : ''}
        </div>
    </div>
</body>
</html>`;
}

/**
 * 生成配置引导页面
 */
export function getSetupGuideHTML() {
  const title = "服务未配置 - EPG Proxy";
  const content = `
        <h1><span class="icon">⚠️</span> 服务尚未配置</h1>
        <p>EPG Proxy 已成功运行，但检测到核心环境变量缺失。请按照以下步骤完成配置。</p>
        
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
 * 生成使用说明页面 (首页)
 */
export function getUsageHTML(baseUrl) {
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

  const title = "EPG Proxy 服务运行中";
  const content = `
        <h1><span class="icon">✅</span> EPG Proxy 服务运行中</h1>
        <p>配置加载成功，主备双源模式就绪。点击下方链接即可复制。</p>
        
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
            <h3>3. XML 下载 (仅主源)</h3>
            <p class="desc">标准 XML 格式，适合不支持接口查询的播放器。</p>
            <div class="code-box" onclick="copyText(this, '${xmlUrl}')">
                <code>${xmlUrl}</code>
                <div class="status">✅ 已复制</div>
            </div>
        </div>
        
        <div class="card">
            <h3>4. GZ 下载 (仅主源)</h3>
            <p class="desc">Gzip 压缩格式，推荐 TiviMate 使用，节省带宽。</p>
            <div class="code-box" onclick="copyText(this, '${gzUrl}')">
                <code>${gzUrl}</code>
                <div class="status">✅ 已复制</div>
            </div>
        </div>`;

  const footerExtra = `Server Time: ${beijingTime.toLocaleString('zh-CN')}`;
  return renderPage(title, content, footerExtra);
}