# feishu-shifu Linux 迁移指南

## 前置条件

- Linux 服务器（Ubuntu 20.04+ / Debian / CentOS 7+）
- 有公网 IP 或内网穿透（OAuth 回调需要飞书服务器能访问到）
- 飞书开放平台已配置好回调 URL

## 一、安装 Node.js 20+

```bash
# 方法1: 使用 NodeSource (推荐)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 方法2: 使用 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20

# 验证
node --version  # 应显示 v20.x.x
npm --version
```

## 二、迁移项目文件

```bash
# 方法1: Git clone（推荐）
git clone <你的仓库地址> feishu-shifu
cd feishu-shifu

# 方法2: 打包上传
# 在本机执行: tar -czf feishu-shifu.tar.gz feishu-shifu/
# scp 上传后: tar -xzf feishu-shifu.tar.gz
```

## 三、安装依赖

```bash
cd feishu-shifu
npm install
```

## 四、创建配置文件

```bash
# 从模板创建 .env
cp .env.example .env

# 编辑 .env，填入真实值
nano .env
```

需要修改的关键字段：

```env
PORT=3000
FEISHU_EVENT_MODE=websocket

# 改为 Linux 服务器的公网 IP 或域名
PUBLIC_BASE_URL=http://你的服务器IP:3000

FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_OAUTH_SCOPES=docs:document.content:read docx:document:readonly wiki:node:read wiki:node:retrieve drive:drive.metadata:readonly sheets:spreadsheet:readonly bitable:app:readonly

DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
```

## 五、创建 Linux 守护脚本

创建 `scripts/start-daemon.sh`：

```bash
#!/bin/bash
cd "$(dirname "$0")/.."

echo "[$(date)] feishu-shifu daemon started" >> .data/daemon.log

while true; do
    echo "[$(date)] Starting feishu-shifu..." >> .data/daemon.log
    node --import tsx src/server.ts >> .data/server.log 2>&1
    echo "[$(date)] feishu-shifu exited with code $?, restarting in 3s..." >> .data/daemon.log
    sleep 3
done
```

```bash
chmod +x scripts/start-daemon.sh
```

## 六、创建 systemd 服务（免手动启动，开机自启）

```bash
sudo nano /etc/systemd/system/feishu-shifu.service
```

写入以下内容（替换路径和用户名）：

```ini
[Unit]
Description=feishu-shifu bot backend
After=network.target

[Service]
Type=simple
User=你的用户名
WorkingDirectory=/home/你的用户名/feishu-shifu
ExecStart=/home/你的用户名/feishu-shifu/scripts/start-daemon.sh
Restart=no
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable feishu-shifu
sudo systemctl start feishu-shifu
```

## 七、飞书开放平台配置更新

登录飞书开发者后台，修改：

1. **OAuth 回调 URL** → `http://你的服务器IP:3000/feishu/oauth/callback`（如果是 HTTPS 则用 https）
2. **事件订阅** → 确认是"长连接"模式（不需要配置请求 URL）

## 八、防火墙配置

```bash
# 如果服务器有防火墙，开放 3000 端口
sudo ufw allow 3000
```

## 九、验证

```bash
# 健康检查
curl http://localhost:3000/health
# 应返回: {"ok":true,"ws":"connected"}

# 看日志
tail -f .data/server.log
tail -f .data/daemon.log

# 运行测试
npm run test
npm run typecheck
```

## 常用运维命令

```bash
# 查看服务状态
sudo systemctl status feishu-shifu

# 重启服务（应用新代码后）
sudo systemctl restart feishu-shifu

# 查看实时日志
tail -f .data/server.log

# 查看守护日志
cat .data/daemon.log

# 只杀本进程
sudo systemctl stop feishu-shifu
# 或找 PID: lsof -i :3000
```

## 注意事项

- `.env` 文件包含密钥，**不要提交到 Git**，已在 `.gitignore` 中排除
- Token 文件 `.data/feishu-user-tokens.json` 包含用户授权，迁移时不要带敏感数据
- 如果用到飞书文件发送功能，需确认 `im:resource:upload` 权限已开通
- `tsx` 是开发依赖，生产环境可改用编译后的 JS：`npm run build && node dist/server.js`
