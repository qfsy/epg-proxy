// 文件路径: src/front/scripts.js
/**
 * 前端交互脚本模块
 * 定义页面所需的 JavaScript 逻辑 (如点击复制功能)
 * [v2.6 优化] 增加非安全上下文(HTTP)下的复制兼容性支持
 */
export const CLIENT_SCRIPTS = `
<script>
  /**
   * 降级复制策略：使用 document.execCommand
   * 适用于不支持 Clipboard API 的环境 (如 HTTP 非 Localhost)
   */
  function copyTextFallback(text) {
    return new Promise((resolve, reject) => {
      try {
        var textArea = document.createElement("textarea");
        textArea.value = text;
        
        // 确保元素不可见但可选中，防止页面抖动
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        var successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (successful) {
          resolve();
        } else {
          reject(new Error('execCommand returned false'));
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  function copyText(box, text) {
    // 防止重复点击
    if (box.classList.contains('copied')) return;

    // 1. 判断环境优先使用 Modern API (navigator.clipboard)
    // 2. 如果在 HTTP 环境下 navigator.clipboard 为 undefined，则降级使用 fallback
    const copyPromise = (navigator.clipboard && navigator.clipboard.writeText)
      ? navigator.clipboard.writeText(text)
      : copyTextFallback(text);

    copyPromise.then(() => {
      // 仅切换 CSS 类，不修改 innerText，保持高度不变
      box.classList.add('copied');
      
      // 1.5秒后恢复
      setTimeout(() => {
        box.classList.remove('copied');
      }, 1500);
    }).catch(err => {
      console.error('Copy failed', err);
      // 只有在两种方式都失败时才弹窗
      alert('复制失败，请手动复制:\\n' + text);
    });
  }
</script>
`;
