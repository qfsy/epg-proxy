/**
 * 前端页面模板模块
 * 存放 HTML 字符串，实现逻辑与视图分离
 */

// 通用样式与头部
const COMMON_STYLE = `
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
  .card h3 { margin-top: 0; font-size: 1.1rem; color: var(--text); }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; background: var(--primary); color: white; margin-left: 8px; }
  .tag.optional { background: var(--text-muted); }
  
  /* 优化后的代码块样式：整体可点击 */
  .code-box { 
    position: relative;
    background: var(--code-bg); 
    border: 1px solid var(--border); 
    border-radius: 6px; 
    margin-top: 0.5rem; 
    cursor: pointer; 
    transition: all 0.2s ease;
    overflow: hidden;
  }
  
  .code-box:hover {
    border-color: var(--primary);
    background-color: rgba(37, 99, 235, 0.05);
  }

  .code-box.copied {
    border-color: var(--success) !important;
    background-color: var(--success-bg) !important;
  }
  
  /* 状态变化时针对内部 code 的样式覆盖 */
  .code-box.copied code {
    color: var(--success);
    font-weight: bold;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  /* 全局通用 code 样式 (修复换行问题) */
  code { 
    font-family: 'Menlo', 'Monaco', 'Courier New', monospace; 
    font-size: 0.9em; 
    color: var(--primary); 
    background: var(--code-bg); /* 给行内代码加个背景 */
    padding: 0.2rem 0.4rem;     /* 行内小间距 */
    border-radius: 4px;
  }

  /* URL 复制框内的 code 特有样式 (恢复块级显示) */
  .code-box code {
    display: block;          /* 独占一行 */
    background: transparent; /* 背景由 box 接管 */
    padding: 0.8rem 1rem;    /* 大间距 */
    word-break: break-all;   /* URL 强制断行 */
    user-select: none;       /* 防止点击时选中文字 */
    border-radius: 0;
  }

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
    if (box.classList.contains('copied')) return;

    const codeElem = box.querySelector('code');
    const originalText = codeElem.innerText;

    navigator.clipboard.writeText(text).then(() => {
      box.classList.add('copied');
      codeElem.innerText = "✅ 已复制";
      
      setTimeout(() => {
        box.classList.remove('copied');
        codeElem.innerText = originalText;
      }, 1500);
    }).catch(err => {
      console.error('Copy failed', err);
      alert('复制失败，请手动复制');
    });
  }
</script>
`;

export function getSetupGuideHTML() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>服务未配置 - EPG Proxy</title>
    ${COMMON_STYLE}
</head>
<body>
    <div class="container">
        <h1><span class="icon">⚠️</span> 服务尚未配置</h1>
        <p>EPG Proxy Worker 已成功运行，但检测到核心环境变量缺失。请按照以下步骤完成配置。</p>
        
        <div class="card">
            <h3>第一步：打开 Cloudflare 设置</h3>
            <p>登录 Cloudflare Dashboard，进入您的 Worker 项目，点击 <strong>Settings (设置)</strong> -> <strong>Variables (变量)</strong>。</p>
        </div>

        <div class="card">
            <h3>第二步：添加环境变量</h3>
            <p>点击 <strong>Add Variable</strong>，填入以下信息：</p>
            <ul>
                <li><code>EPG_URL</code> <span class="tag">必填</span> <br> 您的主 EPG 源地址 (支持 .xml 或 .xml.gz)。</li>
                <li><code>EPG_URL_BACKUP</code> <span class="tag optional">可选</span> <br> 备用 EPG 源地址 (主源失败时自动切换)。</li>
                <li><code>CACHE_TTL</code> <span class="tag optional">可选</span> <br> 缓存时间(秒)，默认 300。</li>
            </ul>
        </div>

        <div class="card">
            <h3>第三步：保存并刷新</h3>
            <p>点击 <strong>Save and Deploy</strong>，配置生效后刷新此页面即可看到服务状态。</p>
        </div>
        
        <div class="footer">
            Powered by Cloudflare Workers &bull; EPG Proxy
        </div>
    </div>
</body>
</html>`;
}

export function getUsageHTML(baseUrl) {
  // 获取当前北京时间
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const beijingTime = new Date(utc + (3600000 * 8));
  const yyyy = beijingTime.getFullYear();
  const mm = String(beijingTime.getMonth() + 1).padStart(2, '0');
  const dd = String(beijingTime.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  
  const diypUrl = `${baseUrl}epg/diyp?ch=CCTV1&date=${dateStr}`;
  const superLiveUrl = `${baseUrl}epg/epginfo?ch=CCTV1&date=${dateStr}`;
  const xmlUrl = `${baseUrl}epg/epg.xml`;
  const gzUrl = `${baseUrl}epg/epg.xml.gz`;

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EPG 服务运行中</title>
    ${COMMON_STYLE}
</head>
<body>
    <div class="container">
        <h1><span class="icon">✅</span> EPG 服务运行中</h1>
        <p>配置加载成功，主备双源模式就绪。点击下方链接即可复制。</p>
        
        <div class="card">
            <h3>1. DIYP 接口 (智能聚合)</h3>
            <p>适用于 DIYP影音、百川 等播放器。</p>
            <div class="code-box" onclick="copyText(this, '${diypUrl}')">
                <code>${diypUrl}</code>
            </div>
        </div>

        <div class="card">
            <h3>2. 超级直播接口 (epginfo)</h3>
            <p>适用于 超级直播、友窝 等，兼容 <code>ch/channel/id</code> 参数。</p>
            <div class="code-box" onclick="copyText(this, '${superLiveUrl}')">
                <code>${superLiveUrl}</code>
            </div>
        </div>
        
        <div class="card">
            <h3>3. XML 下载 (仅主源)</h3>
            <p>标准 XML 格式，适合不支持接口查询的播放器。</p>
            <div class="code-box" onclick="copyText(this, '${xmlUrl}')">
                <code>${xmlUrl}</code>
            </div>
        </div>
        
        <div class="card">
            <h3>4. GZ 下载 (仅主源)</h3>
            <p>Gzip 压缩格式，推荐 TiviMate 使用，节省带宽。</p>
            <div class="code-box" onclick="copyText(this, '${gzUrl}')">
                <code>${gzUrl}</code>
            </div>
        </div>

        <div class="footer">
            Powered by Cloudflare Workers &bull; Server Time: ${beijingTime.toLocaleString('zh-CN')}
        </div>
    </div>
</body>
</html>`;
}