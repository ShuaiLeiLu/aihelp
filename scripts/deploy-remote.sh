#!/usr/bin/env sh
set -eu

# Local-to-remote deploy helper:
# 1) Package current workspace (excluding ignored files)
# 2) Upload to server
# 3) Extract and run scripts/deploy-prod.sh remotely

REMOTE_HOST="${REMOTE_HOST:-43.155.204.215}"
REMOTE_PORT="${REMOTE_PORT:-22}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PASS="${REMOTE_PASS:-}"
SSH_STRICT_HOST_KEY_CHECKING="${SSH_STRICT_HOST_KEY_CHECKING:-accept-new}"
ALLOW_ROOT_DEPLOY="${ALLOW_ROOT_DEPLOY:-false}"
REMOTE_DIR="${REMOTE_DIR:-/opt/chatty}"
REMOTE_TMP="${REMOTE_TMP:-/tmp/chatty-release.tar.gz}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-chatty}"
DEPLOY_NETWORK="${DEPLOY_NETWORK:-deploy_default}"

LOCAL_ROOT="${LOCAL_ROOT:-$(pwd)}"
TAR_PATH="${TAR_PATH:-/tmp/chatty-release.tar.gz}"

APP_ORIGIN="${APP_ORIGIN:-https://om.shuai.help}"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-https://aihelp-backend.shuai.help/api/health}"
FRONTEND_HEALTH_URL="${FRONTEND_HEALTH_URL:-https://om.shuai.help}"

SKIP_MIGRATE="${SKIP_MIGRATE:-false}"
SKIP_BUILD="${SKIP_BUILD:-false}"
DRY_RUN="${DRY_RUN:-false}"

usage() {
  cat <<'EOF'
Usage: deploy-remote.sh [options]

Options:
  --password PASS                SSH password (or set REMOTE_PASS)
  --host HOST                    Remote host (default: 43.155.204.215)
  --port PORT                    SSH port (default: 22)
  --user USER                    SSH user (default: root)
  --remote-dir PATH              Deploy target dir (default: /opt/chatty)
  --project NAME                 Compose project name (default: chatty)
  --network NAME                 Docker network to ensure exists (default: deploy_default)
  --app-origin URL               APP_ORIGIN override for backend service
  --frontend-health-url URL      Frontend health URL
  --backend-health-url URL       Backend health URL
  --skip-migrate                 Skip prisma migrate deploy
  --skip-build                   Skip docker image build
  --dry-run                      Print commands only
  -h, --help                     Show help

Environment:
  ALLOW_ROOT_DEPLOY=true         Explicitly allow deploying as root
  SSH_STRICT_HOST_KEY_CHECKING   SSH host-key policy (default: accept-new)
EOF
}

log() {
  printf '[remote-deploy] %s\n' "$*"
}

run() {
  if [ "$DRY_RUN" = "true" ]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --host)
        REMOTE_HOST="$2"; shift 2 ;;
      --port)
        REMOTE_PORT="$2"; shift 2 ;;
      --user)
        REMOTE_USER="$2"; shift 2 ;;
      --password)
        REMOTE_PASS="$2"; shift 2 ;;
      --remote-dir)
        REMOTE_DIR="$2"; shift 2 ;;
      --project)
        COMPOSE_PROJECT_NAME="$2"; shift 2 ;;
      --network)
        DEPLOY_NETWORK="$2"; shift 2 ;;
      --app-origin)
        APP_ORIGIN="$2"; shift 2 ;;
      --frontend-health-url)
        FRONTEND_HEALTH_URL="$2"; shift 2 ;;
      --backend-health-url)
        BACKEND_HEALTH_URL="$2"; shift 2 ;;
      --skip-migrate)
        SKIP_MIGRATE="true"; shift ;;
      --skip-build)
        SKIP_BUILD="true"; shift ;;
      --dry-run)
        DRY_RUN="true"; shift ;;
      -h|--help)
        usage; exit 0 ;;
      *)
        printf 'Unknown option: %s\n\n' "$1" >&2
        usage
        exit 1 ;;
    esac
  done
}

