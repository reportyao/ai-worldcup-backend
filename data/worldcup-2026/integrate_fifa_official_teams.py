#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

BASE = Path('/home/ubuntu/worldcup-work/data/worldcup-2026')
RAW = BASE / 'raw'
CONSOLE = Path('/home/ubuntu/console_outputs/exec_result_2026-05-31_11-46-48_912.txt')
JSON_PATH = BASE / 'worldcup_2026_teams.json'
CSV_PATH = BASE / 'worldcup_2026_teams.csv'
REPORT_PATH = BASE / 'worldcup_2026_teams_validation_report.md'
FIFA_RAW_PATH = RAW / 'fifa_official_teams_page_cards.json'

ALIASES = {
    'USA': 'United States',
    'IR Iran': 'Iran',
    'Korea Republic': 'South Korea',
    'Cabo Verde': 'Cape Verde',
    'Congo DR': 'DR Congo',
    "Côte d'Ivoire": 'Ivory Coast',
    'Czechia': 'Czech Republic',
    'Türkiye': 'Turkey',
}


def normalize(name: str) -> str:
    return ALIASES.get(name.strip(), name.strip())


def parse_card(text: str, href: str) -> dict:
    host = text.startswith('Host country ')
    working = text.replace('Host country ', '', 1) if host else text
    m = re.match(r'^(?P<name>.+?) Stage Group (?P<group>[A-L]) World Ranking (?P<ranking>\d+) Participations (?P<participations>\d+)$', working)
    if not m:
        raise ValueError(f'Cannot parse FIFA card: {text}')
    data = m.groupdict()
    return {
        'official_name': data['name'],
        'normalized_name': normalize(data['name']),
        'stage_group': data['group'],
        'world_ranking': int(data['ranking']),
        'fifa_participations': int(data['participations']),
        'is_host_on_fifa_page': host,
        'fifa_team_url': href,
    }


def main() -> None:
    raw_text = CONSOLE.read_text(encoding='utf-8').strip()
    # Console result is a JSON string containing a JSON array.
    cards = json.loads(json.loads(raw_text))
    parsed = [parse_card(item['text'], item['href']) for item in cards]
    FIFA_RAW_PATH.write_text(json.dumps({
        'source_url': 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/teams',
        'extraction_method': 'browser DOM query: a[href*="/teams/"]',
        'count': len(parsed),
        'teams': parsed,
    }, ensure_ascii=False, indent=2), encoding='utf-8')

    payload = json.loads(JSON_PATH.read_text(encoding='utf-8'))
    by_name = {item['normalized_name']: item for item in parsed}
    missing_in_fifa = []
    missing_in_dataset = []
    for team in payload['teams']:
        match = by_name.get(team['name'])
        if not match:
            missing_in_fifa.append(team['name'])
            continue
        team.update({
            'fifa_official_name': match['official_name'],
            'fifa_stage_group': match['stage_group'],
            'fifa_world_ranking': match['world_ranking'],
            'fifa_participations': match['fifa_participations'],
            'fifa_team_url': match['fifa_team_url'],
        })
    dataset_names = {team['name'] for team in payload['teams']}
    for item in parsed:
        if item['normalized_name'] not in dataset_names:
            missing_in_dataset.append(item['official_name'])

    validation = payload['metadata']['validation']
    validation['fifa_official_page_status'] = {
        'source_url': 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/teams',
        'raw_file': str(FIFA_RAW_PATH),
        'team_count': len(parsed),
        'team_count_ok': len(parsed) == 48,
        'missing_in_fifa_page_after_alias_normalization': missing_in_fifa,
        'missing_in_dataset_after_alias_normalization': missing_in_dataset,
        'name_diff_ok': not missing_in_fifa and not missing_in_dataset,
    }
    JSON_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')

    all_fields = []
    for row in payload['teams']:
        for key in row.keys():
            if key not in all_fields:
                all_fields.append(key)
    with CSV_PATH.open('w', encoding='utf-8', newline='') as fh:
        writer = csv.DictWriter(fh, fieldnames=all_fields)
        writer.writeheader()
        for row in payload['teams']:
            out = dict(row)
            if isinstance(out.get('raw_names_seen'), list):
                out['raw_names_seen'] = '; '.join(out['raw_names_seen'])
            writer.writerow(out)

    report = REPORT_PATH.read_text(encoding='utf-8')
    insertion = (
        '\n## FIFA 官方页面交叉校验\n\n'
        f'- FIFA 官方球队页提取数量：{len(parsed)}/48，结果：{"通过" if len(parsed) == 48 else "未通过"}。\n'
        f'- 与标准化数据集队名差异：{"无" if not missing_in_fifa and not missing_in_dataset else {"missing_in_fifa": missing_in_fifa, "missing_in_dataset": missing_in_dataset}}。\n'
        f'- 已合并字段：`fifa_official_name`、`fifa_stage_group`、`fifa_world_ranking`、`fifa_participations`、`fifa_team_url`。\n'
        f'- 原始提取文件：`{FIFA_RAW_PATH}`。\n'
    )
    if '## FIFA 官方页面交叉校验' not in report:
        report = report.replace('\n## API 抓取状态\n', insertion + '\n## API 抓取状态\n')
    REPORT_PATH.write_text(report, encoding='utf-8')

    print(json.dumps(validation['fifa_official_page_status'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
