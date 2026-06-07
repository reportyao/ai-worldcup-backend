#!/usr/bin/env bash
set -Eeuo pipefail

BACKEND_REPO_URL="${BACKEND_REPO_URL:-git@github-backend:reportyao/ai-worldcup-backend.git}"
FRONTEND_REPO_URL="${FRONTEND_REPO_URL:-git@github-frontend:reportyao/ai-worldcup-frontend.git}"
ADMIN_REPO_URL="${ADMIN_REPO_URL:-https://github.com/reportyao/ai-worldcup-admin.git}"
BACKEND_DIR="${BACKEND_DIR:-/home/ubuntu/apps/ai-worldcup-backend}"
FRONTEND_DIR="${FRONTEND_DIR:-/home/ubuntu/apps/ai-worldcup-frontend}"
ADMIN_DIR="${ADMIN_DIR:-/home/ubuntu/apps/ai-worldcup-admin}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/deploy}"
WEB_ROOT="${WEB_ROOT:-/var/www/ai-worldcup}"
ADMIN_WEB_ROOT="${ADMIN_WEB_ROOT:-/var/www/ai-worldcup-admin}"
LOG_DIR="${LOG_DIR:-/home/ubuntu/logs}"
BRANCH="${DEPLOY_BRANCH:-main}"
API_PORT="${API_PORT:-3000}"
PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-https://qiuduoduo.online}"
VITE_API_BASE_URL="${VITE_API_BASE_URL:-/api}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
run() { log "+ $*"; "$@"; }
random_hex() {
  openssl rand -hex 32 2>/dev/null || date +%s%N | sha256sum | awk '{print $1}'
}

env_value() {
  local env_file="$1"
  local key="$2"
  if [ ! -f "$env_file" ]; then
    return 0
  fi
  awk -v key="$key" '
    index($0, key "=") == 1 { value = substr($0, length(key) + 2) }
    END { if (value != "") print value }
  ' "$env_file" 2>/dev/null || true
}

has_env_value() {
  local env_file="$1"
  local key="$2"
  grep -Eq "^${key}=." "$env_file" 2>/dev/null
}

set_env_value() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    $0 ~ "^" key "=" { print key "=" value; updated = 1; next }
    { print }
    END { if (updated == 0) print key "=" value }
  ' "$env_file" > "$tmp"
  cat "$tmp" > "$env_file"
  rm -f "$tmp"
  chmod 600 "$env_file"
}

ensure_production_env() {
  local env_file="$1"
  if [ ! -f "$env_file" ]; then
    return
  fi

  local database_url
  database_url="$(env_value "$env_file" DATABASE_URL)"
  if [ -n "$database_url" ] && ! has_env_value "$env_file" DIRECT_URL; then
    set_env_value "$env_file" DIRECT_URL "$database_url"
    log "Backfilled backend DIRECT_URL from DATABASE_URL in existing .env."
  fi

  local jwt_secret
  jwt_secret="$(env_value "$env_file" JWT_SECRET)"
  if [ -z "$jwt_secret" ] || [ "$jwt_secret" = "dev_jwt_secret_change_me_in_prod" ]; then
    set_env_value "$env_file" JWT_SECRET "$(random_hex)"
    log "Backfilled backend JWT_SECRET in existing .env."
  fi

  if ! has_env_value "$env_file" ADMIN_SESSION_SECRET; then
    set_env_value "$env_file" ADMIN_SESSION_SECRET "$(random_hex)"
    log "Backfilled backend ADMIN_SESSION_SECRET in existing .env."
  fi

  if ! has_env_value "$env_file" ADMIN_PASSWORD && ! has_env_value "$env_file" ADMIN_PASSWORD_SHA256; then
    set_env_value "$env_file" ADMIN_PASSWORD "ChangeMe_$(random_hex | cut -c1-12)!"
    log "Backfilled backend ADMIN_PASSWORD in existing .env; rotate it after deployment."
  fi

  local ai_allow_mock
  ai_allow_mock="$(env_value "$env_file" AI_ALLOW_MOCK | tr '[:upper:]' '[:lower:]' | xargs)"
  if [ -z "$ai_allow_mock" ] || ! printf '%s\n' false 0 no n off | grep -Fxq "$ai_allow_mock"; then
    set_env_value "$env_file" AI_ALLOW_MOCK false
    log "Set backend AI_ALLOW_MOCK=false in existing production .env."
  fi
}

ensure_command() {
  command -v "$1" >/dev/null 2>&1 || { log "ERROR: missing command: $1"; exit 1; }
}

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    log "ERROR: Docker Compose is required. Install docker compose plugin or docker-compose."
    exit 1
  fi
}