remote_cmd() {
  if [ -n "$REMOTE_PASS" ]; then
    run sshpass -e ssh \
      -o "StrictHostKeyChecking=$SSH_STRICT_HOST_KEY_CHECKING" \
      -p "$REMOTE_PORT" \
      "$REMOTE_USER@$REMOTE_HOST" "$@"
  else
    run ssh \
      -o "StrictHostKeyChecking=$SSH_STRICT_HOST_KEY_CHECKING" \
      -p "$REMOTE_PORT" \
      "$REMOTE_USER@$REMOTE_HOST" "$@"
  fi
}

upload_release() {
  if [ -n "$REMOTE_PASS" ]; then
    run sshpass -e scp \
      -o "StrictHostKeyChecking=$SSH_STRICT_HOST_KEY_CHECKING" \
      -P "$REMOTE_PORT" \
      "$TAR_PATH" \
      "$REMOTE_USER@$REMOTE_HOST:$REMOTE_TMP"
  else
    run scp \
      -o "StrictHostKeyChecking=$SSH_STRICT_HOST_KEY_CHECKING" \
      -P "$REMOTE_PORT" \
      "$TAR_PATH" \
      "$REMOTE_USER@$REMOTE_HOST:$REMOTE_TMP"
  fi
}

main() {
  parse_args "$@"

  require_cmd tar
  require_cmd scp
  require_cmd ssh

  if [ -n "$REMOTE_PASS" ]; then
    require_cmd sshpass
    export SSHPASS="$REMOTE_PASS"
  else
    log "using SSH key/agent authentication"
  fi

  if [ "$REMOTE_USER" = "root" ] && [ "$ALLOW_ROOT_DEPLOY" != "true" ]; then
    printf 'Refusing root deployment. Set ALLOW_ROOT_DEPLOY=true only when root is required.\n' >&2
    exit 1
  fi

  log "packaging workspace from $LOCAL_ROOT"
  run rm -f "$TAR_PATH"
  run tar -czf "$TAR_PATH" \
    --exclude-vcs \
    --exclude='node_modules' \
    --exclude='backend/node_modules' \
    --exclude='.next' \
    --exclude='out' \
    --exclude='*.log' \
    --exclude='.DS_Store' \
    --exclude='._*' \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='*/.env' \
    --exclude='*/.env.*' \
    --exclude='.github/.env' \
    --exclude='backend/.env' \
    --exclude='miniprogram/utils/config.local.js' \
    --exclude='miniprogram/project.private.config.json' \
    -C "$LOCAL_ROOT" \
    .

  log "uploading package to $REMOTE_USER@$REMOTE_HOST:$REMOTE_TMP"
  upload_release

  log "extracting package and running remote deploy script"
  remote_cmd "set -eu; \
    mkdir -p '$REMOTE_DIR'; \
    tar -xzf '$REMOTE_TMP' -C '$REMOTE_DIR'; \
    chmod +x '$REMOTE_DIR/scripts/deploy-prod.sh'; \
    APP_DIR='$REMOTE_DIR' \
    COMPOSE_PROJECT_NAME='$COMPOSE_PROJECT_NAME' \
    DEPLOY_NETWORK='$DEPLOY_NETWORK' \
    SKIP_GIT=true \
    SKIP_BUILD='$SKIP_BUILD' \
    SKIP_MIGRATE='$SKIP_MIGRATE' \
    FRONTEND_HEALTH_URL='$FRONTEND_HEALTH_URL' \
    BACKEND_HEALTH_URL='$BACKEND_HEALTH_URL' \
    '$REMOTE_DIR/scripts/deploy-prod.sh'"

  log "ensuring backend APP_ORIGIN is set for runtime"
  remote_cmd "set -eu; \
    cd '$REMOTE_DIR'; \
    APP_ORIGIN='$APP_ORIGIN' docker compose -p '$COMPOSE_PROJECT_NAME' -f docker-compose.prod.yml up -d --force-recreate chatty-backend"

  log "remote deploy completed"
}

main "$@"
