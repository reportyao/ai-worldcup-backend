# 推荐联赛 apifootball.com 数据抓取与质量报告

本报告记录了基于项目预测与内容展示价值筛选的推荐联赛清单，以及通过 apifootball.com 官方接口抓取后的核心数据覆盖情况。抓取过程使用账号后台 API key 执行，但所有保存的请求 URL 均已脱敏，不包含密钥。

## 一、推荐范围

- 推荐联赛/赛事总数：**23**。
- 分层覆盖：**americas** 4 个；**asia** 4 个；**europe_club** 3 个；**international** 7 个；**top5** 5 个。
- 推荐逻辑：优先覆盖世界杯正赛与各洲资格赛、欧战、欧洲五大联赛、美洲高热度联赛、亚洲代表性赛事与联赛，以支持国家队实力、球员状态和跨联赛比较建模。

## 二、联赛清单与核心数据量

| 优先级 | 分层 | 推荐项 | apifootball league_id | 官方名称 | 赛季 | 国家/地区 | 球队 | 积分榜 | 赛程/赛果 | 射手榜 | 赔率 |
|---:|---|---|---:|---|---|---|---:|---:|---:|---:|---:|
| 1 | international | FIFA World Cup | 28 | World Cup | 2026 | Worldcup | 48 | 60 | 72 | 15 | 0 |
| 2 | international | UEFA World Cup Qualifiers | 24 | UEFA World Cup Qualifiers | 2026 | Europe | 54 | 54 | 204 | 20 | 0 |
| 3 | international | CONMEBOL World Cup Qualifiers | 27 | CONMEBOL World Cup Qualifiers | 2026 | South America | 10 | 10 | 93 | 15 | 0 |
| 4 | international | AFC World Cup Qualifiers | 22 | AFC World Cup Qualifiers | 2026 | Worldcup | 58 | 84 | 245 | 45 | 0 |
| 5 | international | CAF World Cup Qualifiers | 21 | CAF World Cup Qualifiers | 2026 | Worldcup | 54 | 126 | 300 | 15 | 0 |
| 6 | international | Concacaf World Cup Qualifiers | 23 | Concacaf World Cup Qualifiers | 2026 | Worldcup | 32 | 54 | 102 | 34 | 0 |
| 7 | international | OFC World Cup Qualifiers | 26 | OFC World Cup Qualifiers | 2026 | Worldcup | 11 | 0 | 18 | 24 | 0 |
| 10 | europe_club | UEFA Champions League | 3 | UEFA Champions League | 2025/2026 | Europe | 82 | 36 | 281 | 70 | 0 |
| 11 | europe_club | UEFA Europa League | 4 | UEFA Europa League | 2025/2026 | Europe | 77 | 36 | 273 | 70 | 0 |
| 12 | europe_club | UEFA Conference League | 683 | UEFA Conference League | 2025/2026 | Europe | 164 | 72 | 409 | 200 | 0 |
| 20 | top5 | Premier League | 152 | Premier League | 2025/2026 | England | 20 | 20 | 388 | 70 | 0 |
| 21 | top5 | La Liga | 302 | La Liga | 2025/2026 | Spain | 20 | 20 | 392 | 70 | 0 |
| 22 | top5 | Serie A | 207 | Serie A | 2025/2026 | Italy | 20 | 20 | 381 | 70 | 0 |
| 23 | top5 | Bundesliga | 175 | Bundesliga | 2025/2026 | Germany | 19 | 18 | 324 | 70 | 0 |
| 24 | top5 | Ligue 1 | 168 | Ligue 1 | 2025/2026 | France | 21 | 18 | 311 | 70 | 0 |
| 32 | americas | MLS | 332 | MLS | 2026 | USA | 32 | 30 | 511 | 91 | 0 |
| 33 | americas | Liga MX | 235 | Liga MX | 2025/2026 | Mexico | 18 | 54 | 337 | 95 | 0 |
| 34 | americas | Brazil Serie A | 99 | Serie A | 2026 | Brazil | 20 | 20 | 380 | 70 | 0 |
| 35 | americas | Argentina Primera División | 44 | Liga Profesional Argentina | 2026 | Argentina | 30 | 60 | 495 | 101 | 0 |
| 40 | asia | AFC Champions League Elite | 727 | AFC Champions League | 2025/2026 | intl | 21 | 24 | 0 | 137 | 0 |
| 42 | asia | J1 League | 209 | J1 League | 2026 | Japan | 20 | 40 | 200 | 20 | 0 |
| 43 | asia | K League 1 | 219 | K League 1 | 2026 | Korea Republic | 12 | 12 | 198 | 45 | 0 |
| 44 | asia | Chinese Super League | 118 | Chinese Super League | 2026 | China PR | 16 | 16 | 240 | 70 | 0 |

