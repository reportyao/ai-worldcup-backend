# 数据集说明

本目录保存本项目基于 apifootball.com 抓取并校验后的足球数据集，当前包含 **2026 世界杯参赛队伍数据** 与 **23 个推荐联赛/赛事核心数据**。所有请求过程使用账号后台 API key 执行，但提交到仓库的请求 URL 与日志均已脱敏，不应包含任何明文密钥。

## 数据集目录

| 目录 | 内容 | 主要用途 |
|---|---|---|
| `worldcup-2026/` | 2026 FIFA World Cup 48 支参赛队伍标准化 JSON/CSV、原始响应、校验脚本与校验报告。 | 用于世界杯参赛队伍展示、国家队基础资料建模与预测前置校验。 |
| `recommended-leagues/` | 23 个推荐联赛/赛事的球队、积分榜、赛程/赛果、射手榜汇总表、原始响应、抓取脚本、索引与质量报告。 | 用于球员状态、俱乐部/国家队实力参考、跨联赛比较与 AI 预测特征补充。 |

## 2026 世界杯数据

`worldcup-2026/worldcup_2026_teams.json` 与 `worldcup-2026/worldcup_2026_teams.csv` 保存 48 支参赛队伍标准化结果。校验报告位于 `worldcup-2026/worldcup_2026_teams_validation_report.md`，结论为 48/48 完整、无重复、无缺失 FIFA 三字码、无缺失洲际归属。

| 指标 | 结果 |
|---|---:|
| 参赛队伍 | 48 |
| 完整性 | 48/48 |
| 重复队名 | 0 |
| 缺失 FIFA 三字码 | 0 |
| 缺失洲际归属 | 0 |

## 推荐联赛数据

`recommended-leagues/` 覆盖世界杯正赛、6 个洲际资格赛、欧冠/欧联/欧会杯、欧洲五大联赛、MLS、Liga MX、巴西甲、阿根廷甲、AFC Champions League Elite、J1、K League 1 与中超。质量报告位于 `recommended-leagues/recommended_leagues_validation_report.md`。

| 汇总文件 | 记录数 | 说明 |
|---|---:|---|
| `recommended-leagues/all_teams.json` / `.csv` | 859 | 23 个联赛/赛事球队基础资料汇总。 |
| `recommended-leagues/all_standings.json` / `.csv` | 884 | 联赛积分榜或分组排名汇总。 |
| `recommended-leagues/all_events.json` / `.csv` | 6154 | 赛程与赛果数据汇总。 |
| `recommended-leagues/all_topscorers.json` / `.csv` | 1487 | 射手榜数据汇总。 |

## 已知限制

当前账号或接口参数下，odds 赔率接口未返回可用数据，因此赔率记录数为 0。OFC World Cup Qualifiers 的积分榜接口为空，AFC Champions League Elite 的赛程接口为空；这些空响应均已保留在原始响应和质量报告中，便于后续复查。

## 安全要求

提交前已执行密钥扫描，结果为 `secret_scan=passed`。后续更新本目录时，请继续遵守以下规则：不要提交 `.env` 文件，不要把 apifootball.com API key 写入脚本、日志、请求 URL 或 Markdown 文档；如需重新抓取数据，请通过环境变量或本地未跟踪配置文件读取密钥。
