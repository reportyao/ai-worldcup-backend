# AI Worldcup Backend

**AI Worldcup Backend** 是 AI 世界杯预测平台的后端单体仓库，承担用户端 API、运营后台 API、AI 预测生产线、赛后复盘、权益支付、分享归因、国际化翻译与后台队列任务。项目采用 **NestJS + Prisma + PostgreSQL + Redis + BullMQ** 的分层架构：NestJS 负责 HTTP API 与业务服务编排，Prisma 负责数据库模型和迁移，Redis/BullMQ 负责后台任务、定时扫描、失败隔离和人工重跑能力。NestJS 官方定位为用于构建高效、可扩展 Node.js 服务端应用的框架，Prisma 提供类型安全数据库访问，BullMQ 则适合基于 Redis 的可靠队列与后台任务调度。[1] [2] [3]

> 本产品只做 **AI 足球赛事预测、球迷互动与内容分享**，不做投注、博彩导流或真钱竞猜。所有对外展示内容必须保留“本产品仅用于娱乐分析与球迷讨论，不构成投注建议。”这一免责声明。

## 1. 项目定位与业务主线

本仓库不是简单的 CRUD API，而是一个“可运营、可复盘、可收费、可追溯”的 AI 赛事内容生产系统。前端、小程序或 H5 不直接访问第三方足球数据源、AI 模型供应商、微信支付、Stripe、数据库或对象存储；所有敏感操作都经过本后端统一代理、校验、审计和落库。

| 业务主线 | 后端职责 | 已落地位置 |
|---|---|---|
| 赛事与比赛数据 | 维护赛事、球队、比赛、赛果、状态、外部数据源映射，并支持后台录入与导入。 | `apps/api/src/modules/admin`、`apps/api/src/modules/matches`、`prisma/schema.prisma` |
| 多模型预测 | 在赛前 24 小时和 2 小时创建预测任务，调用多个启用 AI 模型，保存结构化输出、原始输出、Prompt 快照、耗时与错误。 | `apps/worker/src/jobs/prediction-generator.job.ts`、`packages/shared/src/ai-pipeline` |
| 共识与展示聚合 | 对多模型结果计算共识等级与摘要，为前端详情页提供综合读模型。 | `apps/api/src/modules/matches`、`packages/shared/src/ai-pipeline` |
| 赛后复盘与战绩 | 比赛结束后生成每个模型的复盘，更新模型战绩、命中率与近期表现。 | `apps/worker/src/jobs/review-generator.job.ts`、`apps/api/src/modules/reviews`、`apps/api/src/modules/scorecards` |
| 用户、游客与预测 | 支持游客会话、微信登录用户、用户预测提交、登录后数据沉淀。 | `apps/api/src/modules/auth`、`apps/api/src/modules/matches` |
| 权益、邀请与支付 | 统一判断免费、邀请奖励和会员权益，支付成功后发放 Pass 权益。 | `apps/api/src/modules/entitlements`、`apps/api/src/modules/invitations`、`apps/api/src/modules/payments` |
| 分享增长与归因 | 生成分享卡、记录分享浏览、绑定注册归因，支持微信小程序码回退策略。 | `apps/api/src/modules/share` |
| 多语言内容 | 对 AI 预测、复盘、共识摘要创建翻译任务，并支持后台审核。 | `apps/api/src/modules/translation`、`ContentTranslation` |
| 后台运营审计 | 后台赛事管理、模型管理、任务触发、重跑、发布、审计日志。 | `apps/api/src/modules/admin`、`AdminAuditLog` |

## 2. 技术栈与运行形态

后端采用 pnpm workspace 管理 API、Worker 与共享包。API 和 Worker 是两个独立常驻进程，二者共享 Prisma 数据模型与 `@ai-worldcup/shared` 中的 AI 结构化协议。生产环境至少需要 PostgreSQL、Redis、API 进程、Worker 进程以及反向代理。

| 层级 | 技术 | 说明 |
|---|---|---|
| HTTP API | NestJS 10、Express Adapter | `/api/*` 为业务接口，`/health` 为健康检查。全局启用 CORS、限流、响应包装、异常过滤和请求 ID。 |
| ORM 与数据库 | Prisma 5、PostgreSQL | `prisma/schema.prisma` 是业务真相源，所有核心状态与输出均可追溯。 |
| 后台队列 | BullMQ、Redis、ioredis | Worker 注册预测、数据同步、复盘、共识、战绩、翻译六类队列。 |
| AI 协议层 | `packages/shared/src/ai-pipeline` | 统一 Prompt、结构化 Schema、内容安全、供应商调用、失败占位与共识计算。 |
| 校验与类型 | Zod、TypeScript | API DTO、任务 payload、AI 输出均以类型和运行时校验约束。 |
| 文件与图片 | `canvas`、`sharp` | 分享图与卡片渲染能力预留在分享模块中。 |
| 测试 | Vitest | 各 package 独立运行测试，根目录可统一执行。 |

