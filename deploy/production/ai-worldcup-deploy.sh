#!/usr/bin/env bash
set -Eeuo pipefail

BACKEND_REPO_URL="${BACKEND_REPO_URL:-git@github-backend:reportyao/ai-worldcup-backend.git}"
FRONTEND_REPO_URL="${FRONTEND_REPO_URL:-git@github-frontend:reportyao/ai-worldcup-frontend.git}"
BACKEND_DIR="${BACKEND_DIR:-/home/ubuntu/apps/ai-worldcup-backend}"
FRONTEND_DIR="${FRONTEND_DIR:-/home/ubuntu/apps/ai-worldcup-frontend}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/deploy}"
WEB_ROOT="${WEB_ROOT:-/var/www/ai-worldcup}"
LOG_DIR="${LOG_DIR:-/home/ubuntu/logs}"
BRANCH="${DEPLOY_BRANCH:-main}"
API_PORT="${API_PORT:-3000}"
PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-http://82.157.76.140}"
VITE_API_BASE_URL="${VITE_API_BASE_URL:-/api}"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
run() { log "+ $*"; "$@"; }

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
  sudo mkdir -p "$WEB_ROOT"
  sudo chown -R ubuntu:ubuntu /home/ubuntu/apps "$DEPLOY_DIR" "$LOG_DIR"
}

ensure_runtime() {
  ensure_command git
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
    cat > "$env_file" <<ENVEOF
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
    chmod 600 "$env_file"
    log "Created default backend .env. Fill real WeChat/AI/payment secrets before public launch."
  fi
}

start_infra() {
  cd "$BACKEND_DIR"
  if [ -f docker-compose.yml ]; then
    docker rm ai-worldcup-postgres ai-worldcup-redis >/dev/null 2>&1 || true
    log "+ docker_compose up -d postgres redis"
    if docker_compose up -d postgres redis; then
      return
    fi
    if sudo ss -ltn | grep -q ':5432 ' && sudo ss -ltn | grep -q ':6379 '; then
      log "WARN: PostgreSQL/Redis ports are already occupied; reusing existing local services and continuing."
      return
    fi
    log "ERROR: failed to start PostgreSQL/Redis and required ports are not available."
    exit 1
  fi
}

build_backend() {
  cd "$BACKEND_DIR"
  run pnpm install --frozen-lockfile
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

configure_processes() {
  mkdir -p "$LOG_DIR"
  cp "$BACKEND_DIR/deploy/production/ecosystem.config.cjs" "$DEPLOY_DIR/ecosystem.config.cjs"
  cd "$BACKEND_DIR"
  run pm2 startOrReload "$DEPLOY_DIR/ecosystem.config.cjs" --update-env
  run pm2 save
}

configure_nginx() {
  if command -v nginx >/dev/null 2>&1; then
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
  curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null && log "API health OK" || { log "ERROR: API health check failed"; pm2 logs --lines 80 --nostream; exit 1; }
  curl -fsSI "http://127.0.0.1/" >/dev/null && log "Frontend health OK" || log "WARN: frontend HTTP check failed; inspect nginx status."
}

main() {
  ensure_base_dirs
  ensure_runtime
  sync_repo "$BACKEND_REPO_URL" "$BACKEND_DIR" "backend"
  sync_repo "$FRONTEND_REPO_URL" "$FRONTEND_DIR" "frontend"
  prepare_backend_env
  start_infra
  build_backend
  build_frontend
  configure_processes
  configure_nginx
  health_check
  log "Deployment completed successfully."
}

main "$@"
