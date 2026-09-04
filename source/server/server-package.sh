#!/bin/bash
# 星野 Xingye - 打包服务器部署文件
# 运行此脚本生成可上传到服务器的部署包
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_ROOT"

set -e

echo "========================================"
echo "  打包星野服务器部署文件"
echo "========================================"
echo ""

PACKAGE_DIR="xingye-server"
PACKAGE_FILE="xingye-server.tar.gz"

# 清理旧的打包目录
rm -rf ${PACKAGE_DIR} ${PACKAGE_FILE}

# 创建打包目录
mkdir -p ${PACKAGE_DIR}

echo "[1/5] 复制后端文件..."
cp -r source/bot-backend ${PACKAGE_DIR}/
# 清理不需要的文件
rm -rf ${PACKAGE_DIR}/bot-backend/node_modules
rm -rf ${PACKAGE_DIR}/bot-backend/dist
rm -rf ${PACKAGE_DIR}/bot-backend/.env

echo "[2/5] 复制SnowLuma..."
cp -r SnowLuma ${PACKAGE_DIR}/
rm -rf ${PACKAGE_DIR}/SnowLuma/node_modules
rm -rf ${PACKAGE_DIR}/SnowLuma/data
rm -rf ${PACKAGE_DIR}/SnowLuma/logs

echo "[3/5] 复制前端文件..."
mkdir -p ${PACKAGE_DIR}/panel-frontend
cp -r source/panel-frontend/dist ${PACKAGE_DIR}/panel-frontend/
cp source/panel-frontend/package.json ${PACKAGE_DIR}/panel-frontend/

echo "[4/5] 复制配置文件..."
# 服务器包内 bot-backend 在包根，转换 ecosystem 的本机路径
sed "s|'source', 'bot-backend'|'bot-backend'|" ecosystem.config.cjs > ${PACKAGE_DIR}/ecosystem.config.cjs
cp version.json ${PACKAGE_DIR}/
cp -r source/updater ${PACKAGE_DIR}/
cp -r source/scripts ${PACKAGE_DIR}/
cp source/server/server-deploy.sh ${PACKAGE_DIR}/
chmod +x ${PACKAGE_DIR}/server-deploy.sh

echo "[5/5] 创建环境配置模板..."
cat > ${PACKAGE_DIR}/bot-backend/.env.example << 'EOF'
# 星野 Xingye 环境配置
# 复制此文件为 .env 并填写你的API密钥

# 小米AI API
MIMO_API_KEY=your_api_key_here

# Steam API
STEAM_API_KEY=your_steam_key_here
STEAM_PROXY_URL=http://127.0.0.1:7890

# 豆包API（图像生成）
DOUBAO_API_KEY=your_doubao_key_here
DOUBAO_DRAW_MODEL=ep-20260505205937-zj4t6

# GitHub仓库（用于更新）
XINGYE_GITHUB_REPO=Leafmy/xingye

# 高考志愿桥接服务
GAOKAO_BRIDGE_ENDPOINT=http://127.0.0.1:8766
EOF

# 创建快速启动脚本
cat > ${PACKAGE_DIR}/quick-start.sh << 'EOF'
#!/bin/bash
# 快速启动脚本

echo "========================================"
echo "  星野 Xingye 快速启动"
echo "========================================"

# 检查.env
if [ ! -f "bot-backend/.env" ]; then
    echo "创建环境配置..."
    cp bot-backend/.env.example bot-backend/.env
    echo "请编辑 bot-backend/.env 填写API密钥"
    echo "然后重新运行此脚本"
    exit 1
fi

# 安装依赖
echo "安装依赖..."
cd bot-backend && npm install --production && cd ..
cd SnowLuma && npm install --production 2>/dev/null; cd ..

# 构建后端
echo "构建后端..."
cd bot-backend && npm run build && cd ..

# 启动服务
echo "启动服务..."
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "启动完成！"
pm2 status
EOF
chmod +x ${PACKAGE_DIR}/quick-start.sh

# 打包
echo ""
echo "打包中..."
tar -czf ${PACKAGE_FILE} ${PACKAGE_DIR}

# 清理
rm -rf ${PACKAGE_DIR}

echo ""
echo "========================================"
echo "  打包完成！"
echo "========================================"
echo ""
echo "部署包: ${PACKAGE_FILE}"
echo "大小: $(ls -lh ${PACKAGE_FILE} | awk '{print $5}')"
echo ""
echo "部署步骤:"
echo "1. 上传 ${PACKAGE_FILE} 到服务器"
echo "2. 解压: tar -xzf ${PACKAGE_FILE}"
echo "3. 进入目录: cd xingye-server"
echo "4. 运行部署: sudo ./server-deploy.sh"
echo "   或快速启动: ./quick-start.sh"
echo ""