## 三、汇总数据规模

| 数据表 | 汇总记录数 | 输出文件 |
|---|---:|---|
| all_teams | 859 | `/home/ubuntu/worldcup-work/data/recommended-leagues/all_teams.json` / `/home/ubuntu/worldcup-work/data/recommended-leagues/all_teams.csv` |
| all_standings | 884 | `/home/ubuntu/worldcup-work/data/recommended-leagues/all_standings.json` / `/home/ubuntu/worldcup-work/data/recommended-leagues/all_standings.csv` |
| all_events | 6154 | `/home/ubuntu/worldcup-work/data/recommended-leagues/all_events.json` / `/home/ubuntu/worldcup-work/data/recommended-leagues/all_events.csv` |
| all_topscorers | 1487 | `/home/ubuntu/worldcup-work/data/recommended-leagues/all_topscorers.json` / `/home/ubuntu/worldcup-work/data/recommended-leagues/all_topscorers.csv` |

## 四、接口状态与注意事项

| 接口 | ok 联赛数 | 空/受限/错误联赛数 | 总记录数 | 说明 |
|---|---:|---:|---:|---|
| teams | 23 | 0 | 859 | 核心数据可用 |
| standings | 22 | 1 | 884 | 核心数据可用 |
| events | 22 | 1 | 6154 | 核心数据可用 |
| topscorers | 23 | 0 | 1487 | 核心数据可用 |
| odds | 0 | 23 | 0 | 当前账号或接口参数未返回赔率数据，已保存原始错误/空响应留痕 |

## 五、空响应或受限响应清单

| 推荐项 | league_id | 接口 | 状态 |
|---|---:|---|---|
| FIFA World Cup | 28 | odds | api_error_or_empty |
| UEFA World Cup Qualifiers | 24 | odds | api_error_or_empty |
| CONMEBOL World Cup Qualifiers | 27 | odds | api_error_or_empty |
| AFC World Cup Qualifiers | 22 | odds | api_error_or_empty |
| CAF World Cup Qualifiers | 21 | odds | api_error_or_empty |
| Concacaf World Cup Qualifiers | 23 | odds | api_error_or_empty |
| OFC World Cup Qualifiers | 26 | standings | api_error_or_empty |
| OFC World Cup Qualifiers | 26 | odds | api_error_or_empty |
| UEFA Champions League | 3 | odds | api_error_or_empty |
| UEFA Europa League | 4 | odds | api_error_or_empty |
| UEFA Conference League | 683 | odds | api_error_or_empty |
| Premier League | 152 | odds | api_error_or_empty |
| La Liga | 302 | odds | api_error_or_empty |
| Serie A | 207 | odds | api_error_or_empty |
| Bundesliga | 175 | odds | api_error_or_empty |
| Ligue 1 | 168 | odds | api_error_or_empty |
| MLS | 332 | odds | api_error_or_empty |
| Liga MX | 235 | odds | api_error_or_empty |
| Brazil Serie A | 99 | odds | api_error_or_empty |
| Argentina Primera División | 44 | odds | api_error_or_empty |
| AFC Champions League Elite | 727 | events | api_error_or_empty |
| AFC Champions League Elite | 727 | odds | api_error_or_empty |
| J1 League | 209 | odds | api_error_or_empty |
| K League 1 | 219 | odds | api_error_or_empty |
| Chinese Super League | 118 | odds | api_error_or_empty |

## 六、保存位置

- 原始响应目录：`/home/ubuntu/worldcup-work/data/recommended-leagues/raw`。
- 联赛发现与推荐索引：`/home/ubuntu/worldcup-work/data/recommended-leagues/recommended_leagues_index.json`。
- 抓取摘要：`/home/ubuntu/worldcup-work/data/recommended-leagues/recommended_leagues_fetch_summary.json` 与 `/home/ubuntu/worldcup-work/data/recommended-leagues/recommended_leagues_fetch_summary.csv`。
- 汇总表：`all_teams`、`all_standings`、`all_events`、`all_topscorers` 的 JSON/CSV。

## 七、结论

本次已完成 23 个推荐联赛/赛事的核心数据抓取。除 odds 赔率接口当前未返回可用数据、OFC 世界杯资格赛积分榜未返回可用数据、AFC Champions League 赛程接口当前为空外，球队、积分榜、赛程/赛果和射手榜等建模核心数据已按联赛保存，并已生成汇总索引供后端导入或后续同步任务使用。
