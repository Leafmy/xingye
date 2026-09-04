FROM node:22-slim

WORKDIR /app

# 安装依赖
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# 复制项目文件
COPY bot-backend/ ./bot-backend/
COPY SnowLuma/ ./SnowLuma/
COPY panel-frontend/ ./panel-frontend/
COPY ecosystem.config.cjs ./
COPY version.json ./
COPY updater/ ./updater/

# 安装后端依赖
WORKDIR /app/bot-backend
RUN npm install --production

# 安装SnowLuma依赖
WORKDIR /app/SnowLuma
RUN npm install --production 2>/dev/null || true

# 构建前端
WORKDIR /app/panel-frontend
RUN npm install && npm run build

# 安装PM2
RUN npm install -g pm2

# 回到主目录
WORKDIR /app

# 创建数据目录
RUN mkdir -p data logs

# 暴露端口
EXPOSE 3000 5174 3001

# 启动脚本
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
