/**
 * Cloudflare Worker EPG Server (模块化重构版)
 * * 入口文件：负责路由分发与环境检查
 */

// 路径调整：logic.js 在同级目录，templates.js 在上级目录的 front 文件夹中
import { handleDiyp, handleDownload } from './logic.js';
import { getSetupGuideHTML, getUsageHTML } from '../front/templates.js';

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
        // DIYP 接口 (标准)
        case '/epg/diyp':
          return handleDiyp(request, url, ctx, env);

        // 超级直播接口 (新增支持)
        // 很多超级直播源默认寻找 /epginfo 路径，且 JSON 结构与 DIYP 通用
        case '/epg/epginfo':
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