// 文件路径: src/front/layout.js
/**
 * 页面布局模块
 * 负责组装 HTML 骨架，并注入拆分好的样式与脚本
 */

// 引入拆分后的 CSS 和 JS 模块
import { CSS_STYLES } from './css.js';
import { CLIENT_SCRIPTS } from './scripts.js';

/**
 * 通用页面布局渲染函数
 * 封装了 HTML 骨架、头部资源引用和页脚逻辑
 * @param {string} title 页面标题
 * @param {string} mainContent 主要内容 HTML
 * @param {string} footerExtra 页脚附加信息 (可选)
 */
export function renderPage(title, mainContent, footerExtra = "") {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    ${CSS_STYLES}
    ${CLIENT_SCRIPTS}
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