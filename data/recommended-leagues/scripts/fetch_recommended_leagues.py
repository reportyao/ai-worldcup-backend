from __future__ import annotations

import csv
import json
import os
import re
import time
from datetime import date
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

BASE_URL = 'https://apiv3.apifootball.com/'
ROOT = Path('/home/ubuntu/worldcup-work')
OUT_DIR = ROOT / 'data' / 'recommended-leagues'
RAW_DIR = OUT_DIR / 'raw'
INDEX_PATH = OUT_DIR / 'recommended_leagues_index.json'
SESSION = requests.Session()
SESSION.headers.update({'User-Agent': 'worldcup-data-sync/1.0'})

CORE_ACTIONS = [
    {'name': 'teams', 'action': 'get_teams', 'params': lambda league, dr: {'league_id': league['league_id']}},
    {'name': 'standings', 'action': 'get_standings', 'params': lambda league, dr: {'league_id': league['league_id']}},
    {'name': 'events', 'action': 'get_events', 'params': lambda league, dr: {'league_id': league['league_id'], 'from': dr[0], 'to': dr[1]}},
    {'name': 'topscorers', 'action': 'get_topscorers', 'params': lambda league, dr: {'league_id': league['league_id']}},
]

OPTIONAL_ACTIONS = [
    # 部分账号/赛事可能不支持；脚本会保存原始错误响应并在报告中标注。
    {'name': 'odds', 'action': 'get_odds', 'params': lambda league, dr: {'league_id': league['league_id'], 'from': dr[0], 'to': dr[1]}},
]


def load_key() -> str:
    for name in ('APIFOOTBALL_API_KEY', 'APIFOOTBALL_KEY'):
        value = os.environ.get(name)
        if value:
            return value.strip()
    for html_path in sorted(Path('/home/ubuntu/browser_html').glob('apifootball_com_admin_*.html'), key=lambda p: p.stat().st_mtime, reverse=True):
        soup = BeautifulSoup(html_path.read_text(encoding='utf-8', errors='ignore'), 'html.parser')
        for inp in soup.select('input'):
            val = (inp.get('value') or '').strip()
            if len(val) >= 32 and re.fullmatch(r'[0-9a-fA-F]+', val):
                return val
    raise SystemExit('APIFOOTBALL_API_KEY not found')


def safe_slug(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-') or 'league'


def season_range(season: str, label: str = '', league_name: str = '') -> tuple[str, str]:
    season = str(season or '').strip()
    combined_name = f'{label} {league_name}'.lower()
    if 'world cup qualifiers' in combined_name and '2026' in season:
        return '2023-01-01', '2026-12-31'
    if '/' in season:
        parts = re.findall(r'\d{4}', season)
        if len(parts) >= 2:
            return f'{parts[0]}-07-01', f'{parts[1]}-06-30'
    m = re.search(r'\d{4}', season)
    if m:
        y = int(m.group(0))
        return f'{y}-01-01', f'{y}-12-31'
    y = date.today().year
    return f'{y}-01-01', f'{y}-12-31'


def api_get(api_key: str, action: str, params: dict[str, Any]) -> tuple[int, Any, str]:
    full_params = {'action': action, 'APIkey': api_key, **params}
    resp = SESSION.get(BASE_URL, params=full_params, timeout=90)
    text = resp.text
    try:
        data = resp.json()
    except Exception:
        data = {'non_json_response': text[:5000]}
    return resp.status_code, data, resp.url.replace(api_key, '***')


def as_count(data: Any) -> int:
    if isinstance(data, list):
        return len(data)
    if isinstance(data, dict):
        for key in ('result', 'data', 'response'):
            if isinstance(data.get(key), list):
                return len(data[key])
        if 'error' in data or 'message' in data:
            return 0
        return 1 if data else 0
    return 0


def response_status(data: Any, http_status: int) -> str:
    if http_status >= 400:
        return 'http_error'
    if isinstance(data, dict):
        joined = json.dumps(data, ensure_ascii=False).lower()
        if 'error' in data or 'missing' in joined or 'invalid' in joined or 'not found' in joined or 'access' in joined:
            return 'api_error_or_empty'
    if as_count(data) == 0:
        return 'empty'
    return 'ok'


def collect_team_ids(teams: Any) -> list[str]:
    rows: list[Any]
    if isinstance(teams, list):
        rows = teams
    elif isinstance(teams, dict):
        rows = teams.get('result') or teams.get('data') or teams.get('response') or []
    else:
        rows = []
    ids = []
    for row in rows:
        if isinstance(row, dict):
            tid = row.get('team_key') or row.get('team_id') or row.get('id')
            if tid is not None:
                ids.append(str(tid))
    return sorted(set(ids), key=lambda x: int(x) if x.isdigit() else x)


def main() -> None:
    api_key = load_key()
    leagues = json.loads(INDEX_PATH.read_text(encoding='utf-8'))
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    summary: list[dict[str, Any]] = []

    for idx, league in enumerate(leagues, start=1):
        slug = f"{league['priority']:02d}-{safe_slug(league['label'])}-{league['league_id']}"
        league_dir = RAW_DIR / slug
        league_dir.mkdir(parents=True, exist_ok=True)
        dr = season_range(str(league.get('league_season', '')), str(league.get('label', '')), str(league.get('league_name', '')))
        league_summary: dict[str, Any] = {
            **league,
            'slug': slug,
            'date_from': dr[0],
            'date_to': dr[1],
            'actions': {},
        }
        print(f"[{idx}/{len(leagues)}] {league['label']} ({league['league_name']} {league.get('league_season')}, id={league['league_id']})")
        for spec in CORE_ACTIONS + OPTIONAL_ACTIONS:
            params = spec['params'](league, dr)
            status_code, data, sanitized_url = api_get(api_key, spec['action'], params)
            out = {
                'league': league,
                'action': spec['action'],
                'name': spec['name'],
                'request_url_sanitized': sanitized_url,
                'http_status': status_code,
                'fetched_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                'data': data,
            }
            (league_dir / f"{spec['name']}.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
            status = response_status(data, status_code)
            count = as_count(data)
            league_summary['actions'][spec['name']] = {
                'action': spec['action'],
                'status': status,
                'http_status': status_code,
                'record_count': count,
                'file': str((league_dir / f"{spec['name']}.json").relative_to(OUT_DIR)),
            }
            print(f"  - {spec['name']}: {status}, records={count}")
            time.sleep(0.35)

        teams_payload = json.loads((league_dir / 'teams.json').read_text(encoding='utf-8')).get('data')
        team_ids = collect_team_ids(teams_payload)
        league_summary['team_ids_count'] = len(team_ids)
        league_summary['team_ids_sample'] = team_ids[:8]
        summary.append(league_summary)

    OUT_DIR.joinpath('recommended_leagues_fetch_summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

    csv_path = OUT_DIR / 'recommended_leagues_fetch_summary.csv'
    with csv_path.open('w', encoding='utf-8', newline='') as f:
        fieldnames = ['priority','tier','label','league_id','league_name','league_season','country_name','date_from','date_to','teams','standings','events','topscorers','odds']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for item in summary:
            row = {k: item.get(k, '') for k in fieldnames[:9]}
            for action in ('teams','standings','events','topscorers','odds'):
                meta = item['actions'].get(action, {})
                row[action] = f"{meta.get('record_count', 0)} ({meta.get('status', 'missing')})"
            writer.writerow(row)
    print(json.dumps({'league_count': len(summary), 'summary': str(OUT_DIR / 'recommended_leagues_fetch_summary.json'), 'csv': str(csv_path)}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
