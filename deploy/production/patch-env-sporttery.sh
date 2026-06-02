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

has_env_value() {
  local key="$1"
  grep -q "^${key}=.\+" "$ENV_FILE" 2>/dev/null
}

# 竞彩赛程定时同步（每天0点、6点、12点）
if ! has_env_value SPORTTERY_DAILY_SYNC_CRON; then
  set_env_value SPORTTERY_DAILY_SYNC_CRON "0 0,6,12 * * *"
fi

# 竞彩赛果定时检查（每10分钟）
if ! has_env_value SPORTTERY_RESULT_CHECK_CRON; then
  set_env_value SPORTTERY_RESULT_CHECK_CRON "*/10 * * * *"
fi

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
