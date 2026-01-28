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
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --border: #334155;
      --code-bg: #020617;
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
    align-items: center; /* 修复底部大片留白：让内容垂直居中 */
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
  
  /* 代码块与复制按钮样式 */
  .code-box { display: flex; align-items: center; background: var(--code-bg); padding: 0.5rem; border-radius: 6px; border: 1px solid var(--border); margin-top: 0.5rem; }
  code { background: transparent; padding: 0; flex: 1; font-family: 'Menlo', 'Monaco', 'Courier New', monospace; font-size: 0.9em; word-break: break-all; color: var(--primary); overflow-x: auto; margin-right: 10px; }
  .btn-copy { background: white; border: 1px solid var(--border); padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; color: var(--text); transition: all 0.2s; white-space: nowrap; }
  .btn-copy:hover { border-color: var(--primary); color: var(--primary); }
  .btn-copy.copied { background: #10b981; color: white; border-color: #10b981; }
  @media (prefers-color-scheme: dark) {
    .btn-copy { background: var(--card-bg); }
  }

  ul { padding-left: 1.2rem; color: var(--text-muted); }
  li { margin-bottom: 0.5rem; }
  a { color: var(--primary); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .footer { margin-top: 2rem; text-align: center; font-size: 0.85rem; color: var(--text-muted); border-top: 1px solid var(--border); padding-top: 1rem; }
</style>
<script>
  function copyText(btn, text) {
    navigator.clipboard.writeText(text).then(() => {
      const originalText = btn.innerText;
      btn.innerText = '已复制';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerText = originalText;
        btn.classList.remove('copied');
      }, 2000);
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
        <p>配置加载成功，主备双源模式就绪。您可以将以下接口地址填入您的播放器。</p>
        
        <div class="card">
            <h3>1. DIYP 接口 (智能聚合)</h3>
            <p>支持主备源自动切换。优先查主源，无结果自动查备源。</p>
            <div class="code-box">
                <code>${diypUrl}</code>
                <button class="btn-copy" onclick="copyText(this, '${diypUrl}')">复制</button>
            </div>
        </div>
        
        <div class="card">
            <h3>2. XML 下载 (仅主源)</h3>
            <p>提供解压后的标准 XML 格式，适合不支持 DIYP 接口的播放器。</p>
            <div class="code-box">
                <code>${xmlUrl}</code>
                <button class="btn-copy" onclick="copyText(this, '${xmlUrl}')">复制</button>
            </div>
        </div>
        
        <div class="card">
            <h3>3. GZ 下载 (仅主源)</h3>
            <p>提供压缩格式，节省带宽，推荐 TiviMate 等支持 GZ 的播放器使用。</p>
            <div class="code-box">
                <code>${gzUrl}</code>
                <button class="btn-copy" onclick="copyText(this, '${gzUrl}')">复制</button>
            </div>
        </div>

        <div class="footer">
            Powered by Cloudflare Workers &bull; Server Time: ${beijingTime.toLocaleString('zh-CN')}
        </div>
    </div>
</body>
</html>`;
}