## 3. 代码结构

```text
ai-worldcup-backend/
├── apps/
│   ├── api/                         # NestJS HTTP API 服务
│   │   └── src/
│   │       ├── app.module.ts         # 全局模块装配、限流、响应包装、异常过滤
│   │       ├── main.ts               # API 启动入口，监听 API_PORT，设置 /api 前缀
│   │       ├── common/               # 全局中间件、响应拦截器、异常过滤器
│   │       ├── config/               # 环境变量读取与启动期校验
│   │       ├── modules/              # 业务模块
│   │       └── prisma/               # PrismaService 注入
│   └── worker/                      # BullMQ Worker 常驻进程
│       └── src/
│           ├── main.ts               # 注册重复任务和六类队列 worker
│           ├── jobs/                 # 数据同步、预测、复盘、战绩、翻译任务
│           └── queues.ts             # 队列名称统一定义
├── packages/
│   └── shared/                       # API 与 Worker 共享类型、状态机、AI 管线
├── prisma/
│   ├── schema.prisma                 # PostgreSQL 数据模型
│   ├── migrations/                   # 数据库迁移
│   └── seed.ts                       # 初始种子数据
├── package.json                      # 根 workspace 脚本
└── pnpm-workspace.yaml
```

## 4. 核心数据模型理解

数据库围绕四条主线展开。第一条是赛事数据，保证所有前台展示都来自自有数据库；第二条是 AI 内容生产，保证每个模型、每个版本、每次生成都有结构化输出和审计字段；第三条是用户商业闭环，保证游客、注册用户、权益、邀请、订单之间关系清晰；第四条是运营追溯，保证后台修改和任务状态可追踪。

| 数据域 | 关键模型 | 业务说明 |
|---|---|---|
| 赛事基础 | `Competition`、`Team`、`Match` | 支持世界杯、洲际杯、城市联赛等多赛事；比赛记录包含开球时间、阶段、赛果、状态和外部来源 ID。 |
| 预测生产 | `AiModel`、`PredictionTask`、`ModelPrediction` | 一场比赛的一个预测版本对应一个任务；每个启用模型对应一条模型预测；任务状态包括 `PENDING`、`RUNNING`、`PARTIAL_SUCCESS`、`SUCCEEDED`、`FAILED`、`REVIEWED`、`PUBLISHED`。 |
| 用户与权益 | `User`、`Guest`、`UserPrediction`、`Invitation`、`Entitlement`、`Order` | 游客可体验与提交预测；用户可通过每日免费、邀请奖励、会员支付获得完整模型分析访问权。 |
| 复盘战绩 | `ModelReview`、`ModelScorecard` | 赛后为每个模型生成复盘，并按总体、赛事、近 10 场等口径聚合战绩。 |
| 运营审计 | `AdminUser`、`AdminAuditLog` | 后台写操作需要留痕，便于回溯手动修改、导入、发布、重跑等行为。 |
| 分享与国际化 | `ShareTrack`、`ShareAttribution`、`ContentTranslation` | 支持分享归因、小程序码场景值、AI 内容翻译任务和人工审核。 |

## 5. AI 预测生产线

预测生产线是系统核心。项目采用“后台离线生成、结果入库、前台读取已发布内容”的模式，而不是用户打开页面时实时调用模型。这种设计降低成本、保证同一场比赛内容一致，并允许后台对失败模型进行重跑和审计。

| 步骤 | 实现方式 | 关键文件 |
|---|---|---|
| 调度扫描 | Worker 向 `prediction-generator` 队列注册重复任务，默认每 5 分钟扫描一次。 | `apps/worker/src/main.ts` |
| 版本窗口 | 任务扫描开赛前 24h 与 2h 的时间窗口，分别生成 `T_MINUS_24H` 与 `T_MINUS_2H`。 | `apps/worker/src/jobs/prediction-generator.job.ts` |
| 模型选择 | 读取 `AiModel` 中启用模型，按 `sortOrder` 顺序调用。 | `AiModel`、`prediction-generator.job.ts` |
| Prompt 与输出 | 共享包构造 Prompt，要求模型返回固定结构化 JSON，并附带免责声明。 | `packages/shared/src/ai-pipeline` |
| 失败隔离 | 单模型失败写入失败占位结果，不阻塞其他模型与整体发布。 | `persistFailedModelPrediction` |
| 共识计算 | 汇总成功模型预测，计算 `HIGH`、`MIXED`、`STRONG_DIVERGENCE` 共识等级。 | `computeConsensusSummary` |
| 自动发布 | 只要至少一个模型成功，任务会进入 `REVIEWED` 并自动 `PUBLISHED`。 | `generatePrediction` |

