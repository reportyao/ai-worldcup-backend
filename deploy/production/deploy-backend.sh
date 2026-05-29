#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/apps/ai-worldcup-backend}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/deploy}"
LOG_DIR="${LOG_DIR:-/home/ubuntu/logs}"
API_PORT="${API_PORT:-3000}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
run() { log "+ $*"; "$@"; }

cd "$APP_DIR"
mkdir -p "$DEPLOY_DIR" "$LOG_DIR"

if [ ! -f .env ]; then
  cat > .env <<ENVEOF
NODE_ENV=production
API_PORT=$API_PORT
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_worldcup?schema=public
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=change-this-jwt-secret-before-public-launch
WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_PAY_MCH_ID=
WECHAT_PAY_API_V3_KEY=
WECHAT_PAY_PRIVATE_KEY_PATH=
WECHAT_PAY_CERT_SERIAL_NO=
OPENAI_API_KEY=
AI_PROVIDER_BASE_URL=
AI_PROVIDER_MODEL=
ENVEOF
  chmod 600 .env
  log "Created default .env; please fill real production secrets if needed."
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

run env CI=true npm_config_build_from_source=true pnpm install --no-frozen-lockfile
run pnpm prisma:generate
run pnpm prisma:migrate:deploy
run pnpm run build

cp deploy/production/ecosystem.config.cjs "$DEPLOY_DIR/ecosystem.config.cjs"
run pm2 startOrReload "$DEPLOY_DIR/ecosystem.config.cjs" --update-env
run pm2 save

sleep 3
curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null
log "Backend deployed and health check passed."
