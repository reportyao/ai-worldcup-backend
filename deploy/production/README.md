# AI World Cup 生产部署与自动发布

本目录提供生产环境部署资产，目标服务器默认路径为 `/home/ubuntu/apps/ai-worldcup-backend`、`/home/ubuntu/apps/ai-worldcup-frontend`，静态前端发布到 `/var/www/ai-worldcup`，后端 API 与 Worker 由 PM2 管理，PostgreSQL 与 Redis 由后端仓库的 `docker-compose.yml` 管理。

## 手动部署

在服务器执行：

```bash
cd /home/ubuntu/apps/ai-worldcup-backend
bash deploy/production/ai-worldcup-deploy.sh
```

脚本会自动拉取前后端 `main` 分支、安装依赖、执行 Prisma 迁移、构建后端 API/Worker、构建前端、发布静态文件、启动 PM2 进程并配置 Nginx。服务器应在 `/home/ubuntu/.ssh` 中配置两个只读部署密钥：`ai_worldcup_backend_deploy` 对应后端仓库，`ai_worldcup_deploy` 对应前端私有仓库；脚本默认通过 `git@github-backend:reportyao/ai-worldcup-backend.git` 与 `git@github-frontend:reportyao/ai-worldcup-frontend.git` 拉取代码，并自动把 GitHub SSH 访问切换到 443 端口以提升云服务器出网兼容性。

## GitHub 自动部署

首次安装 Webhook 服务：

```bash
cd /home/ubuntu/apps/ai-worldcup-backend
bash deploy/production/install-webhook.sh
cat /home/ubuntu/deploy/github-webhook.secret
```

随后在两个 GitHub 仓库配置相同的 Webhook：

| 项目 | 值 |
| --- | --- |
| Payload URL | `http://82.157.76.140/github-webhook` |
| Content type | `application/json` |
| Secret | `/home/ubuntu/deploy/github-webhook.secret` 文件内容 |
| Events | `Just the push event` |
| Active | true |

Webhook 服务仅接受 `reportyao/ai-worldcup-backend` 和 `reportyao/ai-worldcup-frontend` 的 `main` 分支 push 事件，并用 `X-Hub-Signature-256` 做 HMAC-SHA256 校验。
