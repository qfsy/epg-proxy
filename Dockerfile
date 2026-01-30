# 使用 Node.js 20 slim 版本
FROM node:20-slim

# 设置工作目录
WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm

# 复制依赖文件
COPY package.json pnpm-lock.yaml* ./

# 安装依赖
RUN pnpm install

# 复制项目源码
COPY . .

# 复制并设置入口脚本权限
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# [安全优化] 修复权限并切换到非 root 用户
# 确保 node 用户拥有 /app 目录（包含 node_modules）的读写权限
RUN chown -R node:node /app

# 切换到 node 用户
USER node

# 设置环境变量
ENV CI=true
ENV WRANGLER_SEND_METRICS=false

# 暴露端口
EXPOSE 8787

# 设置入口点
ENTRYPOINT ["docker-entrypoint.sh"]

# [v2.5 修复] 启动命令
# 修正参数：使用 --ip 0.0.0.0 强制监听所有网卡
# 注意：wrangler v3 使用 --ip 而非 --host
CMD ["npx", "wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787"]
