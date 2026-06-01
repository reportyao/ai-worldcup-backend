# 世界杯人格测试与 AI PK 轻分享玩法开发进度

作者：**Manus AI**  
日期：2026-06-02

本文档用于跟踪《世界杯人格测试与AIPK轻分享玩法技术方案（最终审查修订版）》在 `ai-worldcup-backend`、`ai-worldcup-frontend` 与 `ai-worldcup-admin` 三个仓库中的落地状态。本轮开发基于远端 `main` 已有的 Foundation 数据模型继续补齐应用层闭环，重点完成 **F2 人格评分与结果接口**、**F3 分享归因泛化**、**F6 AI PK 赛前能力**、用户前端页面与管理后台运营入口。

## 1. 需求完成状态

| 模块 | 技术方案要求 | 当前状态 | 代码位置 |
|---|---|---|---|
| 人格测试 Foundation 数据模型 | 支持活动、题目、人格类型、结果、用户/游客身份绑定 | **已完成，沿用远端基线** | `prisma/schema.prisma`、`prisma/seed.ts` |
| 人格评分与结果接口 | 支持题目读取、答题提交、分数计算、结果详情、我的最近结果 | **已完成** | `apps/api/src/modules/personality/` |
| AI PK Foundation 数据模型 | 支持比赛维度 PK 记录、用户选择、AI 选择、预测快照和结算状态 | **已完成，沿用远端基线** | `prisma/schema.prisma` |
| AI PK 赛前接口 | 支持按比赛创建/更新 PK 记录、生成攻防观点、查询个人会话与详情 | **已完成** | `apps/api/src/modules/ai-pk/` |
| 活动配置 | 支持人格测试与 AI PK 的活动开关、时间窗和运营配置 | **已完成** | `apps/api/src/modules/activity/`、`prisma/migrations/202606020001_activity_play_modes/` |
| 分享归因扩展 | 支持非比赛目标分享、活动分享链接、浏览指纹去重统计 | **已完成** | `apps/api/src/modules/share/`、`ShareTrack.targetType/targetId`、`ShareViewEvent` |
| 用户前端人格测试 | 支持加载题目、答题、提交、结果展示和轻分享 | **已完成** | `ai-worldcup-frontend/src/pages/PersonalityTestPage.tsx` |
| 用户前端 AI PK | 支持从比赛发起 PK、展示攻防观点、裁决结果和分享 | **已完成** | `ai-worldcup-frontend/src/pages/AiPkPage.tsx`、`MatchDetailPage.tsx` |
| 分享落地页 | 支持人格测试结果与 AI PK 会话的活动分享落地 | **已完成** | `ai-worldcup-frontend/src/pages/ShareLandingPage.tsx` |
| 管理后台运营 | 支持活动配置维护和人格测试题目维护 | **已完成** | `ai-worldcup-admin/src/pages/activity-play/` |

## 2. 本轮主要实现内容

后端保留远端已新增的 `PersonalityActivity`、`PersonalityType`、`PersonalityQuestion`、`PersonalityTestResult` 与 `AiPkRecord` 等 Foundation 模型，不再重复创建简化版玩法表。本轮增量迁移仅补充 `ActivityConfig`、分享目标泛化字段以及 `ShareViewEvent` 浏览去重表，避免与 Foundation 迁移重复建表。

人格测试模块已经改为围绕 `worldcup-personality-v1` 活动编码工作，题目选项兼容 Foundation seed 中的 `{ key, label, weights }` 结构，同时对前端保持 `id/optionId` API 兼容。提交答案时会累计各人格 code 权重，写入 `PersonalityTestResult`，并返回结果标题、描述、人格标签、强度指标、同人格人数快照与分享链接。

AI PK 模块已经改为写入 `AiPkRecord`。接口会读取比赛、球队和最近一次成功 AI 预测，形成 AI 侧选择、置信度、理由快照与适合轻分享的 PK 裁决文案。对于同一用户或游客在同一比赛下重复发起 PK，会更新既有记录而不是制造重复会话。

分享归因模块已从原有比赛分享扩展为通用活动分享，支持 `targetType` 与 `targetId`。人格测试结果和 AI PK 会话可以生成独立分享链接；浏览统计新增 `viewerHash + windowKey` 去重机制，避免同一浏览者在同一窗口内重复刷新造成 PV 膨胀。

用户前端已新增人格测试页和 AI PK 页，并在首页与比赛详情页接入入口。分享落地页已兼容活动型分享，能够根据分享目标展示人格测试结果或 AI PK 会话。管理后台新增“活动玩法”菜单页，支持维护活动开关、运营配置和人格测试题目。

## 3. 验证结果

| 仓库 | 验证命令 | 结果 |
|---|---|---|
| `ai-worldcup-backend` | `pnpm prisma generate && pnpm --filter @repo/shared build && pnpm --filter api build` | **通过** |
| `ai-worldcup-frontend` | `pnpm build` | **通过** |
| `ai-worldcup-admin` | `./node_modules/.bin/tsc -b && ./node_modules/.bin/vite build` | **通过** |

管理后台仓库使用 `pnpm build` 时会触发当前环境的依赖构建脚本许可检查，因此本轮采用直接执行本地 TypeScript 与 Vite 构建命令进行等价验证，构建结果已通过。

## 4. 上线注意事项

上线前需要在目标环境按顺序执行数据库迁移，并重新生成 Prisma Client。由于远端 `main` 已包含 Foundation 迁移，本轮迁移只追加活动配置和分享泛化能力；发布时应确保 Foundation seed 已执行，以便存在 `worldcup-personality-v1` 活动、人格类型和题库基线数据。

前端与管理后台依赖新增 API 路径，建议与后端同批发布，避免页面提前上线后接口不可用。AI PK 赛后结算、人格结果图真实图片生成等增强项仍可作为后续迭代继续扩展；当前版本已完成技术方案要求的轻分享核心闭环。
