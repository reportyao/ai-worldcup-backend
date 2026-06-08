#!/usr/bin/env bash
# ============================================================
# 竞彩自动同步环境变量补全脚本
# 在服务器上执行：bash /home/ubuntu/apps/ai-worldcup-backend/deploy/production/patch-env-sporttery.sh
# ============================================================

set -euo pipefail

APP_DIR="/home/ubuntu/apps/ai-worldcup-backend"
ENV_FILE="$APP_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env not found at $ENV_FILE"
  exit 1
fi

echo "Patching $ENV_FILE with sporttery auto-sync variables..."

set_env_value() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    echo "  Updated: ${key}=${value}"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
    echo "  Added: ${key}=${value}"
  fi
}

get_env_value() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- | xargs
}

ensure_sporttery_cron_value() {
  local key="$1"
  # 北京时间 03:00, 05:00, 10:00, 10:10, 10:20, 10:30, 11:00, 15:00, 24:00
  # 对应 UTC: 19, 21, 2, 2:10, 2:20, 2:30, 3, 7, 16
  local desired="0 19,21,2,3,7,16 * * *;10,20,30 2 * * *"
  local current
  current="$(get_env_value "$key")"

  if [ -z "$current" ]; then
    set_env_value "$key" "$desired"
    return
  fi

  # Migrate any legacy single-pattern cron to the new multi-pattern cadence
  if [ "$current" = "0 0,6,12 * * *" ] || [ "$current" = "*/10 * * * *" ] || [ "$current" = "0 19,21,2,7,16 * * *" ] || [ "$current" = "0 19,21,2,3,7,16 * * *;30 2,3 * * *" ]; then
    set_env_value "$key" "$desired"
  fi
}

has_env_value() {
  local key="$1"
  grep -q "^${key}=.\+" "$ENV_FILE" 2>/dev/null
}

# 竞彩赛程与赛果定时同步
# 北京时间 03:00、05:00、10:00、10:10、10:20、10:30、11:00、15:00、24:00
ensure_sporttery_cron_value SPORTTERY_DAILY_SYNC_CRON
ensure_sporttery_cron_value SPORTTERY_RESULT_CHECK_CRON

# 同步未来几天数据
if ! has_env_value SPORTTERY_SYNC_DAYS_AHEAD; then
  set_env_value SPORTTERY_SYNC_DAYS_AHEAD "3"
fi

# 新增比赛自动入队AI预测
if ! has_env_value SPORTTERY_AUTO_ENQUEUE_PREDICTIONS; then
  set_env_value SPORTTERY_AUTO_ENQUEUE_PREDICTIONS "true"
fi

echo ""
echo "Done! Restarting worker to apply new env..."
cd "$APP_DIR"
pm2 restart ai-worldcup-worker --update-env 2>/dev/null || echo "Note: pm2 restart failed, please restart manually"
echo "Patch complete."
