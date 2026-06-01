# 多联赛足球 AI 预测系统 MVP：开发差距与下一步行动指南

作者：**Manus AI**  
日期：2026-06-01

通过对比你提供的《多联赛足球AI预测系统MVP技术方案.md》文档，以及实际的 GitHub 项目（`ai-worldcup-frontend`、`ai-worldcup-backend`、`ai-worldcup-admin`）代码与数据库现状，我为你梳理了当前项目的实际完成度，以及接下来还需要进行的核心开发工作。

## 1. 当前数据库现状分析

根据后端的 `prisma/schema.prisma`、`prisma/seed.ts` 以及数据同步 Worker (`data-sync.job.ts`) 的实现，当前数据库的现状如下：

### 1.1 已有的基础结构与数据
- **赛事、球队与比赛**：数据库已建有 `Competition`、`Team`、`Match` 三张核心业务表。`seed.ts` 中仅预置了 1 条 `WC-2026` 赛事、32 支世界杯参赛队伍以及 6 场样本比赛，属于纯演示数据。
- **数据同步能力**：后台和 Worker 已经实现了基于 `API-Football` 的基础同步功能，支持拉取联赛（`get_leagues`）、球队（`get_teams`）、赛程（`get_events`）和实时比分（`match_live=1`）。
- **AI 预测与用户链路**：数据库中包含 `AiModel`、`PredictionTask`、`ModelPrediction` 等 AI 流水线表，以及用户（`User`）、游客（`Guest`）、权益（`Entitlement`）、分享归因等完整 C 端链路表。
- **离线数据集**：`data/recommended-leagues/` 目录下已经通过离线脚本抓取了 23 个推荐联赛的 859 支球队、6154 场比赛等结构化数据，但**尚未导入到业务数据库中**。

### 1.2 缺失的核心结构（技术方案要求但尚未实现）
- **原始数据层 (Raw Layer)**：文档要求建立 `football_api_raw_events` 等原始表保存第三方 API 的原始 JSON 响应以便重算，当前 `schema.prisma` 中仅有 `FootballDataSyncLog` 记录同步日志，未保存比赛的原始 JSON 快照。
- **事件层与统计数据**：当前 `Match` 表仅保存了比分和状态，**缺失**了文档中要求的 `football_match_events`（进球、红黄牌）、`football_lineups`（阵容）、`football_match_statistics`（技术统计）和 `football_odds_snapshots`（赔率快照）表。
- **特征工程层**：文档强烈建议建立 `football_team_features` 和 `football_match_features` 表来存储预测用的聚合特征（如近期状态、攻防能力、主客场表现）。当前完全没有这些表，也没有计算特征的代码。
- **大模型输入包 (Prediction Pack)**：当前的预测 Worker (`prediction-generator.job.ts`) 传给大模型的上下文（`toMatchContext`）仅包含比赛名称、时间、主客队名称等最基础的元数据，没有传入任何近期状态、赔率、阵容等决定性特征。

## 2. 核心开发差距对比

基于文档中的“推荐的 MVP 最小闭环”和“开发拆分”计划，当前项目进度主要停留在 **Sprint 1 的前半部分**和 **C 端展示的壳子**，在“AI 预测的灵魂（数据特征）”上存在较大差距。

