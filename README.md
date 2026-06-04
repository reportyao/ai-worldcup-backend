# 球多多 AI 足球预测 - 后端服务

## 项目简介

这是“球多多 AI 足球预测”平台的核心后端服务，负责承载用户前端、管理后台、预测生产线、数据同步、权益订单、赛后复盘与模型评估等关键能力。后端以 **NestJS + Prisma + BullMQ** 为主体架构，通过 API 服务对外提供统一接口，通过 Worker 服务执行足球数据同步、特征计算、AI 预测生成、共识聚合、赛后评分和复盘生成等异步任务。

## 核心能力：全自动化闭环系统

本项目已实现完整的自动化运行闭环，无需人工干预即可完成从数据抓取到 AI 预测再到结果统计的全过程：

1.  **定时自动抓取**：集成中国竞彩网（Sporttery）数据源，定时自动抓取销售日期、比赛双方、盘口及赛果。
2.  **自动触发预测**：新比赛同步入库后，自动入队 8 个 AI 大模型进行并行分析预测。
3.  **自动判定命中**：赛果更新后，自动触发评分系统，判定胜平负、让球、大小球、比分、半全场等维度的命中情况。
4.  **自动统计更新**：自动更新模型战绩（近 N 红 M）及全站 7 日统计数据。

## 主要模块

| 模块 | 当前能力 |
| --- | --- |
| **自动化监控** | 提供自动化任务监控接口，支持实时查看同步日志、预测任务状态及全站战绩统计。 |
| **竞彩数据源** | `SportteryAutoSync` 任务支持抓取中国竞彩网数据，包括销售日期、编号、让球盘口等关键信息。 |
| **AI 预测生产线** | 支持 8 个大模型并发预测，只要任一维度（胜平负/让球/大小球/比分/半全场/进球范围）命中即判定为“红单”。 |
| **命中判定系统** | `scorecard-update` 与 `review-generator` 协同工作，实现比赛维度（共识命中）与模型维度（个人命中）的双重统计。 |
| **7日统计 API** | `GET /matches/stats/seven-days` 接口提供最近 7 天的比赛总数、红单数、黑单数及红单率。 |

## 2026-06-04 更新记录

本次更新围绕管理后台比赛口径、完赛赛果完整性和外部自建 AI 预测数据接入进行了增强。后端已经将今日比赛、近 3 日完赛、预测任务候选比赛以及自建 AI 预测接口的数据口径统一到服务层，避免前端页面各自重复过滤导致展示不一致。

| 更新项 | 后端能力 | 涉及接口或模块 |
| --- | --- | --- |
| **今日比赛口径** | 今日比赛仅返回当日尚未完赛、尚未开赛或仍处于可预测状态的赛事，已经完赛的比赛不再混入今日待预测列表。 | `AdminService.getSportteryMatchView`、竞彩健康状态统计 |
| **近 3 日完赛口径** | 已完赛比赛统一进入近 3 日完赛列表，便于运营集中核验赛果和预测表现。 | `AdminService.getSportteryMatchView` |
| **完整赛果输出** | 完赛比赛返回胜平负、让球胜平负、大小球、比分、半全场、半场比分等完整赛果字段，并附带模型预测与命中评估对比。 | `sportteryMarkets`、`predictionTasks`、`ModelPrediction.review` |
| **自建 AI 预测接入** | 新增飞鲸 / Bet007 自建 AI 预测服务，按接口 `key` 拉取预测数据，支持 gzip/JSON 解析、5 分钟缓存、外部比赛 ID 优先匹配、本地队名和开赛时间兜底匹配。 | `FeijingAiPredictionService` |
| **后台与前台接口** | 后台可通过管理接口查看自建 AI 预测匹配结果，前台可通过公开接口展示自建 AI 预测列表。 | `GET /api/admin/custom-ai-predictions`、`GET /api/custom-ai-predictions` |

自建 AI 预测接口默认读取 `http://interface.titan007.com/football/ai.aspx`，默认密钥为本次配置的 `880306AAC9A249EA`。生产环境可以通过 `FEIJING_AI_URL`、`BET007_AI_URL`、`FEIJING_AI_KEY` 或 `BET007_AI_KEY` 覆盖默认配置，以便在不同供应商或密钥切换时无需修改代码。

## 技术栈

| 层次 | 技术 |
| --- | --- |
| 后端框架 | [NestJS](https://nestjs.com/) |
| 语言 | [TypeScript](https://www.typescriptlang.org/) |
| ORM | [Prisma](https://www.prisma.io/) |
| 队列 | [BullMQ](https://docs.bullmq.io/) + [Redis](https://redis.io/) |
| 进程管理 | [PM2](https://pm2.keymetrics.io/) |

## 关键环境变量配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SPORTTERY_DAILY_SYNC_CRON` | `0 0,6,12 * * *` | 竞彩赛程同步定时表达式（每天0/6/12点）。 |
| `SPORTTERY_RESULT_CHECK_CRON` | `*/10 * * * *` | 竞彩赛果检查定时表达式（每10分钟）。 |
| `SPORTTERY_SYNC_DAYS_AHEAD` | `3` | 向后同步的天数。 |
| `SPORTTERY_AUTO_ENQUEUE_PREDICTIONS` | `true` | 是否自动将新比赛入队 AI 预测。 |
| `FEIJING_AI_URL` / `BET007_AI_URL` | `http://interface.titan007.com/football/ai.aspx` | 自建 AI 预测接口地址，可按供应商实际地址覆盖。 |
| `FEIJING_AI_KEY` / `BET007_AI_KEY` | `880306AAC9A249EA` | 自建 AI 预测接口密钥，请优先在生产环境变量中维护。 |

## 部署与运维

### 自动部署
代码推送到 `main` 分支后，GitHub Actions 会自动部署到生产服务器。部署脚本 `deploy/production/deploy-backend.sh` 会自动补全缺失的竞彩环境变量。

### 手动补全环境变量
若需手动在服务器上配置最新环境变量，可执行：
```bash
bash /home/ubuntu/apps/ai-worldcup-backend/deploy/production/patch-env-sporttery.sh
```

## Worker 任务说明

| 队列名称 | 作用 |
| --- | --- |
| `sporttery-auto-sync` | **核心闭环入口**：同步竞彩数据、赛果，并触发后续预测与评分。 |
| `prediction-generator` | 生成 AI 多模型预测，计算共识。 |
| `scorecard-update` | 对已完赛比赛进行模型命中判定，更新模型战绩。 |
| `review-generator` | 生成赛后结构化复盘内容。 |

## 比赛统计口径约定

- **红单（红）**：一场比赛中，只要 8 个模型中有任意一个模型的任意维度预测正确，该场比赛即计为“红”。
- **黑单（黑）**：一场比赛中，所有模型的所有维度均预测错误。
- **模型战绩**：模型详情页显示“近 N 红 M”，其中 N 为总评估场数，M 为 `anyHit` 场数。
