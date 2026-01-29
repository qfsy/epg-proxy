# EPG Proxy

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Workers-orange?logo=cloudflare&style=for-the-badge)](https://workers.cloudflare.com/)
[![Docker Image](https://img.shields.io/badge/Docker-Image-blue?logo=docker&style=for-the-badge)](https://github.com/gujiangjiang/epg-proxy/pkgs/container/epg-proxy)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

一个高性能 EPG (电子节目单) 代理与转换工具，支持 Cloudflare Workers 与 Docker 部署。
它可以将通用的 XMLTV 格式 EPG 转换为播放器（如 DIYP、超级直播、TiviMate）所需的 JSON 接口，同时提供 XML 和 GZ 格式的流式转换下载。

利用 Cloudflare 的全球边缘网络，实现毫秒级响应，无需购买服务器，零成本部署。也支持 Docker 本地/VPS 私有化部署。

## ✨ 核心功能

* **配置灵活**：支持通过环境变量设置 EPG 源，无需修改代码。
* **全格式支持**：支持输入 `.xml` 或 `.xml.gz` 格式的 EPG 源。
* **四合一输出**：
    * **DIYP 接口** (`/epg/diyp`)：标准 JSON 格式。
    * **超级直播接口** (`/epg/epginfo`)：**[新增]** 完美适配超级直播、友窝，兼容 `channel`、`id` 等参数。
    * **XML 直连** (`/epg/epg.xml`)：将源自动转为 XML 格式（流式解压）。**（仅主源）**
    * **GZ 压缩** (`/epg/epg.xml.gz`)：将源自动转为 Gzip 格式（流式压缩），节省流量。**（仅主源）**
* **智能模糊匹配**：
    * 自动归一化频道名称（如 `CCTV-1`, `CCTV 1` 均可匹配 `CCTV1`）。
    * 完美支持中文频道（如 `湖南卫视`）。
    * 精准区分相似频道（如 `CCTV5` 与 `CCTV5+`）。
* **极致性能**：
    * **索引查找**：放弃低效的全文正则，使用 `indexOf` 定位，速度提升 100 倍，避免 Worker CPU 超时。
    * **流式传输**：使用 Web Streams API (`pipeThrough`) 处理文件，内存占用极低，支持处理超大 EPG 文件。
    * **边缘缓存**：利用 Cache API 缓存源文件，防止源站被刷爆。
* **人性化交互**：
    * **点击即复制**：首页接口地址点击即可自动复制到剪贴板，并提供直观的“已复制”反馈。
    * 优化的 UI 设计，适配暗黑模式与各种屏幕尺寸。

## 🚀 部署指南

### 方法一：GitHub 自动部署 (Cloudflare 集成 - 推荐)

利用 Cloudflare 原生集成的 CI/CD 功能，适合初次使用者。

1. **Fork 本项目**：将代码 Fork 到你自己的 GitHub 仓库。
2. **连接 Cloudflare**：
   - 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
   - 进入 **Workers & Pages** -> **Create Application** -> **Connect to Git**。
   - 选择你刚才 Fork 的仓库，点击 **Begin setup**。
3. **配置构建**：
   - Cloudflare 会自动检测到 `wrangler.toml`。
   - 保持默认设置，点击 **Save and Deploy**。
4. **设置变量**：
   - 部署完成后，进入该 Worker 的 **Settings** -> **Variables**。
   - 添加核心变量（见下方环境变量说明）。
   - 重新部署一次（或在 Deployments 选项卡中 Retry）以使变量生效。
5. **后续更新**：以后只需修改 GitHub 代码并推送，Cloudflare 会自动触发重新部署。

### 方法二：Docker 部署 (本地/VPS 自托管)

适合需要突破 Cloudflare 限制或在内网 NAS 上运行的用户。

1. **拉取镜像**：
   ```bash
   docker pull ghcr.io/gujiangjiang/epg-proxy:latest
   ```

2. **运行容器 (Docker CLI)**：
   ```bash
   docker run -d \
     --name epg-proxy \
     --restart unless-stopped \
     -p 8787:8787 \
     -e EPG_URL="http://example.com/e.xml" \
     -e EPG_URL_BACKUP="http://example.com/backup.xml" \
     -e CACHE_TTL=300 \
     ghcr.io/gujiangjiang/epg-proxy:latest
   ```

   **或者使用 Docker Compose (推荐)**：
   创建 `docker-compose.yml` 文件并填入以下内容：
   ```yaml
   version: '3'
   services:
     epg-proxy:
       image: ghcr.io/gujiangjiang/epg-proxy:latest
       container_name: epg-proxy
       restart: unless-stopped
       ports:
         - "8787:8787"
       environment:
         - EPG_URL=http://example.com/e.xml
         - EPG_URL_BACKUP=http://example.com/backup.xml
         - CACHE_TTL=300
   ```
   然后运行：`docker-compose up -d`

3. **访问服务**：
   - 首页：`http://localhost:8787`
   - DIYP 接口：`http://localhost:8787/epg/diyp`
   -超级直播接口：`http://localhost:8787/epg/epginfo`

### 方法三：GitHub Actions 自动部署 (高级)

利用本项目内置的 GitHub Actions 工作流，通过 Token 部署。

1. **获取 Cloudflare 密钥**：
   - `CF_API_TOKEN`: 在 [Cloudflare Profile](https://dash.cloudflare.com/profile/api-tokens) 创建 Token，模板选择 "Edit Cloudflare Workers"。
   - `CF_ACCOUNT_ID`: 在 Cloudflare Dashboard 右侧边栏找到 "Account ID"。
2. **配置 GitHub Secrets**：
   - 进入你的 GitHub 仓库，点击 **Settings** -> **Secrets and variables** -> **Actions**。
   - 点击 **New repository secret**，添加以下变量：
     - `CF_API_TOKEN` (必填)
     - `CF_ACCOUNT_ID` (必填)
     - `EPG_URL` (必填): 你的主 EPG 源地址。
     - `EPG_URL_BACKUP` (可选): 备用源。
     - `CACHE_TTL` (可选): 缓存时间。
3. **触发部署**：
   - 配置完成后，任意推送代码或在 Actions 页面手动触发，即可自动部署。

### 方法四：使用 Wrangler 命令行 (本地开发)

1. 克隆本项目：
   ```bash
   git clone https://github.com/gujiangjiang/epg-proxy.git
   cd epg-proxy
   ```
2. 安装依赖：
   ```bash
   npm install
   ```
3. 部署到 Cloudflare：
   ```bash
   npx wrangler deploy
   ```
   *注意：本地部署后，请记得在 Cloudflare Dashboard 中手动配置 `EPG_URL` 等环境变量。*

## ⚙️ 环境变量说明

| 变量名 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `EPG_URL` | ✅ 是 | - | **主** EPG 文件的直连地址，支持 http/https，支持 .xml 或 .xml.gz |
| `EPG_URL_BACKUP` | ❌ 否 | - | **备用** EPG 文件地址，仅在 DIYP 接口主源查询失败时启用 |
| `CACHE_TTL` | ❌ 否 | 300 | 源文件在 Cloudflare 边缘节点的缓存时间（秒） |

## 📖 API 使用说明

假设你的服务域名为 `http://192.168.1.10:8787` 或 `https://epg.your-domain.workers.dev`

### 1. DIYP 接口
* **URL**: `/epg/diyp`
* **示例**: `.../epg/diyp?ch=CCTV1&date=2024-01-24`

* **参数**:
    * `ch`: 频道名称 (支持模糊匹配，如 `CCTV1`, `湖南卫视`)
    * `date`: 日期 (格式 `YYYY-MM-DD`)
* **逻辑**: 优先查询主源，若未找到频道或请求失败，自动查询备用源。

### 2. 超级直播接口 (epginfo)
* **URL**: `/epg/epginfo`
* **特点**: 兼容性更强，支持 `ch`, `channel`, `id` 参数。
* **逻辑**: 优先查询主源，若未找到频道或请求失败，自动查询备用源。
* **示例**: `.../epg/epginfo?channel=CCTV1&date=2024-01-24`

### 3. XML 文件下载
获取解压后的 XML 文件。无论源是 xml 还是 gz，这里永远输出 xml。
*(注：为保证性能，文件下载接口仅使用主源数据)*

* **URL**: `.../epg/epg.xml`

### 4. GZ 压缩文件下载
获取压缩后的 GZ 文件。无论源是 xml 还是 gz，这里永远输出 gz。推荐使用此接口以节省带宽。
*(注：为保证性能，文件下载接口仅使用主源数据)*

* **URL**: `.../epg/epg.xml.gz`

## 📄 License

MIT License