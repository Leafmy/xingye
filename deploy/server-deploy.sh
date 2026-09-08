#!/bin/bash
# 星野 Xingye - Ubuntu 服务器部署脚本
# 用法: curl -sSL https://raw.githubusercontent.com/Leafmy/xingye/main/server-deploy.sh | bash
# 或者: chmod +x server-deploy.sh && sudo ./server-deploy.sh

set -e

echo "========================================"
echo "  星野 Xingye 服务器部署"
echo "========================================"
echo ""

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 配置
INSTALL_DIR="/opt/xingye"
SERVICE_NAME="xingye"
NODE_VERSION="22"

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}请使用 sudo 运行此脚本${NC}"
    exit 1
fi

echo -e "${YELLOW}[1/6] 安装依赖...${NC}"

# 更新包管理器
apt-get update -qq

# 安装必要的包
apt-get install -y -qq curl wget git build-essential

# 检查Node.js是否已安装
if ! command -v node &> /dev/null; then
    echo "安装 Node.js ${NODE_VERSION}..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y -qq nodejs
else
    echo "Node.js 已安装: $(node --version)"
fi

# 安装PM2
if ! command -v pm2 &> /dev/null; then
    echo "安装 PM2..."
    npm install -g pm2
else
    echo "PM2 已安装: $(pm2 --version)"
fi

echo ""
echo -e "${YELLOW}[2/6] 创建安装目录...${NC}"

# 创建安装目录
mkdir -p ${INSTALL_DIR}
mkdir -p ${INSTALL_DIR}/data
mkdir -p ${INSTALL_DIR}/logs

echo ""
echo -e "${YELLOW}[3/6] 下载星野...${NC}"

# 检查是否已有文件
if [ -f "${INSTALL_DIR}/package.json" ]; then
    echo "检测到已有安装，更新中..."
    cd ${INSTALL_DIR}
    git pull origin main 2>/dev/null || echo "Git更新失败，跳过"
else
    echo "全新安装..."
    # 这里可以从GitHub下载或从本地上传
    # git clone https://github.com/Leafmy/xingye.git ${INSTALL_DIR}
    echo "请手动上传项目文件到 ${INSTALL_DIR}"
fi

echo ""
echo -e "${YELLOW}[4/6] 安装依赖...${NC}"

cd ${INSTALL_DIR}

# 安装后端依赖
if [ -d "bot-backend" ]; then
    echo "安装后端依赖..."
    cd bot-backend
    npm install --production 2>/dev/null || npm install
    cd ..
fi

# 安装前端依赖（如果需要构建）
if [ -d "panel-frontend" ]; then
    echo "安装前端依赖..."
    cd panel-frontend
    npm install 2>/dev/null
    npm run build 2>/dev/null || echo "前端构建跳过"
    cd ..
fi

echo ""
echo -e "${YELLOW}[5/6] 配置环境...${NC}"

# 创建环境配置文件
if [ ! -f "${INSTALL_DIR}/bot-backend/.env" ]; then
    cat > ${INSTALL_DIR}/bot-backend/.env << 'EOF'
# 星野 Xingye 环境配置
# 请填写你的API密钥

# 小米AI API
MIMO_API_KEY=

# Steam API
STEAM_API_KEY=
STEAM_PROXY_URL=http://127.0.0.1:7890

# 豆包API（图像生成）
DOUBAO_API_KEY=
DOUBAO_DRAW_MODEL=

# GitHub仓库（用于更新）
XINGYE_GITHUB_REPO=Leafmy/xingye

# 高考志愿桥接服务
GAOKAO_BRIDGE_ENDPOINT=http://127.0.0.1:8766
EOF
    echo -e "${GREEN}环境配置已创建: ${INSTALL_DIR}/bot-backend/.env${NC}"
    echo -e "${YELLOW}请编辑 .env 文件填写API密钥${NC}"
else
    echo "环境配置已存在，跳过"
fi

# 创建PM2配置
cat > ${INSTALL_DIR}/ecosystem.config.cjs << 'EOF'
const path = require('path');
const root = __dirname;

module.exports = {
  apps: [
    {
      name: 'xingye-snowluma',
      cwd: path.join(root, 'SnowLuma'),
      script: path.join(root, 'SnowLuma', 'index.mjs'),
      interpreter: 'node',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'xingye-backend',
      cwd: path.join(root, 'bot-backend'),
      script: path.join(root, 'bot-backend', 'dist', 'index.js'),
      interpreter: 'node',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        STEAM_PROXY_URL: process.env.STEAM_PROXY_URL || 'http://127.0.0.1:7890'
      }
    },
    {
      name: 'xingye-frontend',
      cwd: path.join(root, 'panel-frontend'),
      script: 'node_modules/.bin/vite',
      args: 'preview --port 5174 --host 0.0.0.0',
      interpreter: 'node',
      autorestart: true,
      watch: false,
      env: { NODE_ENV: 'production' }
    }
  ]
}
EOF

echo ""
echo -e "${YELLOW}[6/6] 启动服务...${NC}"

cd ${INSTALL_DIR}

# 停止旧服务
pm2 delete xingye-snowluma xingye-backend xingye-frontend 2>/dev/null || true

# 启动新服务
pm2 start ecosystem.config.cjs

# 保存PM2配置
pm2 save

# 设置开机自启
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo "========================================"
echo -e "  ${GREEN}部署完成！${NC}"
echo "========================================"
echo ""
echo "服务状态:"
pm2 status
echo ""
echo "管理命令:"
echo "  查看状态: pm2 status"
echo "  查看日志: pm2 logs"
echo "  重启服务: pm2 restart all"
echo "  停止服务: pm2 stop all"
echo ""
echo "访问地址:"
echo "  管理面板: http://$(hostname -I | awk '{print $1}'):5174"
echo "  后端API: http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo -e "${YELLOW}请记得编辑 ${INSTALL_DIR}/bot-backend/.env 填写API密钥${NC}"
echo ""
