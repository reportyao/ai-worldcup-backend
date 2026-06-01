# 球多多 AI 足球预测 - 后端服务

## 项目简介

这是“球多多 AI 足球预测”平台的核心后端服务，负责处理所有业务逻辑、数据存储、AI 模型集成、预测任务调度以及用户认证等关键功能。它为用户前端和管理后台提供统一的 API 接口，是整个平台的“大脑”。

## 主要功能

*   **用户与认证**：支持游客模式、微信登录，管理用户身份和会话。
*   **赛事与比赛管理**：提供赛事、球队、比赛数据的 CRUD 操作，支持赛程导入、API-Football 多联赛同步和赛果更新。
*   **足球数据同步**：支持通过 API-Football 同步联赛元数据、球队、未来赛程和实时比分，并记录每次同步的参数、状态和摘要。
*   **AI 预测生产线**：
    *   集成多种 AI 模型（如通过 NEXUS AI 中转站接入的 Gemini、Claude 等）。
    *   支持 24 小时前（自动触发）和 2 小时前（管理员选择触发）两阶段预测。
    *   **特征驱动的预测 (Prediction Pack)**：后台自动化计算球队近期战绩、交锋记录等特征，打包作为大模型的统一上下文输入。
    *   **多维度共识聚合**：不仅汇总胜平负，还聚合了各模型的胜率概率、进球预期、观点集群分布、共同优势/风险等，提供深度共识分析。
    *   **动态提示词模板**：支持后台配置提示词，并自动注入比赛变量（主客队、开赛时间、特征数据等）。
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
6.  **配置 API-Football（可选）**：
    若需要启用自动足球数据同步，请在 `.env` 中补充 API-Football 访问参数和默认联赛列表。`API_FOOTBALL_DEFAULT_LEAGUES` 使用逗号分隔的联赛 ID，Worker 会基于这些联赛执行定时赛程与实时比分同步。
    ```env
    API_FOOTBALL_BASE_URL="https://v3.football.api-sports.io"
    API_FOOTBALL_KEY="your-api-football-key"
    API_FOOTBALL_DEFAULT_LEAGUES="39,140,135,78,61"
    FOOTBALL_DATA_FIXTURE_SYNC_CRON="0 */6 * * *"
    FOOTBALL_DATA_LIVE_SYNC_CRON="*/10 * * * *"
    FOOTBALL_DATA_SYNC_SEASON="2026"
    ```
7.  **启动开发服务器**：
    ```bash
    npm run start:dev
    ```
    API 服务将在 `http://localhost:3000` 启动。
8.  **启动 Worker 进程**：
    ```bash
    npm run start:worker
    ```
    Worker 进程负责处理预测任务队列、API-Football 定时同步和同步后预测入队。

## API-Football 数据同步

后台管理接口新增 `/admin/football-data/provider/leagues`、`/admin/football-data/sync-logs` 与 `/admin/football-data/sync` 三类能力。管理员可以先读取后端配置中的默认联赛，再按 `LEAGUES`、`TEAMS`、`FIXTURES` 或 `LIVE_SCORES` 范围触发同步。同步任务会写入 `FootballDataSyncLog`，其中保存提供方、同步范围、请求参数、运行状态、错误消息和写入摘要，便于审计与故障排查。

| 同步范围 | 主要作用 | 是否建议开启预测入队 |
| --- | --- | --- |
| `LEAGUES` | 根据 API-Football 联赛与赛季信息维护本地赛事。 | 否 |
| `TEAMS` | 同步所选联赛的球队基础资料与外部 ID。 | 否 |
| `FIXTURES` | 同步日期范围内的未来赛程、比赛状态和比分。 | 是 |
| `LIVE_SCORES` | 高频刷新正在进行比赛的状态和比分。 | 否 |

Worker 启动时会注册两类重复任务：未来赛程同步任务使用 `FOOTBALL_DATA_FIXTURE_SYNC_CRON`，实时比分同步任务使用 `FOOTBALL_DATA_LIVE_SYNC_CRON`。若 `API_FOOTBALL_KEY` 或默认联赛列表未配置，相关任务会安全跳过，不影响预测队列和其他业务队列运行。

