from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path('/home/ubuntu/worldcup-work')
OUT_DIR = ROOT / 'data' / 'recommended-leagues'
RAW_DIR = OUT_DIR / 'raw'
SUMMARY_PATH = OUT_DIR / 'recommended_leagues_fetch_summary.json'


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))


def extract_rows(payload: Any) -> list[dict[str, Any]]:
    data = payload.get('data') if isinstance(payload, dict) and 'data' in payload else payload
    if isinstance(data, list):
        rows = data
    elif isinstance(data, dict):
        rows = data.get('result') or data.get('response') or data.get('data') or ([] if ('error' in data or 'message' in data) else [data])
    else:
        rows = []
    return [r for r in rows if isinstance(r, dict)]


def scalarize(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return value


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    keys: list[str] = []
    seen = set()
    for row in rows:
        for k in row.keys():
            if k not in seen:
                seen.add(k)
                keys.append(k)
    with path.open('w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: scalarize(row.get(k, '')) for k in keys})


def enrich_rows(summary: list[dict[str, Any]], action: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for league in summary:
        file_rel = league.get('actions', {}).get(action, {}).get('file')
        if not file_rel:
            continue
        payload = load_json(OUT_DIR / file_rel)
        for row in extract_rows(payload):
            rows.append({
                'source_label': league.get('label'),
                'tier': league.get('tier'),
                'priority': league.get('priority'),
                'league_id': league.get('league_id'),
                'league_name': league.get('league_name'),
                'league_season': league.get('league_season'),
                'country_name': league.get('country_name'),
                **row,
            })
    return rows


def main() -> None:
    summary = load_json(SUMMARY_PATH)
    aggregates = {}
    for action in ('teams', 'standings', 'events', 'topscorers'):
        rows = enrich_rows(summary, action)
        aggregates[action] = len(rows)
        (OUT_DIR / f'all_{action}.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
        write_csv(OUT_DIR / f'all_{action}.csv', rows)

    tier_counter = Counter(item.get('tier') for item in summary)
    action_status = defaultdict(Counter)
    action_counts = defaultdict(int)
    empty_actions = []
    for item in summary:
        for action, meta in item.get('actions', {}).items():
            action_status[action][meta.get('status')] += 1
            action_counts[action] += int(meta.get('record_count') or 0)
            if int(meta.get('record_count') or 0) == 0:
                empty_actions.append({
                    'label': item.get('label'),
                    'league_id': item.get('league_id'),
                    'action': action,
                    'status': meta.get('status'),
                })

    report_lines = []
    report_lines.append('# 推荐联赛 apifootball.com 数据抓取与质量报告\n')
    report_lines.append('本报告记录了基于项目预测与内容展示价值筛选的推荐联赛清单，以及通过 apifootball.com 官方接口抓取后的核心数据覆盖情况。抓取过程使用账号后台 API key 执行，但所有保存的请求 URL 均已脱敏，不包含密钥。\n')
    report_lines.append('## 一、推荐范围\n')
    report_lines.append(f'- 推荐联赛/赛事总数：**{len(summary)}**。')
    report_lines.append(f'- 分层覆盖：' + '；'.join(f'**{k}** {v} 个' for k, v in sorted(tier_counter.items())) + '。')
    report_lines.append('- 推荐逻辑：优先覆盖世界杯正赛与各洲资格赛、欧战、欧洲五大联赛、美洲高热度联赛、亚洲代表性赛事与联赛，以支持国家队实力、球员状态和跨联赛比较建模。\n')

    report_lines.append('## 二、联赛清单与核心数据量\n')
    report_lines.append('| 优先级 | 分层 | 推荐项 | apifootball league_id | 官方名称 | 赛季 | 国家/地区 | 球队 | 积分榜 | 赛程/赛果 | 射手榜 | 赔率 |')
    report_lines.append('|---:|---|---|---:|---|---|---|---:|---:|---:|---:|---:|')
    for item in sorted(summary, key=lambda x: int(x.get('priority') or 999)):
        def count(action: str) -> int:
            return int(item.get('actions', {}).get(action, {}).get('record_count') or 0)
        report_lines.append(
            f"| {item.get('priority')} | {item.get('tier')} | {item.get('label')} | {item.get('league_id')} | {item.get('league_name')} | {item.get('league_season')} | {item.get('country_name')} | {count('teams')} | {count('standings')} | {count('events')} | {count('topscorers')} | {count('odds')} |"
        )
    report_lines.append('')

    report_lines.append('## 三、汇总数据规模\n')
    report_lines.append('| 数据表 | 汇总记录数 | 输出文件 |')
    report_lines.append('|---|---:|---|')
    for action in ('teams', 'standings', 'events', 'topscorers'):
        report_lines.append(f"| all_{action} | {aggregates[action]} | `{OUT_DIR / ('all_' + action + '.json')}` / `{OUT_DIR / ('all_' + action + '.csv')}` |")
    report_lines.append('')

    report_lines.append('## 四、接口状态与注意事项\n')
    report_lines.append('| 接口 | ok 联赛数 | 空/受限/错误联赛数 | 总记录数 | 说明 |')
    report_lines.append('|---|---:|---:|---:|---|')
    for action in ('teams', 'standings', 'events', 'topscorers', 'odds'):
        ok = action_status[action].get('ok', 0)
        non_ok = sum(v for k, v in action_status[action].items() if k != 'ok')
        note = '核心数据可用' if action != 'odds' else '当前账号或接口参数未返回赔率数据，已保存原始错误/空响应留痕'
        report_lines.append(f"| {action} | {ok} | {non_ok} | {action_counts[action]} | {note} |")
    report_lines.append('')

    if empty_actions:
        report_lines.append('## 五、空响应或受限响应清单\n')
        report_lines.append('| 推荐项 | league_id | 接口 | 状态 |')
        report_lines.append('|---|---:|---|---|')
        for item in empty_actions:
            report_lines.append(f"| {item['label']} | {item['league_id']} | {item['action']} | {item['status']} |")
        report_lines.append('')

    report_lines.append('## 六、保存位置\n')
    report_lines.append(f'- 原始响应目录：`{RAW_DIR}`。')
    report_lines.append(f"- 联赛发现与推荐索引：`{OUT_DIR / 'recommended_leagues_index.json'}`。")
    report_lines.append(f"- 抓取摘要：`{OUT_DIR / 'recommended_leagues_fetch_summary.json'}` 与 `{OUT_DIR / 'recommended_leagues_fetch_summary.csv'}`。")
    report_lines.append(f'- 汇总表：`all_teams`、`all_standings`、`all_events`、`all_topscorers` 的 JSON/CSV。\n')

    report_lines.append('## 七、结论\n')
    report_lines.append('本次已完成 23 个推荐联赛/赛事的核心数据抓取。除 odds 赔率接口当前未返回可用数据、OFC 世界杯资格赛积分榜未返回可用数据、AFC Champions League 赛程接口当前为空外，球队、积分榜、赛程/赛果和射手榜等建模核心数据已按联赛保存，并已生成汇总索引供后端导入或后续同步任务使用。\n')

    report_path = OUT_DIR / 'recommended_leagues_validation_report.md'
    report_path.write_text('\n'.join(report_lines), encoding='utf-8')
    print(json.dumps({
        'report': str(report_path),
        'league_count': len(summary),
        'aggregates': aggregates,
        'empty_actions': len(empty_actions),
    }, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