ensure_base_dirs() {
  mkdir -p /home/ubuntu/apps "$DEPLOY_DIR" "$LOG_DIR"
  sudo mkdir -p "$WEB_ROOT" "$ADMIN_WEB_ROOT"
  sudo chown -R ubuntu:ubuntu /home/ubuntu/apps "$DEPLOY_DIR" "$LOG_DIR"
}

ensure_runtime() {
  ensure_command git
  if command -v apt-get >/dev/null 2>&1; then
    run sudo apt-get update -y
    run sudo apt-get install -y build-essential python3 make g++ pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev rsync curl
  fi
  mkdir -p /home/ubuntu/.ssh
  ssh-keyscan -p 443 ssh.github.com >> /home/ubuntu/.ssh/known_hosts 2>/dev/null || true
  ssh-keyscan github.com >> /home/ubuntu/.ssh/known_hosts 2>/dev/null || true
  if ! grep -q 'Host github-backend' /home/ubuntu/.ssh/config 2>/dev/null; then
    cat >> /home/ubuntu/.ssh/config <<'SSHCONF'
Host github-backend
  HostName ssh.github.com
  Port 443
  User git
  IdentityFile ~/.ssh/ai_worldcup_backend_deploy
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new

Host github-frontend
  HostName ssh.github.com
  Port 443
  User git
  IdentityFile ~/.ssh/ai_worldcup_deploy
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
SSHCONF
    chmod 600 /home/ubuntu/.ssh/config
  fi
  ensure_command node
  ensure_command npm
  if ! command -v pnpm >/dev/null 2>&1; then
    run sudo npm install -g pnpm
  fi
  if ! command -v pm2 >/dev/null 2>&1; then
    run sudo npm install -g pm2
  fi
  if ! command -v docker >/dev/null 2>&1; then
    log "ERROR: docker is required. Please install Docker before deployment."
    exit 1
  fi
}

sync_repo() {
  local repo_url="$1"
  local target_dir="$2"
  local repo_name="$3"
  if [ ! -d "$target_dir/.git" ]; then
    rm -rf "$target_dir"
    log "Cloning $repo_name into $target_dir"
    git clone --branch "$BRANCH" "$repo_url" "$target_dir"
  else
    log "Updating $repo_name in $target_dir"
    git -C "$target_dir" remote set-url origin "$repo_url"
    git -C "$target_dir" fetch --prune origin "$BRANCH"
    git -C "$target_dir" checkout "$BRANCH"
    git -C "$target_dir" reset --hard "origin/$BRANCH"
  fi
}

prepare_backend_env() {
  local env_file="$BACKEND_DIR/.env"
  if [ ! -f "$env_file" ]; then
    local jwt_secret_default
    local admin_session_secret_default
    local admin_password_default
    jwt_secret_default="$(random_hex)"
    admin_session_secret_default="$(random_hex)"
    admin_password_default="ChangeMe_${jwt_secret_default:0:12}!"

    cat > "$env_file" <<ENVEOF
NODE_ENV=production
API_PORT=$API_PORT
PUBLIC_BASE_URL=$PUBLIC_SITE_URL
H5_BASE_URL=$PUBLIC_SITE_URL
CORS_ALLOWED_ORIGINS=$PUBLIC_SITE_URL,https://www.qiuduoduo.online,https://h5.qiuduoduo.online,https://admin.qiuduoduo.online,https://api.qiuduoduo.online,http://82.157.76.140:8080,http://82.157.76.140:8081,http://h5.qiuduoduo.online,http://admin.qiuduoduo.online,http://api.qiuduoduo.online
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_worldcup?schema=public
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:5432/ai_worldcup?schema=public
REDIS_URL=redis://127.0.0.1:6379/0
JWT_SECRET=$jwt_secret_default
JWT_ACCESS_TTL=2h
JWT_REFRESH_TTL=30d
ADMIN_EMAIL=admin@ai-worldcup.local
ADMIN_NAME=AI WorldCup Admin
ADMIN_PASSWORD=$admin_password_default
ADMIN_SESSION_SECRET=$admin_session_secret_default
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
    chmod 600 "$env_file"
    log "Created default backend .env. Please rotate ADMIN_PASSWORD and fill real WeChat/AI/payment secrets before public launch."
  fi
  ensure_production_env "$env_file"
}

