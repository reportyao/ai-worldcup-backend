from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup

BASE_URL = 'https://apiv3.apifootball.com/'
OUT_DIR = Path('/home/ubuntu/worldcup-work/data/recommended-leagues')
RAW_DIR = OUT_DIR / 'raw'
RAW_DIR.mkdir(parents=True, exist_ok=True)

TARGETS = [
    {'tier': 'international', 'priority': 1, 'label': 'FIFA World Cup', 'patterns': [r'^World Cup$'], 'season_prefer': ['2026']},
    {'tier': 'international', 'priority': 2, 'label': 'UEFA World Cup Qualifiers', 'patterns': [r'UEFA World Cup Qualifiers'], 'season_prefer': ['2026']},
    {'tier': 'international', 'priority': 3, 'label': 'CONMEBOL World Cup Qualifiers', 'patterns': [r'CONMEBOL World Cup Qualifiers'], 'season_prefer': ['2026']},
    {'tier': 'international', 'priority': 4, 'label': 'AFC World Cup Qualifiers', 'patterns': [r'AFC World Cup Qualifiers'], 'season_prefer': ['2026']},
    {'tier': 'international', 'priority': 5, 'label': 'CAF World Cup Qualifiers', 'patterns': [r'CAF World Cup Qualifiers'], 'season_prefer': ['2026']},
    {'tier': 'international', 'priority': 6, 'label': 'Concacaf World Cup Qualifiers', 'patterns': [r'Concacaf World Cup Qualifiers'], 'season_prefer': ['2026']},
    {'tier': 'international', 'priority': 7, 'label': 'OFC World Cup Qualifiers', 'patterns': [r'OFC World Cup Qualifiers'], 'season_prefer': ['2026']},
    {'tier': 'europe_club', 'priority': 10, 'label': 'UEFA Champions League', 'patterns': [r'UEFA Champions League'], 'season_prefer': ['2025', '2024']},
    {'tier': 'europe_club', 'priority': 11, 'label': 'UEFA Europa League', 'patterns': [r'UEFA Europa League'], 'season_prefer': ['2025', '2024']},
    {'tier': 'europe_club', 'priority': 12, 'label': 'UEFA Conference League', 'patterns': [r'UEFA Conference League', r'Europa Conference League'], 'season_prefer': ['2025', '2024']},
    {'tier': 'top5', 'priority': 20, 'label': 'Premier League', 'country_patterns': [r'England'], 'patterns': [r'^Premier League$'], 'season_prefer': ['2025', '2024']},
    {'tier': 'top5', 'priority': 21, 'label': 'La Liga', 'country_patterns': [r'Spain'], 'patterns': [r'^La Liga$'], 'season_prefer': ['2025', '2024']},
    {'tier': 'top5', 'priority': 22, 'label': 'Serie A', 'country_patterns': [r'Italy'], 'patterns': [r'^Serie A$'], 'season_prefer': ['2025', '2024']},
    {'tier': 'top5', 'priority': 23, 'label': 'Bundesliga', 'country_patterns': [r'Germany'], 'patterns': [r'^Bundesliga$'], 'season_prefer': ['2025', '2024']},
    {'tier': 'top5', 'priority': 24, 'label': 'Ligue 1', 'country_patterns': [r'France'], 'patterns': [r'^Ligue 1$'], 'season_prefer': ['2025', '2024']},
    {'tier': 'americas', 'priority': 30, 'label': 'Copa Libertadores', 'patterns': [r'Copa Libertadores'], 'season_prefer': ['2026', '2025']},
    {'tier': 'americas', 'priority': 31, 'label': 'Copa Sudamericana', 'patterns': [r'Copa Sudamericana'], 'season_prefer': ['2026', '2025']},
    {'tier': 'americas', 'priority': 32, 'label': 'MLS', 'country_patterns': [r'USA', r'United States'], 'patterns': [r'^MLS$'], 'season_prefer': ['2026', '2025']},
    {'tier': 'americas', 'priority': 33, 'label': 'Liga MX', 'country_patterns': [r'Mexico'], 'patterns': [r'Liga MX', r'^Primera Division$'], 'season_prefer': ['2026', '2025']},
    {'tier': 'americas', 'priority': 34, 'label': 'Brazil Serie A', 'country_patterns': [r'Brazil'], 'patterns': [r'^Serie A$'], 'season_prefer': ['2026', '2025']},
    {'tier': 'americas', 'priority': 35, 'label': 'Argentina Primera División', 'country_patterns': [r'Argentina'], 'patterns': [r'Primera Division', r'Liga Profesional'], 'season_prefer': ['2026', '2025']},
    {'tier': 'asia', 'priority': 40, 'label': 'AFC Champions League Elite', 'patterns': [r'AFC Champions League', r'AFC Champions League Elite'], 'season_prefer': ['2025', '2024']},
    {'tier': 'asia', 'priority': 41, 'label': 'Saudi Pro League', 'country_patterns': [r'Saudi Arabia'], 'patterns': [r'Pro League', r'Professional League'], 'season_prefer': ['2025', '2024']},
    {'tier': 'asia', 'priority': 42, 'label': 'J1 League', 'country_patterns': [r'Japan'], 'patterns': [r'J1 League'], 'season_prefer': ['2026', '2025']},
    {'tier': 'asia', 'priority': 43, 'label': 'K League 1', 'country_patterns': [r'South Korea', r'Korea'], 'patterns': [r'K League 1'], 'season_prefer': ['2026', '2025']},
    {'tier': 'asia', 'priority': 44, 'label': 'Chinese Super League', 'country_patterns': [r'China'], 'patterns': [r'Super League'], 'season_prefer': ['2026', '2025']},
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


def fetch_leagues(api_key: str) -> list[dict[str, Any]]:
    resp = requests.get(BASE_URL, params={'action': 'get_leagues', 'APIkey': api_key}, timeout=60)
    RAW_DIR.joinpath('apifootball_get_leagues.json').write_text(resp.text, encoding='utf-8')
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, list):
        raise SystemExit(f'Unexpected get_leagues response: {data!r}')
    return data


