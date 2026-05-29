#!/usr/bin/env bash
set -Eeuo pipefail
DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/deploy}"
LOG_DIR="${LOG_DIR:-/home/ubuntu/logs}"
SECRET_FILE="$DEPLOY_DIR/github-webhook.secret"
mkdir -p "$DEPLOY_DIR" "$LOG_DIR"
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi
if [ ! -f "$SECRET_FILE" ]; then
  umask 077
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > "$SECRET_FILE"
fi
cp /home/ubuntu/apps/ai-worldcup-backend/deploy/production/ai-worldcup-deploy.sh "$DEPLOY_DIR/ai-worldcup-deploy.sh"
cp /home/ubuntu/apps/ai-worldcup-backend/deploy/production/webhook-server.js "$DEPLOY_DIR/webhook-server.js"
cp /home/ubuntu/apps/ai-worldcup-backend/deploy/production/webhook.pm2.config.cjs "$DEPLOY_DIR/webhook.pm2.config.cjs"
chmod +x "$DEPLOY_DIR/ai-worldcup-deploy.sh" "$DEPLOY_DIR/webhook-server.js"
export GITHUB_WEBHOOK_SECRET="$(cat "$SECRET_FILE")"
pm2 startOrReload "$DEPLOY_DIR/webhook.pm2.config.cjs" --update-env
pm2 save
echo "Webhook URL: http://82.157.76.140/github-webhook"
echo "Webhook secret file: $SECRET_FILE"