## 6. 权益系统与商业闭环

所有完整模型分析访问都必须经过 `AccessService`。当前代码的真实实现优先级为 **Pass 会员 > 邀请奖励 > 每日免费额度**。游客每日可查看 1 次，注册用户每日自动补发 3 次免费额度；邀请奖励每次发放 5 次额度、有效期 7 天，每日最多发放 3 个邀请奖励；支付成功后创建 `PASS_SUBSCRIPTION` 权益并同步更新用户会员状态。

| 权益来源 | 实现模型 | 当前规则 | 前端表现 |
|---|---|---|---|
| 游客免费 | `Guest.freeUsedToday`、`freeResetDate` | 游客每日 1 次。 | 用完后引导登录。 |
| 注册用户每日免费 | `Entitlement(source=FREE_DAILY)` | 自动按天补发，当前实现每日 3 次。 | 可查看完整模型分析。 |
| 邀请奖励 | `Invitation`、`Entitlement(source=INVITE_REWARD)` | 发放 5 次、7 天有效、每日最多 3 个奖励。 | 引导邀请好友继续解锁。 |
| 会员 Pass | `Order`、`Entitlement(source=PASS_SUBSCRIPTION)`、`User.isPassActive` | 支付成功后无限查看，直到过期或被撤销。 | 会员态不扣次数。 |

> 注意：产品文档中 MVP 规则描述为“免费注册用户每日 1 场详细数据”，而当前代码实现为注册用户每日 3 次。若产品最终确认仍为每日 1 次，应修改 `apps/api/src/modules/entitlements/access.service.ts` 中的 `FREE_DAILY_MAX_USER`。

## 7. API 模块边界

API 服务全局前缀为 `/api`，健康检查为 `/health`。返回结果经过统一响应拦截器包装，请求通过 `Authorization: Bearer <token>` 或 `x-guest-token` 表示用户/游客身份。

| 模块 | 入口 | 说明 |
|---|---|---|
| Health | `GET /health` | 服务健康检查。 |
| Auth | `/api/auth/*` | 游客登录、微信登录、当前用户信息。 |
| Matches | `/api/matches/*` | 比赛列表、详情聚合、用户预测提交。 |
| Reviews | `/api/reviews/*` | 单场复盘、模型战绩、排行榜。 |
| Entitlements | `/api/entitlements/*` | 权益快照、访问判断、权益消费。 |
| Invitations | `/api/invitations/*` | 邀请码生成、接受、查询、校验。 |
| Payments | `/api/payments/*` | 订单创建、查询、取消、微信回调、非生产 mock 支付。 |
| Share | `/api/share/*` | 分享卡、分享元数据、小程序码、浏览和归因统计。 |
| Translation | `/api/translations/*` | 翻译任务创建、执行、审核、查询。 |
| Admin | `/api/admin/*` | 赛事、球队、比赛、导入、AI 模型、预测任务、订单和审计日志。 |

## 8. 本地开发

请确保 Node.js 版本不低于 20.10，并安装 pnpm。项目使用 PostgreSQL 与 Redis，因此本地开发前需要准备数据库连接和 Redis 地址。

```bash
pnpm install
cp .env.example .env
pnpm prisma:generate
pnpm prisma:migrate:dev
pnpm db:seed
pnpm dev:api
pnpm dev:worker
```

常用脚本如下。

| 命令 | 作用 |
|---|---|
| `pnpm build` | 先构建 `packages/*`，再构建 `apps/*`。 |
| `pnpm dev:api` | 以 watch 模式启动 NestJS API。 |
| `pnpm dev:worker` | 以 watch 模式启动 BullMQ Worker。 |
| `pnpm prisma:generate` | 根据 Prisma Schema 生成客户端。 |
| `pnpm prisma:migrate:deploy` | 生产环境执行已提交迁移。 |
| `pnpm db:seed` | 写入初始赛事、模型或演示数据。 |
| `pnpm typecheck` | 运行所有 workspace 的 TypeScript 检查。 |
| `pnpm test` | 运行所有 workspace 的测试。 |

## 9. 环境变量

