# 球多多 AI 足球预测 - 后端服务

## 项目简介

这是“球多多 AI 足球预测”平台的核心后端服务，负责承载用户前端、管理后台、预测生产线、数据同步、权益订单、赛后复盘与模型评估等关键能力。后端以 **NestJS + Prisma + BullMQ** 为主体架构，通过 API 服务对外提供统一接口，通过 Worker 服务执行足球数据同步、特征计算、AI 预测生成、共识聚合、赛后评分和复盘生成等异步任务。

平台当前已经完成多联赛数据接入、世界杯数据口径修复、比赛列表四类 Tab 查询、AI 预测 Sprint A 闭环建设，并在生产环境部署运行。Sprint A 的核心目标是让每一次预测都有可追溯输入、可稳定解析输出、可自动赛后评估，并能用概率评分持续比较模型质量。

## 当前线上入口

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| API 域名 | `http://api.qiuduoduo.online` | 面向前端与管理后台的后端 API。 |
| API IP | `http://82.157.76.140:3000` | 生产服务器 API 直连入口。 |
| 健康检查 | `/api/health` | 用于确认 API 服务运行状态。 |

## 主要能力

| 模块 | 当前能力 |
| --- | --- |
| 用户与认证 | 支持游客、微信用户、管理员会话与后台登录。管理后台超级管理员账号由生产环境配置控制。 |
| 赛事与比赛 | 支持赛事、赛季、球队、比赛管理，已修复世界杯 2026 与历史世界杯数据的 season-scoped externalId 口径。 |
| 比赛列表 API | 支持 `today`、`worldcup`、`others`、`finished` 四类 Tab 查询；世界杯支持小组/阶段筛选，其他联赛支持 `competitionId` 快速筛选，已完赛展示最近三天有比分比赛并统一状态。 |
| 足球数据同步 | 通过 API-Football 同步联赛元数据、球队、未来赛程和实时比分，并保存同步日志、摘要和错误信息。若缺少 API key，Worker 会安全跳过同步调度。 |
| 特征引擎 | 基于历史比赛、近期状态和交锋信息生成 `MatchFeature`，并为预测任务提供统一 Prediction Pack。 |
| AI 预测生产线 | 支持多模型并发预测、结构化 JSON 输出、提示词变量注入、模型失败记录和共识聚合。 |
| Sprint A 预测闭环 | 预测前强制生成并绑定输入快照；失败模型不进入共识；AI 输出执行 JSON 抽取、修复、概率归一化与协议校验；赛后自动评分。 |
| 概率评分 | `ModelPrediction` 已记录 `actualOutcome`、`outcomeProbability`、`brierScore`、`logLoss`、`evaluatedAt`；`ModelScorecard` 已聚合概率评分样本数、平均 Brier 和平均 LogLoss。 |
| 后台运维 API | 支持预测任务触发、发布、下架、重跑、手动触发单场评分、批量评分扫描和审计日志。 |
| 权益订单 | 支持比赛级解锁、权益消费、订单记录和会员权益同步。 |
| 分享与增长 | 支持分享卡片、邀请码与增长相关接口。 |

## Sprint A 预测评估闭环

Sprint A 已经将预测链路从“生成结果”推进到“可评估、可追溯、可迭代”的基础阶段。每个预测任务在执行前会强制生成并绑定 `MatchFeature` 快照，避免预测结果后续无法解释输入来源。AI 输出经过更严格的 JSON 提取、修复、Schema 校验和概率归一化后才会写入模型预测表，失败或无效输出会被记录但不会参与最终共识。

