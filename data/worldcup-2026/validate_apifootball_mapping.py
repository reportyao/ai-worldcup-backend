import json
import re
import unicodedata
from pathlib import Path

base = Path('/home/ubuntu/worldcup-work/data/worldcup-2026')
raw_obj = json.loads((base / 'raw/apifootball_get_teams_league_28.json').read_text(encoding='utf-8'))
std_obj = json.loads((base / 'worldcup_2026_teams.json').read_text(encoding='utf-8'))

raw = raw_obj if isinstance(raw_obj, list) else raw_obj.get('teams', [])
if isinstance(std_obj, list):
    std = std_obj
elif isinstance(std_obj, dict):
    std = std_obj.get('teams') or std_obj.get('data') or []
else:
    std = []

def norm(value: str) -> str:
    s = unicodedata.normalize('NFKD', value or '').encode('ascii', 'ignore').decode().lower()
    replacements = {
        'united states': 'usa',
        'turkiye': 'turkey',
        'ir iran': 'iran',
        'korea republic': 'south korea',
        'cabo verde': 'cape verde',
        'czechia': 'czech republic',
        'congo dr': 'dr congo',
        'bosnia-herzegovina': 'bosnia and herzegovina',
        'cote divoire': 'ivory coast',
        'curaçao': 'curacao',
    }
    for src, dst in replacements.items():
        s = s.replace(src, dst)
    return re.sub(r'[^a-z0-9]+', '', s)

raw_names = [item.get('team_name', '') for item in raw if isinstance(item, dict)]
std_names = [item.get('name') or item.get('team_name') or '' for item in std if isinstance(item, dict)]
raw_norm = {norm(name): name for name in raw_names}
std_norm = {norm(name): name for name in std_names}
missing_in_std = [raw_norm[key] for key in raw_norm if key not in std_norm]
missing_in_api = [std_norm[key] for key in std_norm if key not in raw_norm]
with_api_id = sum(1 for item in std if isinstance(item, dict) and (item.get('api_football_team_id') or item.get('apifootball_team_key') or item.get('apiFootballTeamKey') or item.get('team_key')))
summary = {
    'apifootball_raw_count': len(raw_names),
    'standardized_count': len(std_names),
    'standardized_with_apifootball_team_key': with_api_id,
    'missing_raw_teams_in_standardized': missing_in_std,
    'standardized_teams_not_matched_to_raw': missing_in_api,
    'first_standardized_item': std[0] if std else None,
}
print(json.dumps(summary, ensure_ascii=False, indent=2))
(base / 'apifootball_mapping_validation.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
