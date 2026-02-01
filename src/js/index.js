// 文件路径: src/js/index.js
/**
 * EPG Proxy Server (模块化重构版)
 * 入口文件：负责路由分发与环境检查
 * [优化] 增加全局 OPTIONS 处理和路由路径归一化
 * [v3.0] 引入 getLastUpdateTimes 以支持前端显示
 */

// 引入 CORS_HEADERS 常量和新的时间获取函数
import { handleDiyp, handleDownload, CORS_HEADERS, getLastUpdateTimes } from './logic.js';
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

    // [优化 v2.3] 路径归一化：使用正则移除末尾所有的斜杠
    // 例如 "/epg/diyp/" 或 "/epg/diyp//" 都会变成 "/epg/diyp"
    const normalizedPath = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');

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
          // [v3.0] 传递 env 和时间信息给前端模板
          return new Response(getUsageHTML(request.url, env, getLastUpdateTimes(env)), {
             headers: { "Content-Type": "text/html; charset=utf-8" }
          });
      }
    } catch (e) {
      return new Response(`Server Error: ${e.message}`, { status: 500 });
    }
  },
};