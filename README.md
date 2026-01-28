# Cloudflare Worker EPG Proxy

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Workers-orange?logo=cloudflare&style=for-the-badge)](https://workers.cloudflare.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

一个运行在 Cloudflare Workers 上的高性能 EPG (电子节目单) 代理与转换工具。
它可以将通用的 XMLTV 格式 EPG 转换为播放器（如 DIYP、TiviMate）所需的 JSON 接口，同时提供 XML 和 GZ 格式的流式转换下载。

利用 Cloudflare 的全球边缘网络，实现毫秒级响应，无需购买服务器，零成本部署。

## ✨ 核心功能

* **配置灵活**：支持通过环境变量设置 EPG 源，无需修改代码。
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
    * **边缘缓存**：利用 Cache API 缓存源文件，防止源站被刷爆。

## 🚀 部署指南

### 方法一：直接在 Cloudflare 网页端部署（推荐）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 进入 **Workers & Pages** -> **Create Application** -> **Create Worker**。
3. 命名你的 Worker（例如 `my-epg`），点击 **Deploy**。
4. 点击 **Edit code**（快速编辑）。
5. 将本项目 `worker.js` 中的代码完全复制并覆盖编辑器中的内容，点击 **Deploy**。
6. **重要步骤**：转到 Worker 的 **Settings** -> **Variables** 页面，点击 **Add Variable** 添加配置：
   * `EPG_URL`: (必填) 你的 EPG 源地址 (如 `https://example.com/e.xml.gz`)。
   * `CACHE_TTL`: (可选) 缓存时间秒数 (默认 300)。

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
3. 在 Cloudflare 后台设置环境变量，或者在 `wrangler.toml` 中添加 `[vars]` 配置。

## ⚙️ 环境变量说明

| 变量名 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `EPG_URL` | ✅ 是 | - | EPG 文件的直连地址，支持 http/https，支持 .xml 或 .xml.gz |
| `CACHE_TTL` | ❌ 否 | 300 | 源文件在 Cloudflare 边缘节点的缓存时间（秒） |

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
  https://epg.your-domain.workers.dev/epg/diyp?ch=CCTV1&date=2024-01-24
  ```

### 2. XML 文件下载
获取解压后的 XML 文件。无论源是 xml 还是 gz，这里永远输出 xml。

* **URL**: `https://epg.your-domain.workers.dev/epg/epg.xml`

### 3. GZ 压缩文件下载
获取压缩后的 GZ 文件。无论源是 xml 还是 gz，这里永远输出 gz。推荐使用此接口以节省带宽。

* **URL**: `https://epg.your-domain.workers.dev/epg/epg.xml.gz`

**Q: 为什么输入 "江苏卫视" 匹配不到？**
A: 请确保使用最新版代码。旧版逻辑会移除中文字符，新版已修复此问题，完美支持中文匹配。


## 📄 License

MIT License