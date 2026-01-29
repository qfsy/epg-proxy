// 文件路径: src/front/css.js
/**
 * 前端样式模块
 * 定义页面所有的 CSS 样式，支持浅色/深色模式
 */
export const CSS_STYLES = `
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
  
  /* === 子标题样式 === */
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

  /* === 状态覆盖层 === */
  /* 这个层平时隐藏，复制成功时显示并覆盖在 URL 上 */
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
    pointer-events: none;
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
`;