| 环节 | 实现说明 | 关键落库字段或任务 |
| --- | --- | --- |
| 输入快照 | 预测任务执行前创建并绑定 `MatchFeature`，预测任务记录 `featureSnapshotId`。 | `PredictionTask.featureSnapshotId`、`MatchFeature.summaryText`、`MatchFeature.signalsJson` |
| 模型输出 | 结构化输出执行 JSON 抽取、修复、校验和概率归一化。 | `ModelPrediction.rawJson`、`ModelPrediction.errorMessage` |
| 共识聚合 | 仅成功且结构化有效的模型预测进入共识计算。 | `PredictionTask.consensusJson` |
| 赛后评分 | 比赛完赛时自动触发评分与复盘；Worker 也注册周期性扫描任务回填未评估比赛。 | `scorecard-update` 队列 |
| 概率质量 | 对实际赛果对应概率计算 Brier Score 和 Log Loss，用于比较模型概率校准能力。 | `outcomeProbability`、`brierScore`、`logLoss`、`probabilitySampleSize` |

## 比赛列表查询约定

公开比赛列表接口保持向后兼容，并扩展了 Tab 级查询参数。前端 `/matches` 页面依赖这些参数完成“今日、世界杯、其他、已完赛”的统一展示。

| 查询参数 | 示例 | 说明 |
| --- | --- | --- |
| `tab` | `today` | 可选值包括 `today`、`worldcup`、`others`、`finished`。 |
| `group` | `A` | 仅用于世界杯 Tab，可按小组或阶段筛选。 |
| `competitionId` | `xxx` | 主要用于其他联赛 Tab 的小菜单快速筛选。 |
| `pageSize` | `20` | 控制分页返回数量。 |

已完赛 Tab 的服务端逻辑会优先展示最近三天有比分的比赛，并将历史有比分但同步状态仍不一致的用户侧状态归一为 `FINISHED`，避免前端出现“已完赛列表仍显示进行中”的混乱体验。

## 技术栈

