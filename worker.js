/**
 * Cloudflare Worker EPG Server (模块化重构版)
 * * 入口文件：负责路由分发与环境检查
 */

import { handleDiyp, handleDownload } from './src/js/logic.js';
import { getSetupGuideHTML, getUsageHTML } from './src/front/templates.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 检查是否配置了主 EPG_URL
    // 如果未配置，直接返回美化后的引导页面
    if (!env.EPG_URL) {
      return new Response(getSetupGuideHTML(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    try {
      // 2. 路由分发
      switch (url.pathname) {
        case '/epg/diyp':
          return handleDiyp(request, url, ctx, env);
          
        case '/epg/epg.xml':
          // XML 下载：仅使用主源
          return handleDownload(ctx, 'xml', env.EPG_URL, env);
          
        case '/epg/epg.xml.gz':
          // GZ 下载：仅使用主源
          return handleDownload(ctx, 'gz', env.EPG_URL, env);
          
        default:
          // 默认首页：显示运行状态和使用说明
          return new Response(getUsageHTML(request.url), {
             headers: { "Content-Type": "text/html; charset=utf-8" }
          });
      }
    } catch (e) {
      return new Response(`Server Error: ${e.message}`, { status: 500 });
    }
  },
};