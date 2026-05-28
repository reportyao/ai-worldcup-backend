# ai-worldcup-backend

AI 世界杯预测产品的后端 monorepo，包含 NestJS HTTP API、BullMQ Worker 与跨端共享类型 (`@ai-worldcup/shared`)。本仓为阶段 0 工程骨架，仅提供最小可启动能力，业务逻辑将在阶段 1 起逐步落地。

> ⚠️ **CI 启用**：受沙盒 GitHub App token 权限限制，CI workflow 模板放在 `ci/ci.yml.template`。请克隆后将其复制到 `.github/workflows/ci.yml` 并手动 push 一次以激活：
>
> ```bash
> mkdir -p .github/workflows && cp ci/ci.yml.template .github/workflows/ci.yml && git add .github && git commit -m "ci: enable workflow" && git push
> ```

## 技术栈

- 运行时：Node.js >=20.10，TypeScript 5.5，pnpm 9.7 workspace
- API：NestJS 10 + Express + Pino + Throttler
- Worker：BullMQ 5 + ioredis
- ORM：Prisma 5 + PostgreSQL 16
- 校验：Zod
- 测试：Vitest
- 代码质量：ESLint + Prettier + strict TypeScript

## 目录结构

```
apps/
  api/          NestJS HTTP API
  worker/       BullMQ 消费者进程
packages/
  shared/       跨端共享枚举、Zod schema、状态机、错误码
prisma/
  schema.prisma 阶段 0 最小占位 schema
.github/workflows/ci.yml
docker-compose.yml  本地 postgres + redis
```

## 快速启动

```bash
pnpm install                         # 安装全部依赖
cp .env.example .env                 # 复制本地环境变量
docker-compose up -d                 # 启动本地 postgres 与 redis
pnpm --filter @ai-worldcup/shared build   # 构建 shared，让 api/worker 可解析类型
pnpm prisma:generate                 # 生成 Prisma Client
pnpm dev:api                         # 启动 NestJS API（默认 :3000）
pnpm dev:worker                      # 在另一终端启动 Worker
curl http://localhost:3000/health    # 健康检查应返回 { success:true, data:{ status:"ok", ... } }
```

## 常用脚本

| 脚本 | 作用 |
|---|---|
| `pnpm lint` | 全仓 ESLint |
| `pnpm typecheck` | 全仓递归 TypeScript 检查 |
| `pnpm test` | 全仓 Vitest |
| `pnpm build` | 先构建 packages，再构建 apps |
| `pnpm prisma:generate` | 生成 Prisma Client |
| `pnpm prisma:migrate:dev` | 本地数据库迁移 |
| `pnpm prisma:migrate:deploy` | 生产环境迁移 |

## 共享包说明

`packages/shared` 是前后端共享的合同源头，包含：

- 业务枚举：Locale、CompetitionType、PredictionVersion、PredictionTaskStatus、ConsensusLevel、EntitlementSource、PaymentChannel、OrderStatus、ModelPersona
- Zod schema：StructuredPrediction、ConsensusSummary、StructuredReview、PredictionTask、EntitlementSnapshot、Order、ApiResponse 包装
- 状态机：预测任务合法迁移校验
- 错误码：DomainError + ErrorCode 枚举

前端仓 `ai-worldcup-frontend` 通过同步脚本拉取该目录的只读副本，不引入 npm 私有源。

## 阶段 1 下一步

1. 完善 Prisma schema（Match、PredictionTask、PredictionResult、Review、Entitlement、Order、Invite、ShareCard）并生成首版迁移
2. 接入第三方足球数据 API（football-data.org / API-Football）做 fixtures 同步 worker
3. 实现 `auth/wechat-login`：通过 `wx.login` code 换取 openid 并签发 JWT
4. 实现 `predictions` 模块：消费多模型 AI 网关、产生结构化预测、保存原始输出快照
5. 引入 BullMQ 调度器：赛前 24h 与 2h 自动触发预测生成
6. 接入微信支付 V3 与权益（免费/邀请/Pass）三层判断
7. 灰度发布：阿里云香港轻量服务器 + Supabase Cloud / 阿里云 PostgreSQL

## 验收（阶段 0）

- [x] `pnpm install` 通过
- [x] `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` 全绿
- [x] `pnpm dev:api` 启动后 `GET /health` 返回 200
- [x] `pnpm dev:worker` 启动无报错
- [x] CI workflow 通过
