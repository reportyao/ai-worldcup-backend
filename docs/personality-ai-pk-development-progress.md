# 世界杯人格测试与 AI PK 轻分享玩法开发计划与进度

**文档状态：执行中**  
**负责人：Manus AI**  
**创建日期：2026-06-02**  
**开发分支：`feature/personality-ai-pk-light-sharing`**  
**关联仓库：`reportyao/ai-worldcup-backend`、`reportyao/ai-worldcup-frontend`、`reportyao/ai-worldcup-admin`**

## 一、执行原则

本开发计划以《世界杯人格测试与 AI PK 轻分享玩法技术方案（最终审查修订版）》为唯一技术基线。开发过程按功能闭环拆分，每完成一个可验收功能，就执行一次代码提交、一次远端推送，并同步更新本文档的开发进度、验证结果、已知风险和下一步计划。若某个功能横跨后端、用户前端和管理后台，应以“同一功能闭环”为提交粒度，而不是按文件数量或仓库数量机械拆分。

> 核心原则是：**先保证代码一致性与可验证性，再推进功能速度**。新增玩法必须复用现有用户/游客身份、邀请、分享归因、前端 API 封装、深色移动端 UI 标准和后台 Ant Design 路由体系，不新增平行身份系统、平行邀请系统或平行分享归因系统。

## 二、仓库与分支策略

三个仓库统一使用 `feature/personality-ai-pk-light-sharing` 作为开发分支。功能开发完成后，根据实际改动分别在对应仓库提交；如果某个功能只涉及后端，则只提交后端仓库；如果涉及多端联调，则分别在相关仓库提交，并在本文档同一进度行中记录多个提交哈希。

| 仓库 | 职责 | 当前开发分支 | 计划改动范围 |
|---|---|---|---|
| `ai-worldcup-backend` | 数据模型、接口、分享归因、图片生成、seed、测试 | `feature/personality-ai-pk-light-sharing` | Prisma 模型、人格模块、AI PK 模块、分享泛化、开发进度文档 |
| `ai-worldcup-frontend` | 用户前端页面、组件、API 封装、分享回流 | `feature/personality-ai-pk-light-sharing` | 人格测试页、结果页、分享落地页、AI PK 入口与弹层 |
| `ai-worldcup-admin` | 活动运营入口和指标看板 | `feature/personality-ai-pk-light-sharing` | 二期后台入口、配置页和指标页骨架 |

GitHub CLI 认证已于 2026-06-02 恢复，三个仓库的 `feature/personality-ai-pk-light-sharing` 分支均已推送到远端。后续开发必须继续在该分支上进行，并以本文档作为跨三端进度追踪基线。

## 三、质量闸门

每个功能完成后必须通过与其相关的最小验证集合。后端改动至少执行 TypeScript 类型检查、Prisma 生成和相关测试；用户前端改动至少执行类型检查和构建；管理后台改动至少执行类型检查和构建。若某个仓库当前存在历史问题导致全量命令失败，必须在进度文档中明确区分“本功能新增问题”和“历史既有问题”，不得掩盖。

| 类别 | 必跑命令 | 通过标准 |
|---|---|---|
| 后端模型与接口 | `pnpm prisma:generate`、`pnpm typecheck`、相关 `pnpm test` | Prisma Client 可生成，新增模块类型无错误，关键服务测试通过 |
| 用户前端 | `pnpm typecheck`、`pnpm build` | 新页面和组件类型正确，构建产物生成成功 |
| 管理后台 | `pnpm typecheck`、`pnpm build` | 路由、菜单、表单和表格类型正确，构建成功 |
| 分享归因 | 后端集成测试或最小脚本验证 | 旧比赛分享兼容，新 target 能生成正确 URL，view 不双计 |
| 跨端联调 | 手工冒烟记录 | 完成测试、查看结果、生成分享、回流跟测或 AI PK 的主链路可跑通 |

## 四、功能拆分与开发顺序

开发顺序采用“后端基础能力优先，前端闭环随后，AI PK 与后台增量推进”的策略。这样可以先稳定数据结构和接口契约，再让前端基于确定接口实现交互，避免 UI 完成后因数据模型变化反复返工。