def match_target(leagues: list[dict[str, Any]], target: dict[str, Any]) -> dict[str, Any] | None:
    candidates = []
    for item in leagues:
        lname = str(item.get('league_name', ''))
        cname = str(item.get('country_name', ''))
        season = str(item.get('league_season', ''))
        if not any(re.search(pattern, lname, re.I) for pattern in target['patterns']):
            continue
        country_patterns = target.get('country_patterns') or []
        if country_patterns and not any(re.search(pattern, cname, re.I) for pattern in country_patterns):
            continue
        season_rank = 999
        for idx, preferred in enumerate(target.get('season_prefer') or []):
            if season == preferred:
                season_rank = idx
                break
        candidates.append((season_rank, -int(season) if season.isdigit() else 0, item))
    if not candidates:
        return None
    candidates.sort(key=lambda x: (x[0], x[1], str(x[2].get('league_name', ''))))
    selected = candidates[0][2]
    return {
        'label': target['label'],
        'tier': target['tier'],
        'priority': target['priority'],
        'league_id': str(selected.get('league_id')),
        'league_name': selected.get('league_name'),
        'league_season': str(selected.get('league_season', '')),
        'country_id': str(selected.get('country_id', '')),
        'country_name': selected.get('country_name'),
        'league_logo': selected.get('league_logo'),
        'country_logo': selected.get('country_logo'),
        'matched_candidates_count': len(candidates),
        'recommendation_reason': reason_for(target['tier'], target['label']),
    }


def reason_for(tier: str, label: str) -> str:
    reasons = {
        'international': '与世界杯预测强相关，可补充国家队近期正式比赛、资格赛强弱关系与跨洲对比特征。',
        'europe_club': '欧战覆盖强队跨联赛交手，适合训练高强度比赛、淘汰赛和球队状态特征。',
        'top5': '欧洲五大联赛数据稳定、球队和球员质量高，是俱乐部预测模型的核心样本。',
        'americas': '覆盖美洲主要联赛与洲际杯赛，可提升对南美、北美球队和世界杯参赛国球员状态的理解。',
        'asia': '覆盖亚洲高热度联赛与亚冠，有助于世界杯亚洲队、转会球员和区域强队状态建模。',
    }
    return reasons.get(tier, f'{label} 具备较高关注度和数据价值。')


def main() -> None:
    api_key = load_key()
    leagues = fetch_leagues(api_key)
    selected = []
    missing = []
    seen_ids = set()
    for target in TARGETS:
        match = match_target(leagues, target)
        if match and match['league_id'] not in seen_ids:
            selected.append(match)
            seen_ids.add(match['league_id'])
        else:
            missing.append({'label': target['label'], 'tier': target['tier'], 'patterns': target['patterns']})
    selected.sort(key=lambda x: x['priority'])
    OUT_DIR.joinpath('recommended_leagues_index.json').write_text(json.dumps(selected, ensure_ascii=False, indent=2), encoding='utf-8')
    OUT_DIR.joinpath('recommended_leagues_missing.json').write_text(json.dumps(missing, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'selected_count': len(selected), 'missing_count': len(missing), 'selected': selected, 'missing': missing}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
