# 2026 FIFA World Cup 参赛队伍数据校验报告

生成时间：`2026-05-31T11:59:53+00:00`。

## 数据源状态

- 用户指定 API：`https://apifootball.com/`，接口基础地址 `https://apiv3.apifootball.com/`。
- 官方/公开交叉校验来源：`https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_qualification`。
- API-Sports 2026 世界杯参数：`league=1`，`season=2026`。

## 校验结论

- 参赛队伍数量：48/48，结果：通过。
- 重复队名：无。
- 主办国校验：['Canada', 'Mexico', 'United States']，结果：通过。
- 首次参赛队校验：['Cape Verde', 'Curaçao', 'Jordan', 'Uzbekistan']，包含预期首次参赛队，结果：通过。
- 各洲席位统计：`{"CONCACAF": 6, "AFC": 9, "OFC": 1, "CONMEBOL": 6, "CAF": 10, "UEFA": 16}`。
- 各洲席位差异：无。
- FIFA 三字码缺失：无。
- 洲际归属缺失：无。

## API 抓取状态

```json
{
  "apifootball": {
    "provider": "apifootball.com",
    "available": true,
    "status": "ok",
    "leagues_raw_file": "/home/ubuntu/worldcup-work/data/worldcup-2026/raw/apifootball_get_leagues.json",
    "world_cup_league_candidates": [
      {
        "country_id": "214",
        "country_name": "South America",
        "league_id": "27",
        "league_name": "CONMEBOL World Cup Qualifiers",
        "league_season": "2026",
        "league_logo": "https://apiv3.apifootball.com/badges/logo_leagues/27_wc-qualification-south-america.png",
        "country_logo": ""
      },
      {
        "country_id": "160",
        "country_name": "Europe",
        "league_id": "24",
        "league_name": "UEFA World Cup Qualifiers",
        "league_season": "2026",
        "league_logo": "https://apiv3.apifootball.com/badges/logo_leagues/24_wc-qualification-europe.png",
        "country_logo": "https://apiv3.apifootball.com/badges/logo_country/160_europe.png"
      },
      {
        "country_id": "8",
        "country_name": "Worldcup",
        "league_id": "28",
        "league_name": "World Cup",
        "league_season": "2026",
        "league_logo": "https://apiv3.apifootball.com/badges/logo_leagues/28_world-cup.png",
        "country_logo": ""
      },
      {
        "country_id": "8",
        "country_name": "Worldcup",
        "league_id": "19",
        "league_name": "FIFA Intercontinental Cup",
        "league_season": "2025",
        "league_logo": "https://apiv3.apifootball.com/badges/logo_leagues/19_fifa-club-world-cup.png",
        "country_logo": ""
      },
      {
        "country_id": "8",
        "country_name": "Worldcup",
        "league_id": "22",
        "league_name": "AFC World Cup Qualifiers",
        "league_season": "2026",
        "league_logo": "https://apiv3.apifootball.com/badges/logo_leagues/22_wc-qualification-asia.png",
        "country_logo": ""
      },
      {
        "country_id": "8",
        "country_name": "Worldcup",
        "league_id": "21",
        "league_name": "CAF World Cup Qualifiers",
        "league_season": "2026",
        "league_logo": "https://apiv3.apifootball.com/badges/logo_leagues/21_wc-qualification-africa.png",
        "country_logo": ""
      },
      {
        "country_id": "2",
        "country_name": "intl",
        "league_id": "7555",
        "league_name": "Concacaf Women's World Cup Qualifiers",
        "league_season": "2026",
        "league_logo": "",
        "country_logo": "https://apiv3.apifootball.com/badges/logo_country/2_intl.png"
      },
      {
        "country_id": "8",
        "country_name": "Worldcup",
        "league_id": "23",
        "league_name": "Concacaf World Cup Qualifiers",
        "league_season": "2026",
        "league_logo": "https://apiv3.apifootball.com/badges/logo_leagues/23_wc-qualification-concacaf.png",
        "country_logo": ""
      },
      {
        "country_id": "133",
        "country_name": "World",
        "league_id": "8141",
        "league_name": "FIFA Club World Cup",
        "league_season": "2025",
        "league_logo": "",
        "country_logo": "https://apiv3.apifootball.com/badges/logo_country/133_world.png"
      },
      {
        "country_id": "2",
        "country_name": "intl",
        "league_id": "8158",
        "league_name": "FIFA Club World Cup Play-In",
        "league_season": "2025",
        "league_logo": "",
        "country_logo": "https://apiv3.apifootball.com/badges/logo_country/2_intl.png"
      },
      {
        "country_id": "2",
        "country_name": "intl",
        "league_id": "7997",
        "league_name": "FIFA U17 Women's World Cup",
        "league_season": "2025",
        "league_logo": "",
        "country_logo": "https://apiv3.apifootball.com/badges/logo_country/2_intl.png"
      },
      {
        "country_id": "8",
        "country_name": "Worldcup",
        "league_id": "415",
        "league_name": "FIFA U17 World Cup",
        "league_season": "2026",
        "league_logo": "https://apiv3.apifootball.com/badges/logo_leagues/415_u17-world-cup.png",
        "country_logo": ""
      },
      {
        "country_id": "2",
        "country_name": "intl",
        "league_id": "7548",
        "league_name": "FIFA U20 Women's World Cup",
        "league_season": "2024",
        "league_logo": "",
        "country_logo": "https://apiv3.apifootball.com/badges/logo_country/2_intl.png"
      },
      {
        "country_id": "8",
        "country_name": "Worldcup",
        "league_id": "425",
        "league_name": "FIFA U20 World Cup",
        "league_season": "2025",
        "league_logo": "",
        "country_logo": ""
      },
      {
        "country_id": "166",
        "country_name": "World cup",
        "league_id": "20",
        "league_name": "FIFA Women's World Cup",
        "league_season": "2023",
        "league_logo": "https://apiv3.apifootball.com/badges/logo_leagues/20_women's-world-cup.png",
        "country_logo": "https://apiv3.apifootball.com/badges/logo_country/166_world-cup.png"
      },
      {
        "country_id": "8",
        "country_name": "Worldcup",
        "league_id": "26",
        "league_name": "OFC World Cup Qualifiers",
        "league_season": "2026",
        "league_logo": "https://apiv3.apifootball.com/badges/logo_leagues/26_wc-qualification-oceania.png",
        "country_logo": ""
      },
      {
        "country_id": "8",
        "country_name": "Worldcup",
        "league_id": "717",
        "league_name": "Women's Asian Cup Qualification",
        "league_season": "2026",
        "league_logo": "",
        "country_logo": ""
      }
    ],
    "selected_league": {
      "country_id": "8",
      "country_name": "Worldcup",
      "league_id": "28",
      "league_name": "World Cup",
      "league_season": "2026",
      "league_logo": "https://apiv3.apifootball.com/badges/logo_leagues/28_world-cup.png",
      "country_logo": ""
    },
    "teams_raw_file": "/home/ubuntu/worldcup-work/data/worldcup-2026/raw/apifootball_get_teams_league_28.json",
    "teams_count": 48
  },
  "api_sports": {
    "provider": "api-football.com/api-sports",
    "available": false,
    "league": 1,
    "season": 2026,
    "status": "blocked_no_key",
    "error": "HTTP 403: {'get': '', 'parameters': [], 'errors': {'token': 'Missing application key, Check our documentation on how to add your API key in headers.', 'error': '4xHe'}, 'results': 0, 'paging': {'current': 1, 'total': 1}, 'response': []}",
    "raw_file": "/home/ubuntu/worldcup-work/data/worldcup-2026/raw/api_sports_teams_league_1_season_2026_no_key.json"
  }
}
```

## 文件输出

- JSON：`/home/ubuntu/worldcup-work/data/worldcup-2026/worldcup_2026_teams.json`
- CSV：`/home/ubuntu/worldcup-work/data/worldcup-2026/worldcup_2026_teams.csv`
- 原始响应目录：`/home/ubuntu/worldcup-work/data/worldcup-2026/raw`

> 说明：若 `apifootball.com` 返回 `Authentification failed!`，表示当前环境缺少该服务的 APIkey。脚本已经保留无密钥调用原始响应；提供密钥后可重新运行本脚本自动补齐官方接口原始数据与 ID 字段。
