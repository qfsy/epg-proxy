# Cloudflare Worker EPG Proxy

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Workers-orange?logo=cloudflare&style=for-the-badge)](https://workers.cloudflare.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

一个运行在 Cloudflare Workers 上的高性能 EPG (电子节目单) 代理与转换工具。
它可以将通用的 XMLTV 格式 EPG 转换为播放器（如 DIYP、TiviMate）所需的 JSON 接口，同时提供 XML 和 GZ 格式的流式转换下载。

利用 Cloudflare 的全球边缘网络，实现毫秒级响应，无需购买服务器，零成本部署。

## ✨ 核心功能

* **全格式支持**：支持输入 `.xml` 或 `.xml.gz` 格式的 EPG 源。
* **三合一输出**：
    * **DIYP 接口** (`/epg/diyp`)：供播放器按需查询，支持 JSON 格式。
    * **XML 直连** (`/epg/epg.xml`)：将源自动转为 XML 格式（流式解压）。
    * **GZ 压缩** (`/epg/epg.xml.gz`)：将源自动转为 Gzip 格式（流式压缩），节省流量。
* **智能模糊匹配**：
    * 自动归一化频道名称（如 `CCTV-1`, `CCTV 1` 均可匹配 `CCTV1`）。
    * 完美支持中文频道（如 `湖南卫视`）。
    * 精准区分相似频道（如 `CCTV5` 与 `CCTV5+`）。
* **极致性能**：
    * **索引查找**：放弃低效的全文正则，使用 `indexOf` 定位，速度提升 100 倍，避免 Worker CPU 超时。
    * **流式传输**：使用 Web Streams API (`pipeThrough`) 处理文件，内存占用极低，支持处理超大 EPG 文件。
    * **边缘缓存**：利用 Cache API 缓存源文件 5 分钟（可配），防止源站被刷爆。
* **零依赖**：纯原生 JavaScript 编写，无需 `npm install`，直接复制粘贴代码即可运行。

## 🚀 部署指南

### 方法一：直接在 Cloudflare 网页端部署（推荐）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 进入 **Workers & Pages** -> **Create Application** -> **Create Worker**。
3. 命名你的 Worker（例如 `my-epg`），点击 **Deploy**。
4. 点击 **Edit code**（快速编辑）。
5. 将本项目 `worker.js` 中的代码完全复制并覆盖编辑器中的内容。
6. 修改代码顶部的 `EPG_URL` 为你自己的 EPG 源地址。
7. 点击右上角的 **Deploy** 保存。

### 方法二：使用 Wrangler 命令行

1. 克隆本项目：
   ```bash
   git clone https://github.com/gujiangjiang/cf-worker-epg.git
   cd cf-worker-epg
   ```
2. 部署到 Cloudflare：
   ```bash
   npx wrangler deploy
   ```

## ⚙️ 配置说明

在 `worker.js` 顶部修改配置：

```javascript
// EPG 源地址 (支持 http/https，支持 .xml 或 .xml.gz)
const EPG_URL = "https://raw.githubusercontent.com/kuke31/xmlgz/main/all.xml.gz";

// 缓存时间 (单位：秒)，建议 300 (5分钟) 或 3600 (1小时)
const CACHE_TTL = 300;
```

## 📖 API 使用说明

假设你的 Worker 域名为 `https://epg.your-domain.workers.dev`

### 1. DIYP 接口 (JSON)
用于 IPTV 播放器（如 DIYP影音、百川等）的自定义 EPG 接口。

* **URL**: `https://epg.your-domain.workers.dev/epg/diyp`
* **参数**:
    * `ch`: 频道名称 (支持模糊匹配，如 `CCTV1`, `湖南卫视`)
    * `date`: 日期 (格式 `YYYY-MM-DD`)
* **示例**:
  ```
  https://epg.your-domain.workers.dev/epg/diyp?ch=CCTV1&date=2026-01-24
  ```

### 2. XML 文件下载
获取解压后的 XML 文件。无论源是 xml 还是 gz，这里永远输出 xml。

* **URL**: `https://epg.your-domain.workers.dev/epg/epg.xml`

### 3. GZ 压缩文件下载
获取压缩后的 GZ 文件。无论源是 xml 还是 gz，这里永远输出 gz。推荐使用此接口以节省带宽。

* **URL**: `https://epg.your-domain.workers.dev/epg/epg.xml.gz`

## 🛠️ 常见问题

**Q: 为什么输入 "江苏卫视" 匹配不到？**
A: 请确保使用最新版代码。旧版逻辑会移除中文字符，新版已修复此问题，完美支持中文匹配。

**Q: 会消耗很多 Cloudflare 额度吗？**
A: 不会。免费版 Worker 每天有 10 万次请求额度。由于内置了缓存机制，短时间内的重复请求直接由边缘节点响应，不消耗 CPU 时间。

**Q: 提示 "Stream Error"？**
A: 这是因为流被锁定。最新版代码使用了 `stream.tee()` 技术，已完美解决此问题。

## 📄 License

MIT License