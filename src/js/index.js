// 文件路径: src/js/index.js
/**
 * EPG Proxy Server (模块化重构版)
 * 入口文件：负责路由分发与环境检查
 * [优化] 增加全局 OPTIONS 处理和路由路径归一化
 */

// 引入 CORS_HEADERS 常量
import { handleDiyp, handleDownload, CORS_HEADERS } from './logic.js';
import { getSetupGuideHTML, getUsageHTML } from '../front/templates.js';

export default {
  async fetch(request, env, ctx) {
    // [优化] 全局处理 CORS 预检请求 (OPTIONS)
    // 浏览器在跨域请求前会发送 OPTIONS，必须直接返回 200 和 CORS 头
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    const url = new URL(request.url);

    // 1. 检查是否配置了主 EPG_URL
    if (!env.EPG_URL) {
      return new Response(getSetupGuideHTML(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // [优化] 路径归一化：移除末尾的斜杠，避免 "/epg/diyp/" 无法匹配的问题
    // 如果路径是 "/" 则保持不变，否则移除末尾斜杠
    const normalizedPath = url.pathname.endsWith('/') && url.pathname.length > 1 
      ? url.pathname.slice(0, -1) 
      : url.pathname;

    try {
      // 2. 路由分发
      switch (normalizedPath) {
        // DIYP 接口
        case '/epg/diyp':
          return handleDiyp(request, url, ctx, env);

        // 超级直播接口
        case '/epg/epginfo':
          return handleDiyp(request, url, ctx, env);
          
        case '/epg/epg.xml':
          // XML 下载
          return handleDownload(ctx, 'xml', env.EPG_URL, env);
          
        case '/epg/epg.xml.gz':
          // GZ 下载
          return handleDownload(ctx, 'gz', env.EPG_URL, env);
          
        default:
          // 默认首页
          return new Response(getUsageHTML(request.url), {
             headers: { "Content-Type": "text/html; charset=utf-8" }
          });
      }
    } catch (e) {
      return new Response(`Server Error: ${e.message}`, { status: 500 });
    }
  },
};