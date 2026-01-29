// 文件路径: src/front/scripts.js
/**
 * 前端交互脚本模块
 * 定义页面所需的 JavaScript 逻辑 (如点击复制功能)
 */
export const CLIENT_SCRIPTS = `
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