| 层次 | 技术 |
| --- | --- |
| 后端框架 | [NestJS](https://nestjs.com/) |
| 语言 | [TypeScript](https://www.typescriptlang.org/) |
| ORM | [Prisma](https://www.prisma.io/) |
| 数据库 | PostgreSQL / MySQL 兼容设计，生产以当前部署环境为准。 |
| 队列 | [BullMQ](https://docs.bullmq.io/) + [Redis](https://redis.io/) |
| 进程管理 | [PM2](https://pm2.keymetrics.io/) |
| AI 接入 | OpenAI 兼容接口，可通过 NEXUS AI 等中转服务接入多模型。 |

## 本地开发

```bash
git clone https://github.com/reportyao/ai-worldcup-backend.git
cd ai-worldcup-backend
pnpm install
cp .env.example .env
pnpm prisma generate
pnpm prisma migrate dev
pnpm start:dev
```

Worker 进程需要单独启动，用于处理预测、同步、评分和复盘等异步任务。

```bash
pnpm start:worker
```

## 关键环境变量

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | Prisma 数据库连接字符串。 |
| `REDIS_HOST`、`REDIS_PORT` | BullMQ 队列依赖的 Redis 配置。 |
| `OPENAI_API_KEY`、`OPENAI_BASE_URL` | OpenAI 兼容模型服务配置。 |
| `API_FOOTBALL_BASE_URL`、`API_FOOTBALL_KEY` | API-Football 数据同步配置。 |
| `API_FOOTBALL_DEFAULT_LEAGUES` | 默认同步联赛 ID，使用逗号分隔。 |
| `FOOTBALL_DATA_FIXTURE_SYNC_CRON` | 未来赛程同步定时表达式。 |
| `FOOTBALL_DATA_LIVE_SYNC_CRON` | 实时比分同步定时表达式。 |
| `FOOTBALL_DATA_SYNC_SEASON` | 默认同步赛季。 |
| `ADMIN_EMAIL`、`ADMIN_PASSWORD` | 管理后台超级管理员登录配置。 |

生产环境变量保存在服务器端，不应提交到仓库。当前生产提示中若出现 `API_FOOTBALL_KEY is not configured`，表示数据同步调度不会注册，但预测评估、管理接口和其他队列仍可正常运行。

## 数据库迁移

```bash
pnpm prisma migrate dev
pnpm prisma generate
pnpm build
```

生产发布时应使用：

```bash
pnpm prisma migrate deploy
pnpm prisma generate
pnpm build
```

最近关键迁移包括 `20260603120000_sprint_a_prediction_evaluation`，它新增了预测输入快照关联、模型预测赛后评分字段、模型概率评分聚合字段及相关索引。

## Worker 任务说明

| 队列或任务 | 作用 |
| --- | --- |
| `prediction-generator` | 生成 AI 多模型预测，绑定输入快照并计算共识。 |
| `feature-compute` | 计算比赛特征快照。 |
| `scorecard-update` | 对已完赛比赛进行模型命中与概率质量评分，支持单场与批量扫描。 |
| `review-generator` | 生成赛后复盘内容。 |
| `football-data-sync` | 同步联赛、球队、赛程和实时比分。 |

数据同步任务在比赛从非完赛变为完赛时，会自动触发赛后评分和复盘队列。Worker 启动时也会注册评分扫描任务，以便回填遗漏的完赛比赛。

## API-Football 数据同步

后台管理接口提供联赛元数据、球队、未来赛程和实时比分同步能力。同步任务会写入 `FootballDataSyncLog`，其中保存提供方、同步范围、请求参数、运行状态、错误消息和写入摘要，便于审计与故障排查。

| 同步范围 | 主要作用 | 是否建议开启预测入队 |
| --- | --- | --- |
| `LEAGUES` | 根据 API-Football 联赛与赛季信息维护本地赛事。 | 否 |
| `TEAMS` | 同步所选联赛的球队基础资料与外部 ID。 | 否 |
| `FIXTURES` | 同步日期范围内的未来赛程、比赛状态和比分。 | 是 |
| `LIVE_SCORES` | 高频刷新正在进行比赛的状态和比分。 | 否 |

## 内置数据集与文档

仓库包含已脱敏的数据集与交付文档，主要保存在 `data/` 与 `docs/` 目录，用于离线分析、导入脚本和后续特征工程迭代。

| 数据目录 | 内容 | 关键文档 |
| --- | --- | --- |
| `data/worldcup-2026/` | 2026 FIFA World Cup 参赛队伍标准化数据、原始响应、校验脚本和校验结果。 | `data/worldcup-2026/worldcup_2026_teams_validation_report.md` |
| `data/recommended-leagues/` | 推荐联赛/赛事的球队、积分榜、赛程/赛果、射手榜汇总数据。 | `data/recommended-leagues/recommended_leagues_validation_report.md` |
| `docs/data_delivery_summary.md` | 三仓库代码、数据抓取、校验结论和后续建议摘要。 | `docs/data_delivery_summary.md` |

## 自动部署

本仓库已配置 GitHub Actions 自动部署工作流。代码推送到 `main` 分支后，会将源码同步到生产服务器 `/home/ubuntu/apps/ai-worldcup-backend`，并执行 `deploy/production/deploy-backend.sh`。部署脚本会安装依赖、生成 Prisma Client、执行数据库迁移、构建后端应用，并通过 PM2 重载 `ai-worldcup-api` 与 `ai-worldcup-worker`。

| 部署项 | 说明 |
| --- | --- |
| 生产目录 | `/home/ubuntu/apps/ai-worldcup-backend` |
| 部署脚本 | `deploy/production/deploy-backend.sh` |
| PM2 服务 | `ai-worldcup-api`、`ai-worldcup-worker` |
| 静态配置 | `.env` 只保留在服务器端，自动同步时不应覆盖。 |

## 开发与提交规范

新增后端能力时，应同时考虑数据库迁移、Prisma Client 生成、API 返回类型、Worker 幂等性、生产环境变量和后台运维入口。涉及预测准确率的改动必须保证输入可追溯、输出可校验、失败可记录、评估可回放。

提交前至少执行：

```bash
pnpm prisma generate
pnpm build
```

## References

[1]: https://nestjs.com/ "NestJS Documentation"
[2]: https://www.prisma.io/ "Prisma ORM"
[3]: https://docs.bullmq.io/ "BullMQ Documentation"
[4]: https://pm2.keymetrics.io/ "PM2 Process Manager"
