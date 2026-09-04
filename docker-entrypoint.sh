#!/bin/bash
set -e

echo "========================================"
echo "  星野 Xingye Docker 容器启动"
echo "========================================"

# 检查环境变量
if [ -z "$MIMO_API_KEY" ]; then
    echo "警告: MIMO_API_KEY 未设置"
fi

# 创建.env文件
cat > /app/bot-backend/.env << EOF
MIMO_API_KEY=${MIMO_API_KEY:-}
STEAM_API_KEY=${STEAM_API_KEY:-}
STEAM_PROXY_URL=${STEAM_PROXY_URL:-http://127.0.0.1:7890}
DOUBAO_API_KEY=${DOUBAO_API_KEY:-}
DOUBAO_DRAW_MODEL=${DOUBAO_DRAW_MODEL:-ep-20260505205937-zj4t6}
XINGYE_GITHUB_REPO=${XINGYE_GITHUB_REPO:-Leafmy/xingye}
GAOKAO_BRIDGE_ENDPOINT=${GAOKAO_BRIDGE_ENDPOINT:-http://127.0.0.1:8766}
EOF

# 构建后端
echo "构建后端..."
cd /app/bot-backend
npm run build 2>/dev/null || echo "后端构建跳过"

# 启动服务
echo "启动服务..."
cd /app
pm2 start ecosystem.config.cjs

# 保持容器运行
echo "服务已启动，容器运行中..."
pm2 logs --lines 100