## 内置数据集与文档

本仓库已纳入 apifootball.com 抓取并校验后的项目数据集，统一保存在 `data/` 目录。数据请求使用账号后台 API key 执行，但提交到仓库的脚本、日志、原始响应与文档均已脱敏；提交前密钥扫描结果为 `secret_scan=passed`。

| 数据目录 | 内容 | 关键文档 |
| --- | --- | --- |
| `data/worldcup-2026/` | 2026 FIFA World Cup 48 支参赛队伍标准化 JSON/CSV、原始响应、校验脚本和校验结果。 | `data/worldcup-2026/worldcup_2026_teams_validation_report.md` |
| `data/recommended-leagues/` | 23 个推荐联赛/赛事的球队、积分榜、赛程/赛果、射手榜汇总数据、原始响应、索引和抓取脚本。 | `data/recommended-leagues/recommended_leagues_validation_report.md` |
| `docs/data_delivery_summary.md` | 本次三仓库代码、数据抓取、校验结论和后续建议的最终交付摘要。 | `docs/data_delivery_summary.md` |

推荐联赛数据汇总规模如下，可直接作为后续导入脚本、离线分析或 AI 预测特征工程的输入。

| 汇总表 | 记录数 | 输出格式 |
| --- | ---: | --- |
| `all_teams` | 859 | JSON / CSV |
| `all_standings` | 884 | JSON / CSV |
| `all_events` | 6154 | JSON / CSV |
| `all_topscorers` | 1487 | JSON / CSV |

当前已知限制是 odds 赔率接口在当前账号或接口参数下未返回可用数据，OFC World Cup Qualifiers 的积分榜接口为空，AFC Champions League Elite 的赛程接口为空。上述空响应均已保留在 `raw/` 目录和质量报告中，便于后续复查和增量补抓。

## 贡献

欢迎提交 Pull Request 或报告 Bug。请确保您的代码符合项目规范并包含相应的测试。

## 自动部署到生产服务器

本仓库已配置 `.github/workflows/deploy.yml`。当代码推送到 `main` 分支时，GitHub Actions 会调度服务器上的自托管 Runner（标签：`worldcup-backend`），在服务器本机完成源码同步与后端部署。

部署流程会将当前仓库内容同步到 `/home/ubuntu/apps/ai-worldcup-backend`，随后执行 `deploy/production/deploy-backend.sh`。脚本会安装依赖、生成 Prisma Client、执行数据库迁移、构建后端应用，并通过 PM2 重载 `ai-worldcup-api` 与 `ai-worldcup-worker`。生产环境变量保存在服务器端 `/home/ubuntu/apps/ai-worldcup-backend/.env`，自动同步时会被排除，不会被仓库内容覆盖。

该自动部署方案不依赖 GitHub Secrets 中保存服务器私钥；服务器通过已安装的自托管 Runner 主动接收 GitHub Actions 任务。若更换服务器，需要重新注册对应仓库的 Runner 并保留 `self-hosted`、`linux`、`x64`、`worldcup-backend` 标签。

## 自动部署（main 分支）

本仓库已配置 GitHub Actions 自动部署工作流：当代码推送到 `main` 分支时，GitHub 托管 Runner 会先检出最新代码，然后通过 SSH 将源码同步到服务器 `/home/ubuntu/apps/ai-worldcup-backend`，最后在服务器执行部署脚本 `/home/ubuntu/apps/ai-worldcup-backend/deploy/production/deploy-backend.sh`。这种方式不依赖服务器直接访问 GitHub 拉取代码，适合当前生产服务器网络环境。

自动部署依赖以下 GitHub Actions Secrets：`SSH_HOST`、`SSH_PORT`、`SSH_USER`、`SSH_PRIVATE_KEY`。服务器侧需要将对应公钥加入部署用户的 `~/.ssh/authorized_keys`，并确保部署脚本具有执行权限。
