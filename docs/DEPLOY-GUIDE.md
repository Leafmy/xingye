# 星野 Xingye 服务器部署指南

## 方式一：直接部署（推荐）

### 1. 上传部署包

将 `xingye-server.tar.gz` 上传到服务器：

```bash
# 使用scp上传
scp xingye-server.tar.gz root@your-server-ip:/opt/

# 或使用sftp工具（如FileZilla）
```

### 2. 解压并部署

```bash
# 登录服务器
ssh root@your-server-ip

# 解压
cd /opt
tar -xzf xingye-server.tar.gz

# 运行部署脚本
cd xingye-server
sudo ./server-deploy.sh
```

### 3. 配置环境变量

```bash
# 编辑环境配置
nano /opt/xingye/bot-backend/.env

# 填写你的API密钥：
# MIMO_API_KEY=your_key
# STEAM_API_KEY=your_key
# DOUBAO_API_KEY=your_key
```

### 4. 重启服务

```bash
pm2 restart all
```

### 5. 访问管理面板

打开浏览器访问：`http://your-server-ip:5174`

---

## 方式二：Docker部署

### 1. 上传项目文件

```bash
# 上传整个项目或使用git
git clone https://github.com/Leafmy/xingye.git /opt/xingye
cd /opt/xingye
```

### 2. 创建环境配置

```bash
# 创建.env文件
cat > .env << EOF
MIMO_API_KEY=your_key
STEAM_API_KEY=your_key
STEAM_PROXY_URL=http://127.0.0.1:7890
DOUBAO_API_KEY=your_key
DOUBAO_DRAW_MODEL=ep-20260505205937-zj4t6
XINGYE_GITHUB_REPO=Leafmy/xingye
EOF
```

### 3. 启动Docker容器

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

---

## 方式三：OnePanel部署

### 1. 登录OnePanel

访问你的OnePanel管理界面。

### 2. 创建Node.js项目

1. 点击「网站」→「Node项目」
2. 项目名称：`xingye`
3. 项目目录：`/opt/xingye`
4. 启动命令：`pm2 start ecosystem.config.cjs`
5. Node.js版本：选择已安装的版本

### 3. 上传文件

通过OnePanel的文件管理器上传 `xingye-server.tar.gz` 并解压。

### 4. 配置环境变量

在OnePanel的项目设置中添加环境变量：
- `MIMO_API_KEY`
- `STEAM_API_KEY`
- `DOUBAO_API_KEY`
- 等等

### 5. 启动项目

在OnePanel中点击「启动」按钮。

---

## 管理命令

### PM2命令

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs

# 重启所有服务
pm2 restart all

# 停止所有服务
pm2 stop all

# 查看监控
pm2 monit
```

### 更新版本

```bash
# 使用更新脚本
cd /opt/xingye
node updater/server-update.js check
node updater/server-update.js apply

# 或手动更新
git pull
cd bot-backend && npm install && npm run build && cd ..
pm2 restart all
```

### 备份数据

```bash
# 备份数据目录
tar -czf xingye-backup-$(date +%Y%m%d).tar.gz /opt/xingye/data

# 备份配置
cp /opt/xingye/bot-backend/.env /opt/xingye/bot-backend/.env.backup
```

---

## 防火墙配置

如果需要从外部访问，确保开放以下端口：

```bash
# Ubuntu/Debian
ufw allow 3000/tcp  # 后端API
ufw allow 5174/tcp  # 管理面板
ufw allow 3001/tcp  # SnowLuma WebSocket

# CentOS/RHEL
firewall-cmd --permanent --add-port=3000/tcp
firewall-cmd --permanent --add-port=5174/tcp
firewall-cmd --permanent --add-port=3001/tcp
firewall-cmd --reload
```

---

## 常见问题

### Q: 服务启动失败怎么办？

```bash
# 查看详细日志
pm2 logs xingye-backend --lines 100

# 检查端口占用
lsof -i :3000
lsof -i :5174

# 检查Node.js版本
node --version  # 需要18+
```

### Q: 如何配置域名？

使用Nginx反向代理：

```nginx
server {
    listen 80;
    server_name xingye.yourdomain.com;

    location / {
        proxy_pass http://localhost:5174;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Q: 如何配置HTTPS？

使用Let's Encrypt：

```bash
# 安装certbot
apt install certbot python3-certbot-nginx

# 获取证书
certbot --nginx -d xingye.yourdomain.com

# 自动续期
certbot renew --dry-run
```

---

## 性能优化

### 1. 启用Gzip压缩

在Nginx配置中添加：

```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
```

### 2. 配置缓存

```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

### 3. 限制请求速率

```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

location /api {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://localhost:3000;
}
```

---

## 监控和告警

### 使用PM2 Plus（可选）

```bash
# 注册PM2 Plus
pm2 plus

# 按照提示操作
```

### 设置自动重启

```bash
# 保存当前进程列表
pm2 save

# 生成启动脚本
pm2 startup systemd

# 按照提示运行命令
```

---

## 卸载

```bash
# 停止服务
pm2 stop all
pm2 delete all

# 删除文件
rm -rf /opt/xingye

# 删除PM2（可选）
npm uninstall -g pm2
```

---

## 支持

- GitHub: https://github.com/Leafmy/xingye
- 问题反馈：GitHub Issues

---

*最后更新：2026-09-03*