生产环境必须通过 `.env` 或进程管理器注入环境变量，前端不得持有数据库、AI、微信支付或对象存储密钥。

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `NODE_ENV` | 是 | `development` | 运行环境，可选 `development`、`test`、`production`。 |
| `API_PORT` | 否 | `3000` | API 服务监听端口。 |
| `PUBLIC_BASE_URL` | 是 | `http://localhost:3000` | 后端公网基础 URL。 |
| `DATABASE_URL` | 是 | 无 | Prisma PostgreSQL 连接串。 |
| `DIRECT_URL` | 视数据库而定 | 无 | Prisma direct URL，Supabase/RDS 场景常用。 |
| `REDIS_URL` | 否 | `redis://localhost:6379/0` | BullMQ、缓存和队列依赖。 |
| `JWT_SECRET` | 生产必填 | `dev_jwt_secret_change_me_in_prod` | JWT 签名密钥，生产环境必须替换。 |
| `JWT_ACCESS_TTL` | 否 | `2h` | Access token 有效期。 |
| `JWT_REFRESH_TTL` | 否 | `30d` | Refresh token 有效期。 |
| `AI_OPENAI_API_KEY` | 视模型而定 | 无 | OpenAI 或兼容网关密钥。 |
| `AI_OPENAI_BASE_URL` | 视模型而定 | 无 | OpenAI 兼容网关地址。 |
| `AI_GOOGLE_API_KEY` | 视模型而定 | 无 | Google 模型密钥。 |
| `AI_ANTHROPIC_API_KEY` | 视模型而定 | 无 | Anthropic 模型密钥。 |
| `AI_ALLOW_MOCK` | 否 | 非生产为 `true` | 是否允许 AI mock 输出。生产建议关闭。 |
| `PREDICTION_SCHEDULER_CRON` | 否 | `*/5 * * * *` | Worker 预测扫描重复任务 cron。 |
| `PREDICTION_SCHEDULER_WINDOW_MINUTES` | 否 | `10` | 预测扫描窗口。 |
| `H5_BASE_URL` | 否 | `http://localhost:5173` | 分享落地页基础地址。 |
| `WECHAT_APP_ID` | 微信必填 | 无 | 微信小程序 App ID。 |
| `WECHAT_APP_SECRET` | 微信必填 | 无 | 微信小程序 App Secret。 |

## 10. 生产部署建议

生产部署应至少包含 API 进程、Worker 进程、PostgreSQL、Redis 与 Nginx。Nginx 将 `/api/` 和 `/health` 反向代理到 API，将用户前端静态资源作为根站点或独立域名提供。Worker 不暴露公网端口，只需能访问数据库、Redis、AI 网关和第三方服务。

| 进程 | 推荐管理方式 | 启动命令 | 说明 |
|---|---|---|---|
| API | systemd 或 PM2 | `pnpm --filter @ai-worldcup/api start` | 监听 `API_PORT`。 |
| Worker | systemd 或 PM2 | `pnpm --filter @ai-worldcup/worker start` | 注册 BullMQ 队列与重复任务。 |
| Redis | systemd | `redis-server` | 本机或托管 Redis 均可。 |
| PostgreSQL | 托管优先 | 无 | Supabase/RDS/自建均可，但前端不得直连。 |
| Nginx | systemd | `nginx` | HTTPS、gzip、静态资源、反向代理。 |

部署顺序建议为：先拉取代码并安装依赖，再写入环境变量，随后执行 `pnpm prisma:generate`、`pnpm prisma:migrate:deploy`、`pnpm build`，最后重启 API 和 Worker。数据库迁移必须在重启服务前完成，避免新代码访问不存在的字段。

## 11. 自动部署脚本约定

仓库预期由服务器上的自动部署服务监听 GitHub `main` 分支 push 事件。后端自动部署应执行以下动作：校验 webhook 签名，确认分支为 `refs/heads/main`，拉取最新代码，安装依赖，生成 Prisma 客户端，执行迁移，构建 workspace，最后重启 API 与 Worker。所有部署日志应写入服务器固定目录，失败时不应删除上一版可运行代码。

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm prisma:migrate:deploy
pnpm build
sudo systemctl restart ai-worldcup-api ai-worldcup-worker
```

## 12. 维护注意事项

项目的长期稳定性依赖“数据库状态可信、后台操作可追溯、AI 输出可校验、支付权益可审计”。任何新功能都不应绕过 `AccessService`、`PredictionTask` 状态机或后台审计日志。新增 AI 模型时应先在后台注册模型、设置 provider、persona、排序和配置，再由 Worker 读取启用模型参与生成。新增支付渠道时应复用 `Order` 与 `Entitlement` 抽象，不应在前端直接授予权益。

## References

[1]: https://docs.nestjs.com/ "NestJS Documentation"  
[2]: https://www.prisma.io/docs "Prisma Documentation"  
[3]: https://docs.bullmq.io/ "BullMQ Documentation"  
[4]: https://www.postgresql.org/docs/ "PostgreSQL Documentation"  
[5]: https://redis.io/docs/latest/ "Redis Documentation"  
