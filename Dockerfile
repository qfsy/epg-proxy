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
# 将 /app 目录的所有权赋予 node 用户，确保 npm/wrangler 可以写入
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

# 默认启动命令：使用 wrangler dev 监听所有接口
# --host 0.0.0.0: 允许外部访问
# --port 8787: 固定端口
CMD ["npx", "wrangler", "dev", "--host", "0.0.0.0", "--port", "8787"]