start_infra() {
  cd "$BACKEND_DIR"
  if [ -f docker-compose.yml ]; then
    docker rm ai-worldcup-postgres ai-worldcup-redis >/dev/null 2>&1 || true
    log "+ docker_compose up -d postgres redis"
    if docker_compose up -d postgres redis; then
      return
    fi
    if sudo ss -ltn | grep -q '127.0.0.1:5432 ' && sudo ss -ltn | grep -q '127.0.0.1:6379 '; then
      log "WARN: PostgreSQL/Redis ports are already occupied; reusing existing local services and continuing."
      return
    fi
    log "ERROR: failed to start PostgreSQL/Redis and required local ports are not available."
    exit 1
  fi
}

build_backend() {
  cd "$BACKEND_DIR"
  run env CI=true npm_config_build_from_source=true pnpm install --frozen-lockfile
  run pnpm prisma generate
  run pnpm prisma migrate deploy
  run pnpm run build
}

build_frontend() {
  cd "$FRONTEND_DIR"
  cat > .env.production <<ENVEOF
VITE_API_BASE_URL=$VITE_API_BASE_URL
VITE_SITE_URL=$PUBLIC_SITE_URL
ENVEOF
  run pnpm install --frozen-lockfile
  run pnpm run build
  sudo mkdir -p "$WEB_ROOT"
  sudo rsync -a --delete dist/ "$WEB_ROOT"/
  sudo chown -R www-data:www-data "$WEB_ROOT"
}

build_admin() {
  cd "$ADMIN_DIR"
  cat > .env.production <<ENVEOF
VITE_API_BASE_URL=$VITE_API_BASE_URL
ENVEOF
  run pnpm install --frozen-lockfile
  run pnpm run build
  sudo mkdir -p "$ADMIN_WEB_ROOT"
  sudo rsync -a --delete dist/ "$ADMIN_WEB_ROOT"/
  sudo chown -R www-data:www-data "$ADMIN_WEB_ROOT"
}

configure_processes() {
  mkdir -p "$LOG_DIR"
  cp "$BACKEND_DIR/deploy/production/ecosystem.config.cjs" "$DEPLOY_DIR/ecosystem.config.cjs"
  cd "$BACKEND_DIR"
  run pm2 startOrReload "$DEPLOY_DIR/ecosystem.config.cjs" --update-env
  run pm2 save
}

configure_nginx() {
  if command -v nginx >/dev/null 2>&1; then
    sudo mkdir -p /etc/nginx/snippets
    sudo tee /etc/nginx/snippets/ai-worldcup-spa-common.conf >/dev/null <<'NGINXSNIPPET'
client_max_body_size 20m;

location = /health {
    proxy_pass http://ai_worldcup_api/health;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/ {
    proxy_pass http://ai_worldcup_api/api/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
}

location = /github-webhook {
    proxy_pass http://127.0.0.1:9000/github-webhook;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /assets/ {
    try_files $uri =404;
    expires 30d;
    add_header Cache-Control "public, max-age=2592000, immutable";
}

location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache";
}
NGINXSNIPPET
    sudo cp "$BACKEND_DIR/deploy/production/nginx-ai-worldcup.conf" /etc/nginx/sites-available/ai-worldcup.conf
    sudo ln -sfn /etc/nginx/sites-available/ai-worldcup.conf /etc/nginx/sites-enabled/ai-worldcup.conf
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo nginx -t
    sudo systemctl reload nginx || sudo systemctl restart nginx
  else
    log "WARN: nginx not installed; skipping nginx configuration."
  fi
}

health_check() {
  sleep 3
  local health_body
  if ! health_body="$(curl -fsS "http://127.0.0.1:$API_PORT/health")"; then
    log "ERROR: API health endpoint is unreachable"
    pm2 logs --lines 80 --nostream
    exit 1
  fi
  if ! printf '%s' "$health_body" | grep -q '"status":"ok"'; then
    log "ERROR: API health check did not return ok: $health_body"
    pm2 logs --lines 80 --nostream
    exit 1
  fi
  log "API health OK"
  curl -fsSI "http://127.0.0.1:8080/" >/dev/null && log "H5 health OK" || log "WARN: H5 HTTP check failed; inspect nginx status."
  curl -fsSI "http://127.0.0.1:8081/" >/dev/null && log "Admin health OK" || log "WARN: Admin HTTP check failed; inspect nginx status."
}

main() {
  ensure_base_dirs
  ensure_runtime
  sync_repo "$BACKEND_REPO_URL" "$BACKEND_DIR" "backend"
  sync_repo "$FRONTEND_REPO_URL" "$FRONTEND_DIR" "frontend"
  sync_repo "$ADMIN_REPO_URL" "$ADMIN_DIR" "admin"
  prepare_backend_env
  start_infra
  build_backend
  build_frontend
  build_admin
  configure_processes
  configure_nginx
  health_check
  log "Deployment completed successfully."
}

main "$@"