| 顺序 | 功能包 | 主要产物 | 涉及仓库 | 验收口径 | 状态 |
|---|---|---|---|---|---|
| F0 | 开发计划与进度文档 | `docs/personality-ai-pk-development-progress.md` | backend | 文档进入 GitHub，后续每个功能更新此文档 | 进行中 |
| F1 | 后端数据模型与 seed | Prisma 枚举和模型、反向 relation、初始 12 人格/12 题/文案池 seed | backend | `prisma generate` 通过，seed 幂等，不破坏现有模型 | 未开始 |
| F2 | 人格评分与结果接口 | `personality-test` 模块、config、submit、result、event 接口和评分测试 | backend | 游客和登录用户都能提交并读取稳定结果 | 未开始 |
| F3 | 分享归因泛化 | 扩展 `/share/track`、目标类型、metadata、非比赛 URL、view 去重 | backend | 旧比赛分享兼容，新人格和 AI PK 分享可追踪 | 未开始 |
| F4 | 人格结果图生成 | 人格 PNG 卡片接口、二维码、缓存 key、错误降级 | backend | 给定 resultId 可生成稳定图片，非法访问安全降级 | 未开始 |
| F5 | 用户前端人格测试闭环 | 测试页、结果页、API 封装、分享弹窗、回流页 | frontend | 移动端可完成答题、查看结果、保存图、分享回流和跟测 | 未开始 |
| F6 | AI PK 后端赛前能力 | AI PK summary、站队记录、理由生成、事件记录 | backend | 比赛详情可读取 AI 倾向，用户可创建 PK 记录 | 未开始 |
| F7 | AI PK 前端赛前闭环 | 比赛详情入口、选择弹层、PK 结果卡、分享落地页 | frontend | 用户可与 AI 同选或反选，并生成赛前立 Flag 图 | 未开始 |
| F8 | AI PK 赛后结算 | 结算服务、结算快照、赛后打脸账单图片 | backend、frontend | 完赛后记录可结算，落地页自动切换赛后状态 | 未开始 |
| F9 | 后台运营入口 | 活动运营顶级路由、配置页骨架、指标页骨架 | admin、backend | 后台路由可访问，指标接口与页面骨架类型正确 | 未开始 |
| F10 | 总体验证与整理 | 跨端冒烟、回归检查、文档收口 | backend、frontend、admin | 主链路通过，进度文档记录最终提交和验证结果 | 未开始 |

## 五、提交与推送规范

每个功能包完成后按如下顺序执行：第一，更新代码和测试；第二，运行质量闸门；第三，更新本文档中的状态、提交哈希、验证结果和风险；第四，提交代码；第五，推送到远端同名分支。提交信息统一使用 `feat(scope): ...`、`fix(scope): ...`、`docs(scope): ...` 或 `test(scope): ...`。

| 场景 | 提交信息示例 | 说明 |
|---|---|---|
| 开发计划 | `docs(personality-ai-pk): add development plan and progress tracker` | 只包含计划文档和进度文档 |
| 数据模型 | `feat(personality-ai-pk): add activity data models and seed` | 包含 Prisma、migration、seed 和相关验证 |
| 后端接口 | `feat(personality-test): add result APIs and scoring service` | 包含 controller、service、schema 和测试 |
| 前端闭环 | `feat(personality-test): add quiz and result sharing flow` | 包含页面、组件、API 封装和构建验证 |
| 进度修订 | `docs(personality-ai-pk): update progress after F1` | 若某功能跨仓库，可在主文档仓库单独补充进度提交 |

## 六、进度记录

| 日期 | 功能包 | 仓库 | 提交哈希 | 验证结果 | 状态 | 备注 |
|---|---|---|---|---|---|---|
| 2026-06-02 | F0 开发计划与进度文档 | backend | `d2eebf4` | Markdown 结构检查通过；后端分支已推送；前端和后台同名分支已推送 | 完成 | 进度文档已进入 GitHub，后续每个功能必须更新本文档 |

## 七、当前阻塞与处理

当前 GitHub CLI 认证已恢复，F0 阻塞已解除。后续如果再次出现认证问题，应立即在本节记录影响范围、失败命令和恢复动作；在无法推送期间可以继续本地开发，但不得声称远端已更新。

| 阻塞项 | 影响 | 处理动作 | 状态 |
|---|---|---|---|
| GitHub CLI token invalid | 曾导致 fetch/push 失败 | 已重新登录并推送三端开发分支 | 已解决 |

## 八、下一步行动

下一步进入 F1，优先改造后端 Prisma 模型和 seed，因为它是人格结果、AI PK 记录、分享图片和前端页面的共同契约。F1 完成后需要提交并推送后端仓库，同时再次更新本文档的进度记录。
