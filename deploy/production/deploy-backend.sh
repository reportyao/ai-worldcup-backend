#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/apps/ai-worldcup-backend}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/deploy}"
LOG_DIR="${LOG_DIR:-/home/ubuntu/logs}"
API_PORT="${API_PORT:-3000}"
PUBLIC_HOST="${PUBLIC_HOST:-82.157.76.140}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
run() { log "+ $*"; "$@"; }
random_hex() { openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | awk '{print $1}'; }

cd "$APP_DIR"
mkdir -p "$DEPLOY_DIR" "$LOG_DIR"

if [ ! -f .env ]; then
  JWT_SECRET_DEFAULT="$(random_hex)"
  ADMIN_SESSION_SECRET_DEFAULT="$(random_hex)"
  ADMIN_PASSWORD_DEFAULT="ChangeMe_${JWT_SECRET_DEFAULT:0:12}!"

  cat > .env <<ENVEOF
NODE_ENV=production
API_PORT=$API_PORT
PUBLIC_BASE_URL=http://$PUBLIC_HOST
H5_BASE_URL=http://$PUBLIC_HOST
CORS_ALLOWED_ORIGINS=http://$PUBLIC_HOST,http://$PUBLIC_HOST:8080,http://$PUBLIC_HOST:8081,http://h5.qiuduoduo.online,http://admin.qiuduoduo.online,http://api.qiuduoduo.online
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_worldcup?schema=public
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_worldcup?schema=public
REDIS_URL=redis://127.0.0.1:6379/0
JWT_SECRET=$JWT_SECRET_DEFAULT
JWT_ACCESS_TTL=2h
JWT_REFRESH_TTL=30d
ADMIN_EMAIL=admin@ai-worldcup.local
ADMIN_NAME=AI WorldCup Admin
ADMIN_PASSWORD=$ADMIN_PASSWORD_DEFAULT
ADMIN_SESSION_SECRET=$ADMIN_SESSION_SECRET_DEFAULT
ADMIN_SESSION_TTL_SECONDS=86400
AI_ALLOW_MOCK=false
AI_GATEWAY_BASE_URL=
AI_GATEWAY_TIMEOUT_MS=30000
AI_OPENAI_API_KEY=
AI_OPENAI_BASE_URL=
AI_GOOGLE_API_KEY=
AI_GOOGLE_BASE_URL=
AI_ANTHROPIC_API_KEY=
AI_ANTHROPIC_BASE_URL=
API_FOOTBALL_KEY=
API_FOOTBALL_BASE_URL=https://apiv3.apifootball.com/
API_FOOTBALL_LEAGUE_IDS=
DATA_REFRESH_CRON_FIXTURES=0 */6 * * *
DATA_REFRESH_CRON_LIVE=*/2 * * * *
PREDICTION_SCHEDULER_WINDOW_MINUTES=10
WECHAT_MP_APPID=
WECHAT_MP_SECRET=
WECHAT_MP_TOKEN=
WECHAT_MP_AES_KEY=
WECHAT_PAY_MCHID=
WECHAT_PAY_API_V3_KEY=
WECHAT_PAY_SERIAL_NO=
WECHAT_PAY_PRIVATE_KEY_PATH=
WECHAT_PAY_NOTIFY_URL=
ENVEOF
  chmod 600 .env
  log "Created default .env. Please rotate ADMIN_PASSWORD and fill real production secrets after first deployment."
fi

if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then
  # Keep infrastructure startup idempotent. On existing servers, PostgreSQL/Redis
  # may already be bound to 5432/6379 by running containers or system services;
  # that state is acceptable for app deployment, so do not abort solely because
  # docker compose cannot bind an already-used host port.
  if docker compose version >/dev/null 2>&1; then
    if ! run docker compose up -d postgres redis; then
      log "docker compose startup returned non-zero; continuing if database and Redis ports are already reachable."
    fi
  elif command -v docker-compose >/dev/null 2>&1; then
    if ! run docker-compose up -d postgres redis; then
      log "docker-compose startup returned non-zero; continuing if database and Redis ports are already reachable."
    fi
  fi
fi

if ! (timeout 2 bash -c '</dev/tcp/127.0.0.1/5432') >/dev/null 2>&1; then
  log "PostgreSQL is not reachable on 127.0.0.1:5432 after infrastructure startup."
  exit 1
fi
if ! (timeout 2 bash -c '</dev/tcp/127.0.0.1/6379') >/dev/null 2>&1; then
  log "Redis is not reachable on 127.0.0.1:6379 after infrastructure startup."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  run sudo npm install -g pnpm
fi
if ! command -v pm2 >/dev/null 2>&1; then
  run sudo npm install -g pm2
fi

run env CI=true npm_config_build_from_source=true pnpm install --frozen-lockfile
run pnpm prisma:generate
run pnpm prisma:migrate:deploy
run pnpm run build

cp deploy/production/ecosystem.config.cjs "$DEPLOY_DIR/ecosystem.config.cjs"
run pm2 startOrReload "$DEPLOY_DIR/ecosystem.config.cjs" --update-env
run pm2 save

sleep 3
health_body="$(curl -fsS "http://127.0.0.1:$API_PORT/health")"
if ! printf '%s' "$health_body" | grep -q '"status":"ok"'; then
  log "Backend health check did not return ok: $health_body"
  exit 1
fi
log "Backend deployed and health check passed."