| 目标/模块 | 文档设计要求 | 当前实际代码/数据库现状 | 差距与优先级 |
|---|---|---|---|
| **数据底座** | 保存原始 JSON；多联赛分级同步；建立原始表。 | 仅映射基础字段到 `Match`/`Team` 表；有同步框架，但未保存原始 JSON。 | **高**：需修改 `data-sync.job.ts` 和 Prisma 模型，增加原始 JSON 保存能力。 |
| **离线数据导入** | 建立多联赛数据底座。 | 离线抓取了 23 个联赛数据，但 `seed.ts` 只有 32 支球队。 | **高**：需编写脚本将 `data/` 目录的 JSON 导入到数据库。 |
| **特征工程** | 计算近期状态、攻防、主客场、赛程疲劳等特征。 | **完全缺失**。当前传给 AI 的只有队名和时间。 | **极高**：这是预测准确率的核心，目前 AI 纯靠“幻觉”或基础常识在预测。 |
| **基础概率模型** | 规则打分+赔率隐含概率，用于 AI 失败降级。 | **完全缺失**。 | **中**：可延后，但特征工程必须先做。 |
| **大模型调用策略** | 后端生成 `Prediction Pack`，分级路由调用大模型。 | 已有 `AiGatewayService` 和多模型路由，但输入 Prompt 缺少结构化特征数据。 | **极高**：需重构 `prediction-generator.job.ts` 的输入组装逻辑。 |
| **回测闭环** | 保存输入快照、特征版本、提示词版本、模型输出和赛果。 | 已保存 `promptSnapshot` 和 `structuredOutput`，也有 `scorecard.service.ts`，但缺少**输入特征快照**。 | **高**：回测的前提是知道当时输入了什么特征。 |

## 3. 接下来需要做的开发工作

为了让系统从一个“空壳”变成文档中描述的、具备长期迭代价值的“多联赛足球 AI 预测系统”，建议你按照以下顺序开展下一步开发：

### 第一步：夯实数据底座与特征表（数据库层）
1. **修改 Prisma Schema**：
   - 新增 `RawMatchData` 表，用于在 `data-sync.job.ts` 同步时，将 API-Football 返回的单场比赛完整 JSON 原封不动地存下来。
   - 新增 `MatchFeature` 表，包含 `matchId`、`featureVersion`、`featuresJson` 等字段，用于存储计算好的特征。
2. **导入离线数据集**：
   - 编写一个初始化脚本，将 `data/recommended-leagues/` 目录下的 `all_teams.json`、`all_events.json` 等数据批量导入到数据库的 `Competition`、`Team` 和 `Match` 表中，形成真实的多联赛底座。

### 第二步：开发特征计算引擎（后端逻辑）
当前 AI 预测最大的问题是“巧妇难为无米之炊”。你需要开发一个特征计算服务（`FeatureCalculationService`）：
1. **历史战绩统计**：基于已导入的比赛数据，计算主客队各自的“近 5/10 场胜平负”、“场均进球/失球”。
2. **主客场表现**：计算主队的主场胜率、客队的客场胜率。
3. **休息天数计算**：根据上一场比赛的时间，计算双方的休息天数。
4. 将这些计算结果打包成一个 JSON，存入第一步创建的 `MatchFeature` 表中。

### 第三步：重构 AI 预测输入（Prediction Pack）
修改 `apps/worker/src/jobs/prediction-generator.job.ts` 和 `packages/shared/src/ai-pipeline/index.ts`：
1. 在触发预测前，先读取或计算该场比赛的 `MatchFeature`。
2. 将原有的基础上下文（`AiGatewayMatchContext`）扩展，加入特征数据。
3. 修改 Prompt 模板，让大模型基于你传入的“近期战绩、进失球、休息天数”等硬核特征进行推理，而不是只看队名。
4. 将本次预测使用的完整特征 JSON 作为 `inputSnapshot` 保存到 `ModelPrediction` 表中，为未来的回测打下基础。

### 第四步：完善数据源（二期考虑）
在完成前三步后，你的 MVP 就具备了“基于历史数据特征进行 AI 预测”的闭环能力。之后再考虑：
1. 接入 API-Football 的赔率（Odds）接口，补充赔率特征。
2. 接入阵容（Lineups）和伤停数据。
3. 完善后台的特征版本对比和回测报表展示。

## 总结

你现有的代码在**多模型路由、C 端展示、用户系统和任务调度**上做得非常好，已经是一个成熟的工程框架。但作为“预测系统”，它目前缺少**特征工程**和**数据喂养**。

接下来最紧迫的任务是：**不要再花时间在前端 UI 或增加新模型上，而是立刻把 `data/` 目录的离线数据导进去，写一个脚本计算两支球队的近期胜率和进失球，然后把这些真实数据塞进大模型的 Prompt 里。** 只有这样，你的 AI 预测才真正有了依据。
