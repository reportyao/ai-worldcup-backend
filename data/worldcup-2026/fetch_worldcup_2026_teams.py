#!/usr/bin/env python3
"""Fetch and validate latest FIFA World Cup participant teams.

Priority:
1. apifootball.com API v3 (`https://apiv3.apifootball.com/`) when APIFOOTBALL_API_KEY is available.
2. API-Sports API-Football v3 (`https://v3.football.api-sports.io`) when API_FOOTBALL_KEY or API_SPORTS_KEY is available.
3. Public cross-check source: Wikipedia 2026 FIFA World Cup qualification table.

The script writes raw responses, normalized JSON/CSV datasets, and a Markdown validation report.
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

OUTPUT_DIR = Path('/home/ubuntu/worldcup-work/data/worldcup-2026')
RAW_DIR = OUTPUT_DIR / 'raw'
NORMALIZED_JSON = OUTPUT_DIR / 'worldcup_2026_teams.json'
NORMALIZED_CSV = OUTPUT_DIR / 'worldcup_2026_teams.csv'
REPORT_MD = OUTPUT_DIR / 'worldcup_2026_teams_validation_report.md'
APIFOOTBALL_BASE_URL = 'https://apiv3.apifootball.com/'
API_SPORTS_BASE_URL = 'https://v3.football.api-sports.io'
WIKI_QUALIFICATION_URL = 'https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_qualification'
EXPECTED_TEAM_COUNT = 48

CONFEDERATION_BY_TEAM = {
    # AFC
    'Japan': 'AFC', 'Iran': 'AFC', 'Uzbekistan': 'AFC', 'Jordan': 'AFC', 'South Korea': 'AFC',
    'Australia': 'AFC', 'Qatar': 'AFC', 'Saudi Arabia': 'AFC', 'Iraq': 'AFC',
    # CAF
    'Morocco': 'CAF', 'Tunisia': 'CAF', 'Egypt': 'CAF', 'Algeria': 'CAF', 'Ghana': 'CAF',
    'Cape Verde': 'CAF', 'Senegal': 'CAF', 'South Africa': 'CAF', 'Ivory Coast': 'CAF', 'DR Congo': 'CAF',
    # CONCACAF
    'Canada': 'CONCACAF', 'Mexico': 'CONCACAF', 'United States': 'CONCACAF', 'Panama': 'CONCACAF',
    'Curaçao': 'CONCACAF', 'Haiti': 'CONCACAF',
    # CONMEBOL
    'Argentina': 'CONMEBOL', 'Brazil': 'CONMEBOL', 'Ecuador': 'CONMEBOL', 'Paraguay': 'CONMEBOL',
    'Uruguay': 'CONMEBOL', 'Colombia': 'CONMEBOL',
    # OFC
    'New Zealand': 'OFC',
    # UEFA
    'England': 'UEFA', 'France': 'UEFA', 'Croatia': 'UEFA', 'Portugal': 'UEFA', 'Norway': 'UEFA',
    'Germany': 'UEFA', 'Netherlands': 'UEFA', 'Switzerland': 'UEFA', 'Scotland': 'UEFA', 'Spain': 'UEFA',
    'Austria': 'UEFA', 'Belgium': 'UEFA', 'Bosnia and Herzegovina': 'UEFA', 'Sweden': 'UEFA',
    'Turkey': 'UEFA', 'Czech Republic': 'UEFA',
}

FIFA_CODES = {
    'Canada': 'CAN', 'Mexico': 'MEX', 'United States': 'USA', 'Japan': 'JPN', 'New Zealand': 'NZL',
    'Iran': 'IRN', 'Argentina': 'ARG', 'Uzbekistan': 'UZB', 'Jordan': 'JOR', 'South Korea': 'KOR',
    'Australia': 'AUS', 'Brazil': 'BRA', 'Ecuador': 'ECU', 'Paraguay': 'PAR', 'Uruguay': 'URU',
    'Colombia': 'COL', 'Morocco': 'MAR', 'Tunisia': 'TUN', 'Egypt': 'EGY', 'Algeria': 'ALG',
    'Ghana': 'GHA', 'Cape Verde': 'CPV', 'Qatar': 'QAT', 'Saudi Arabia': 'KSA', 'Senegal': 'SEN',
    'South Africa': 'RSA', 'Ivory Coast': 'CIV', 'England': 'ENG', 'France': 'FRA', 'Croatia': 'CRO',
    'Portugal': 'POR', 'Norway': 'NOR', 'Germany': 'GER', 'Netherlands': 'NED', 'Switzerland': 'SUI',
    'Scotland': 'SCO', 'Spain': 'ESP', 'Austria': 'AUT', 'Belgium': 'BEL', 'Panama': 'PAN',
    'Curaçao': 'CUW', 'Haiti': 'HAI', 'Bosnia and Herzegovina': 'BIH', 'Sweden': 'SWE',
    'Turkey': 'TUR', 'Czech Republic': 'CZE', 'DR Congo': 'COD', 'Iraq': 'IRQ',
}

ALIASES = {
    'Korea Republic': 'South Korea',
    'Korea Republic ': 'South Korea',
    'IR Iran': 'Iran',
    'Cabo Verde': 'Cape Verde',
    'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
    'USA': 'United States',
    'United States of America': 'United States',
    'Côte d\'Ivoire': 'Ivory Coast',
    'Cote d\'Ivoire': 'Ivory Coast',
    'Czechia': 'Czech Republic',
    'Türkiye': 'Turkey',
    'Turkiye': 'Turkey',
    'Congo DR': 'DR Congo',
    'Congo DR ': 'DR Congo',
    'DR Congo ': 'DR Congo',
    'Curacao': 'Curaçao',
}

@dataclass
class TeamRecord:
    name: str
    fifa_code: str | None
    confederation: str | None
    qualification_method: str | None
    qualification_date: str | None
    total_times_qualified: str | None
    last_time_qualified: str | None
    current_consecutive_appearances: str | None
    previous_best_performance: str | None
    is_host: bool
    is_debutant: bool
    source: str
    api_football_team_id: str | None = None
    logo_url: str | None = None
    raw_names_seen: list[str] | None = None


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = re.sub(r'\[[^\]]*\]', '', str(value))
    value = value.replace('\xa0', ' ')
    value = re.sub(r'\s+', ' ', value).strip()
    value = value.replace('— N/a', 'N/A').replace('—', 'N/A')
    return value or None


def normalize_name(name: str) -> str:
    cleaned = clean_text(name) or ''
    return ALIASES.get(cleaned, cleaned)


def request_json(url: str, *, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None, raw_path: Path | None = None) -> tuple[dict[str, Any] | list[Any] | None, str | None]:
    try:
        response = requests.get(url, params=params, headers=headers, timeout=45)
        text = response.text
        if raw_path:
            raw_path.write_text(text, encoding='utf-8')
        try:
            data = response.json()
        except ValueError:
            return None, f'HTTP {response.status_code}: non-JSON response saved to {raw_path}'
        if response.status_code >= 400:
            return data, f'HTTP {response.status_code}: {data}'
        return data, None
    except Exception as exc:  # noqa: BLE001
        return None, f'{type(exc).__name__}: {exc}'


def fetch_apifootball() -> dict[str, Any]:
    key = os.getenv('APIFOOTBALL_API_KEY') or os.getenv('APIFOOTBALL_KEY') or os.getenv('API_FOOTBALL_APIFOOTBALL_KEY')
    result: dict[str, Any] = {'provider': 'apifootball.com', 'available': bool(key), 'status': 'skipped_no_key'}
    if not key:
        unauth_path = RAW_DIR / 'apifootball_get_teams_league_1_no_key.json'
        data, error = request_json(APIFOOTBALL_BASE_URL, params={'action': 'get_teams', 'league_id': '1'}, raw_path=unauth_path)
        result.update({'status': 'blocked_no_key', 'error': error or data, 'raw_file': str(unauth_path)})
        return result

    leagues_path = RAW_DIR / 'apifootball_get_leagues.json'
    leagues, error = request_json(APIFOOTBALL_BASE_URL, params={'action': 'get_leagues', 'APIkey': key}, raw_path=leagues_path)
    result['leagues_raw_file'] = str(leagues_path)
    if error:
        result.update({'status': 'error_get_leagues', 'error': error})
        return result

    candidates: list[dict[str, Any]] = []
    if isinstance(leagues, list):
        for item in leagues:
            league_name = str(item.get('league_name', '')).lower()
            country_name = str(item.get('country_name', '')).lower()
            if 'world cup' in league_name or ('world' in country_name and 'cup' in league_name):
                candidates.append(item)
    result['world_cup_league_candidates'] = candidates
    if not candidates:
        result.update({'status': 'no_world_cup_league_found'})
        return result

    exact_world_cup_candidates = [
        item for item in candidates
        if str(item.get('league_name', '')).strip().lower() == 'world cup'
        and str(item.get('league_season', '')).strip() == '2026'
    ]
    selected = exact_world_cup_candidates[0] if exact_world_cup_candidates else candidates[0]
    league_id = selected.get('league_id')
    teams_path = RAW_DIR / f'apifootball_get_teams_league_{league_id}.json'
    teams, error = request_json(APIFOOTBALL_BASE_URL, params={'action': 'get_teams', 'league_id': league_id, 'APIkey': key}, raw_path=teams_path)
    result.update({'selected_league': selected, 'teams_raw_file': str(teams_path)})
    if error:
        result.update({'status': 'error_get_teams', 'error': error})
        return result
    result.update({'status': 'ok', 'teams_count': len(teams) if isinstance(teams, list) else None, 'teams': teams})
    return result


def fetch_api_sports() -> dict[str, Any]:
    key = os.getenv('API_FOOTBALL_KEY') or os.getenv('API_SPORTS_KEY') or os.getenv('APISPORTS_KEY')
    result: dict[str, Any] = {'provider': 'api-football.com/api-sports', 'available': bool(key), 'league': 1, 'season': 2026, 'status': 'skipped_no_key'}
    headers = {'x-apisports-key': key} if key else {}
    if not key:
        path = RAW_DIR / 'api_sports_teams_league_1_season_2026_no_key.json'
        data, error = request_json(f'{API_SPORTS_BASE_URL}/teams', params={'league': '1', 'season': '2026'}, headers=headers, raw_path=path)
        result.update({'status': 'blocked_no_key', 'error': error or data, 'raw_file': str(path)})
        return result
    path = RAW_DIR / 'api_sports_teams_league_1_season_2026.json'
    data, error = request_json(f'{API_SPORTS_BASE_URL}/teams', params={'league': '1', 'season': '2026'}, headers=headers, raw_path=path)
    result['raw_file'] = str(path)
    if error:
        result.update({'status': 'error', 'error': error})
        return result
    response = data.get('response', []) if isinstance(data, dict) else []
    result.update({'status': 'ok', 'teams_count': len(response), 'teams': response})
    return result


def fetch_wikipedia_qualified_teams() -> list[TeamRecord]:
    response = requests.get(WIKI_QUALIFICATION_URL, timeout=45, headers={'User-Agent': 'worldcup-data-validation/1.0'})
    response.raise_for_status()
    raw_path = RAW_DIR / 'wikipedia_2026_fifa_world_cup_qualification.html'
    raw_path.write_text(response.text, encoding='utf-8')
    soup = BeautifulSoup(response.text, 'html.parser')

    target_table = None
    for table in soup.select('table.wikitable'):
        headers = [clean_text(th.get_text(' ', strip=True)) for th in table.select('tr th')]
        if headers and 'Team' in headers and any('Method' in (h or '') for h in headers) and any('Date' in (h or '') for h in headers):
            target_table = table
            break
    if target_table is None:
        raise RuntimeError('Cannot locate qualified teams wikitable.')

    rows: list[TeamRecord] = []
    for tr in target_table.select('tbody tr'):
        cells = tr.find_all(['td', 'th'])
        if len(cells) < 7:
            continue
        team_name = normalize_name(cells[0].get_text(' ', strip=True))
        if not team_name or team_name == 'Team':
            continue
        method = clean_text(cells[1].get_text(' ', strip=True))
        date = clean_text(cells[2].get_text(' ', strip=True))
        total = clean_text(cells[3].get_text(' ', strip=True))
        last_time = clean_text(cells[4].get_text(' ', strip=True))
        consecutive = clean_text(cells[5].get_text(' ', strip=True))
        best = clean_text(cells[6].get_text(' ', strip=True))
        rows.append(TeamRecord(
            name=team_name,
            fifa_code=FIFA_CODES.get(team_name),
            confederation=CONFEDERATION_BY_TEAM.get(team_name),
            qualification_method=method,
            qualification_date=date,
            total_times_qualified=total,
            last_time_qualified=last_time,
            current_consecutive_appearances=consecutive,
            previous_best_performance=best,
            is_host=(method == 'Hosts'),
            is_debutant=(last_time == 'N/A'),
            source=WIKI_QUALIFICATION_URL,
            raw_names_seen=[cells[0].get_text(' ', strip=True)],
        ))
    return rows


def merge_with_api_records(records: list[TeamRecord], api_sports: dict[str, Any], apifootball: dict[str, Any]) -> None:
    by_name = {record.name: record for record in records}

    if api_sports.get('status') == 'ok':
        for item in api_sports.get('teams', []):
            team = item.get('team', {}) if isinstance(item, dict) else {}
            name = normalize_name(str(team.get('name', '')))
            if name in by_name:
                by_name[name].api_football_team_id = str(team.get('id')) if team.get('id') is not None else by_name[name].api_football_team_id
                by_name[name].logo_url = team.get('logo') or by_name[name].logo_url
                raw_names = by_name[name].raw_names_seen or []
                if team.get('name') and team.get('name') not in raw_names:
                    raw_names.append(team.get('name'))
                by_name[name].raw_names_seen = raw_names

    if apifootball.get('status') == 'ok':
        for item in apifootball.get('teams', []):
            if not isinstance(item, dict):
                continue
            name = normalize_name(str(item.get('team_name', '') or item.get('name', '')))
            if name in by_name:
                if not by_name[name].api_football_team_id and item.get('team_key'):
                    by_name[name].api_football_team_id = str(item.get('team_key'))
                if item.get('team_badge'):
                    by_name[name].logo_url = item.get('team_badge')
                raw_names = by_name[name].raw_names_seen or []
                raw_name = item.get('team_name') or item.get('name')
                if raw_name and raw_name not in raw_names:
                    raw_names.append(raw_name)
                by_name[name].raw_names_seen = raw_names


def validate(records: list[TeamRecord], api_sports: dict[str, Any], apifootball: dict[str, Any]) -> dict[str, Any]:
    names = [record.name for record in records]
    duplicate_names = sorted({name for name in names if names.count(name) > 1})
    missing_confederation = [record.name for record in records if not record.confederation]
    missing_fifa_code = [record.name for record in records if not record.fifa_code]
    counts_by_confed: dict[str, int] = {}
    for record in records:
        counts_by_confed[record.confederation or 'UNKNOWN'] = counts_by_confed.get(record.confederation or 'UNKNOWN', 0) + 1

    expected_confed_counts = {'AFC': 9, 'CAF': 10, 'CONCACAF': 6, 'CONMEBOL': 6, 'OFC': 1, 'UEFA': 16}
    confed_mismatches = {key: {'expected': expected, 'actual': counts_by_confed.get(key, 0)} for key, expected in expected_confed_counts.items() if counts_by_confed.get(key, 0) != expected}

    required_hosts = {'Canada', 'Mexico', 'United States'}
    host_names = {record.name for record in records if record.is_host}
    required_debutants = {'Cape Verde', 'Curaçao', 'Jordan', 'Uzbekistan'}
    debutants = {record.name for record in records if record.is_debutant}

    api_sports_names = set()
    if api_sports.get('status') == 'ok':
        api_sports_names = {normalize_name(str(item.get('team', {}).get('name', ''))) for item in api_sports.get('teams', []) if isinstance(item, dict)}
    apifootball_names = set()
    if apifootball.get('status') == 'ok':
        apifootball_names = {normalize_name(str(item.get('team_name', '') or item.get('name', ''))) for item in apifootball.get('teams', []) if isinstance(item, dict)}

    return {
        'generated_at': now_iso(),
        'expected_team_count': EXPECTED_TEAM_COUNT,
        'actual_team_count': len(records),
        'team_count_ok': len(records) == EXPECTED_TEAM_COUNT,
        'duplicate_names': duplicate_names,
        'missing_confederation': missing_confederation,
        'missing_fifa_code': missing_fifa_code,
        'counts_by_confederation': counts_by_confed,
        'confederation_count_mismatches': confed_mismatches,
        'hosts_ok': required_hosts == host_names,
        'host_names': sorted(host_names),
        'debutants_ok': required_debutants.issubset(debutants),
        'debutant_names': sorted(debutants),
        'apifootball_status': {k: v for k, v in apifootball.items() if k not in {'teams'}},
        'api_sports_status': {k: v for k, v in api_sports.items() if k not in {'teams'}},
        'api_sports_name_diff': sorted(set(names) ^ api_sports_names) if api_sports_names else None,
        'apifootball_name_diff': sorted(set(names) ^ apifootball_names) if apifootball_names else None,
    }


def write_outputs(records: list[TeamRecord], validation: dict[str, Any]) -> None:
    payload = {
        'competition': {
            'name': 'FIFA World Cup 2026',
            'season': 2026,
            'api_sports_league_id': 1,
            'expected_team_count': EXPECTED_TEAM_COUNT,
            'host_countries': ['Canada', 'Mexico', 'United States'],
            'start_date': '2026-06-11',
            'end_date': '2026-07-19',
        },
        'metadata': {
            'generated_at': validation['generated_at'],
            'primary_public_source': WIKI_QUALIFICATION_URL,
            'api_provider_requested_by_user': 'https://apifootball.com/',
            'api_provider_endpoint': APIFOOTBALL_BASE_URL,
            'validation': validation,
        },
        'teams': [asdict(record) for record in sorted(records, key=lambda x: (x.confederation or '', x.name))],
    }
    NORMALIZED_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')

    fieldnames = list(asdict(records[0]).keys())
    with NORMALIZED_CSV.open('w', encoding='utf-8', newline='') as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for record in sorted(records, key=lambda x: (x.confederation or '', x.name)):
            row = asdict(record)
            row['raw_names_seen'] = '; '.join(row['raw_names_seen'] or [])
            writer.writerow(row)

    report = []
    report.append('# 2026 FIFA World Cup 参赛队伍数据校验报告\n')
    report.append(f'生成时间：`{validation["generated_at"]}`。\n')
    report.append('## 数据源状态\n')
    report.append(f'- 用户指定 API：`https://apifootball.com/`，接口基础地址 `{APIFOOTBALL_BASE_URL}`。')
    report.append(f'- 官方/公开交叉校验来源：`{WIKI_QUALIFICATION_URL}`。')
    report.append(f'- API-Sports 2026 世界杯参数：`league=1`，`season=2026`。\n')
    report.append('## 校验结论\n')
    report.append(f'- 参赛队伍数量：{validation["actual_team_count"]}/{validation["expected_team_count"]}，结果：{"通过" if validation["team_count_ok"] else "未通过"}。')
    report.append(f'- 重复队名：{validation["duplicate_names"] or "无"}。')
    report.append(f'- 主办国校验：{validation["host_names"]}，结果：{"通过" if validation["hosts_ok"] else "未通过"}。')
    report.append(f'- 首次参赛队校验：{validation["debutant_names"]}，包含预期首次参赛队，结果：{"通过" if validation["debutants_ok"] else "未通过"}。')
    report.append(f'- 各洲席位统计：`{json.dumps(validation["counts_by_confederation"], ensure_ascii=False)}`。')
    report.append(f'- 各洲席位差异：{validation["confederation_count_mismatches"] or "无"}。')
    report.append(f'- FIFA 三字码缺失：{validation["missing_fifa_code"] or "无"}。')
    report.append(f'- 洲际归属缺失：{validation["missing_confederation"] or "无"}。\n')
    report.append('## API 抓取状态\n')
    report.append('```json')
    report.append(json.dumps({'apifootball': validation['apifootball_status'], 'api_sports': validation['api_sports_status']}, ensure_ascii=False, indent=2))
    report.append('```\n')
    report.append('## 文件输出\n')
    report.append(f'- JSON：`{NORMALIZED_JSON}`')
    report.append(f'- CSV：`{NORMALIZED_CSV}`')
    report.append(f'- 原始响应目录：`{RAW_DIR}`\n')
    report.append('> 说明：若 `apifootball.com` 返回 `Authentification failed!`，表示当前环境缺少该服务的 APIkey。脚本已经保留无密钥调用原始响应；提供密钥后可重新运行本脚本自动补齐官方接口原始数据与 ID 字段。\n')
    REPORT_MD.write_text('\n'.join(report), encoding='utf-8')


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    apifootball = fetch_apifootball()
    api_sports = fetch_api_sports()
    records = fetch_wikipedia_qualified_teams()
    merge_with_api_records(records, api_sports, apifootball)
    validation = validate(records, api_sports, apifootball)
    write_outputs(records, validation)

    summary_path = OUTPUT_DIR / 'run_summary.json'
    summary_path.write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding='utf-8')

    print(json.dumps({
        'json': str(NORMALIZED_JSON),
        'csv': str(NORMALIZED_CSV),
        'report': str(REPORT_MD),
        'summary': str(summary_path),
        'team_count_ok': validation['team_count_ok'],
        'actual_team_count': validation['actual_team_count'],
        'apifootball_status': validation['apifootball_status']['status'],
        'api_sports_status': validation['api_sports_status']['status'],
    }, ensure_ascii=False, indent=2))
    return 0 if validation['team_count_ok'] and not validation['duplicate_names'] and not validation['confederation_count_mismatches'] else 2


if __name__ == '__main__':
    sys.exit(main())
