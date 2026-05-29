# 球多多 AI 足球预测 - 后端服务

## 项目简介

这是“球多多 AI 足球预测”平台的核心后端服务，负责处理所有业务逻辑、数据存储、AI 模型集成、预测任务调度以及用户认证等关键功能。它为用户前端和管理后台提供统一的 API 接口，是整个平台的“大脑”。

## 主要功能

*   **用户与认证**：支持游客模式、微信登录，管理用户身份和会话。
*   **赛事与比赛管理**：提供赛事、球队、比赛数据的 CRUD 操作，支持赛程导入和赛果更新。
*   **AI 预测生产线**：
    *   集成多种 AI 模型（如通过 NEXUS AI 中转站接入的 Gemini、Claude 等）。
    *   支持 24 小时前（自动触发）和 2 小时前（管理员选择触发）两阶段预测。
    *   **动态提示词模板**：支持后台配置提示词，并自动注入比赛变量（主客队、开赛时间等）。
    *   预测结果结构化存储，并支持后台编辑与共识自动重算。
*   **权益与订单**：
    *   管理用户预测权益的获取、消耗。
    *   **比赛级解锁**：权益消费按比赛生效，解锁一场比赛即可查看该场下所有 AI 模型分析。
    *   支付订单处理与会员权益同步。
*   **分享与增长**：生成个性化分享卡片，支持邀请码机制。
*   **后台管理 API**：为管理后台提供数据查询、任务触发、审计日志等接口。
*   **健康检查**：提供服务健康状态监控接口。

## 技术栈

*   **框架**: [NestJS](https://nestjs.com/) (基于 Node.js)
*   **语言**: [TypeScript](https://www.typescriptlang.org/)
*   **数据库**: [Prisma ORM](https://www.prisma.io/) (支持 MySQL/PostgreSQL)
*   **任务队列**: [BullMQ](https://docs.bullmq.io/) (基于 Redis)
*   **缓存**: [Redis](https://redis.io/)
*   **AI 集成**: OpenAI 兼容 API (通过 NEXUS AI 等中转站)
*   **部署**: [PM2](https://pm2.keymetrics.io/) (进程管理)

## 部署信息

*   **线上 API 地址**: 
    *   **域名访问**: `http://api.qiuduoduo.online`
    *   **IP 访问**: `http://82.157.76.140:3000`

## 本地开发

1.  **克隆仓库**：
    ```bash
    git clone https://github.com/reportyao/ai-worldcup-backend.git
    cd ai-worldcup-backend
    ```
2.  **安装依赖**：
    ```bash
    npm install
    # 或者 pnpm install
    ```
3.  **配置环境变量**：
    创建 `.env` 文件，参考 `.env.example` 配置数据库连接、Redis 连接、AI API Key 等。
    ```env
    DATABASE_URL="mysql://user:password@localhost:3306/db_name"
    REDIS_HOST="localhost"
    REDIS_PORT=6379
    OPENAI_API_KEY="sk-your-openai-key"
    OPENAI_BASE_URL="https://api.openai.com/v1"
    # ... 其他配置
    ```
4.  **启动数据库和 Redis**：
    推荐使用 Docker Compose 启动本地开发环境的数据库和 Redis。
    ```bash
    docker-compose up -d mysql redis
    ```
5.  **运行数据库迁移**：
    ```bash
    npx prisma migrate dev --name init
    ```
6.  **启动开发服务器**：
    ```bash
    npm run start:dev
    ```
    API 服务将在 `http://localhost:3000` 启动。
7.  **启动 Worker 进程**：
    ```bash
    npm run start:worker
    ```
    Worker 进程负责处理预测任务队列。

## 贡献

欢迎提交 Pull Request 或报告 Bug。请确保您的代码符合项目规范并包含相应的测试。

## 自动部署到生产服务器

本仓库已配置 `.github/workflows/deploy.yml`。当代码推送到 `main` 分支时，GitHub Actions 会调度服务器上的自托管 Runner（标签：`worldcup-backend`），在服务器本机完成源码同步与后端部署。

部署流程会将当前仓库内容同步到 `/home/ubuntu/apps/ai-worldcup-backend`，随后执行 `deploy/production/deploy-backend.sh`。脚本会安装依赖、生成 Prisma Client、执行数据库迁移、构建后端应用，并通过 PM2 重载 `ai-worldcup-api` 与 `ai-worldcup-worker`。生产环境变量保存在服务器端 `/home/ubuntu/apps/ai-worldcup-backend/.env`，自动同步时会被排除，不会被仓库内容覆盖。

该自动部署方案不依赖 GitHub Secrets 中保存服务器私钥；服务器通过已安装的自托管 Runner 主动接收 GitHub Actions 任务。若更换服务器，需要重新注册对应仓库的 Runner 并保留 `self-hosted`、`linux`、`x64`、`worldcup-backend` 标签。

## 自动部署（main 分支）

本仓库已配置 GitHub Actions 自动部署工作流：当代码推送到 `main` 分支时，GitHub 托管 Runner 会先检出最新代码，然后通过 SSH 将源码同步到服务器 `/home/ubuntu/apps/ai-worldcup-backend`，最后在服务器执行部署脚本 `/home/ubuntu/apps/ai-worldcup-backend/deploy/production/deploy-backend.sh`。这种方式不依赖服务器直接访问 GitHub 拉取代码，适合当前生产服务器网络环境。

自动部署依赖以下 GitHub Actions Secrets：`SSH_HOST`、`SSH_PORT`、`SSH_USER`、`SSH_PRIVATE_KEY`。服务器侧需要将对应公钥加入部署用户的 `~/.ssh/authorized_keys`，并确保部署脚本具有执行权限。
