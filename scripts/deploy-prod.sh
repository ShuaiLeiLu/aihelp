#!/usr/bin/env sh
set -eu

# Production deploy script (run on server).
# Supports frontend+backend dual-container release with optional migration and health checks.

APP_DIR="${APP_DIR:-/opt/chatty}"
BRANCH="${BRANCH:-main}"
DEPLOY_REF="${DEPLOY_REF:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-chatty}"
BACKEND_SERVICE="${BACKEND_SERVICE:-chatty-backend}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-chatty-frontend}"
DEPLOY_NETWORK="${DEPLOY_NETWORK:-deploy_default}"

SKIP_GIT="${SKIP_GIT:-false}"
SKIP_BUILD="${SKIP_BUILD:-false}"
SKIP_MIGRATE="${SKIP_MIGRATE:-false}"
SKIP_HEALTH_CHECK="${SKIP_HEALTH_CHECK:-false}"
PRUNE_IMAGES="${PRUNE_IMAGES:-true}"
FORCE_RECREATE="${FORCE_RECREATE:-true}"

HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"
HEALTH_RETRY_INTERVAL_SECONDS="${HEALTH_RETRY_INTERVAL_SECONDS:-4}"
FRONTEND_HEALTH_URL="${FRONTEND_HEALTH_URL:-http://127.0.0.1:18080}"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:3001/api/health}"

DRY_RUN="${DRY_RUN:-false}"

usage() {
  cat <<'EOF'
Usage: deploy-prod.sh [options]

Options:
  --app-dir PATH                  Application directory on server
  --branch NAME                   Git branch to deploy (default: main)
  --ref REF                       Git ref/sha/tag to deploy (overrides --branch)
  --compose-file PATH             docker-compose file (default: docker-compose.prod.yml)
  --project NAME                  Compose project name (default: chatty)
  --backend-service NAME          Backend service name (default: chatty-backend)
  --frontend-service NAME         Frontend service name (default: chatty-frontend)
  --network NAME                  Docker network to ensure exists (default: deploy_default)
  --skip-git                      Skip git fetch/reset step
  --skip-build                    Skip docker compose build
  --skip-migrate                  Skip prisma migration
  --skip-health-check             Skip post-deploy health checks
  --no-prune-images               Do not run docker image prune -f
  --no-force-recreate             Do not pass --force-recreate to compose up
  --frontend-health-url URL       Frontend health URL (default: http://127.0.0.1:18080)
  --backend-health-url URL        Backend health URL (default: http://127.0.0.1:3001/api/health)
  --health-timeout SECONDS        Health check timeout (default: 120)
  --health-retry-interval SECOND  Health check retry interval (default: 4)
  --dry-run                       Print commands without executing
  -h, --help                      Show help
EOF
}

log() {
  printf '[deploy] %s\n' "$*"
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

bool_true() {
  case "$1" in
    true|1|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --app-dir)
        APP_DIR="$2"; shift 2 ;;
      --branch)
        BRANCH="$2"; shift 2 ;;
      --ref)
        DEPLOY_REF="$2"; shift 2 ;;
      --compose-file)
        COMPOSE_FILE="$2"; shift 2 ;;
      --project)
        COMPOSE_PROJECT_NAME="$2"; shift 2 ;;
      --backend-service)
        BACKEND_SERVICE="$2"; shift 2 ;;
      --frontend-service)
        FRONTEND_SERVICE="$2"; shift 2 ;;
      --network)
        DEPLOY_NETWORK="$2"; shift 2 ;;
      --skip-git)
        SKIP_GIT="true"; shift ;;
      --skip-build)
        SKIP_BUILD="true"; shift ;;
      --skip-migrate)
        SKIP_MIGRATE="true"; shift ;;
      --skip-health-check)
        SKIP_HEALTH_CHECK="true"; shift ;;
      --no-prune-images)
        PRUNE_IMAGES="false"; shift ;;
      --no-force-recreate)
        FORCE_RECREATE="false"; shift ;;
      --frontend-health-url)
        FRONTEND_HEALTH_URL="$2"; shift 2 ;;
      --backend-health-url)
        BACKEND_HEALTH_URL="$2"; shift 2 ;;
      --health-timeout)
        HEALTH_TIMEOUT_SECONDS="$2"; shift 2 ;;
      --health-retry-interval)
        HEALTH_RETRY_INTERVAL_SECONDS="$2"; shift 2 ;;
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

compose() {
  run docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" "$@"
}

health_check() {
  name="$1"
  url="$2"
  timeout="$3"
  interval="$4"
  elapsed=0

  while [ "$elapsed" -lt "$timeout" ]; do
    if curl -fsS -m 10 "$url" >/dev/null 2>&1; then
      log "$name healthy: $url"
      return 0
    fi
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done

  printf '[deploy] %s health check failed: %s (timeout=%ss)\n' "$name" "$url" "$timeout" >&2
  return 1
}

main() {
  parse_args "$@"

  require_cmd docker
  require_cmd curl

  log "app dir: $APP_DIR"
  run mkdir -p "$APP_DIR"
  cd "$APP_DIR"

  if [ ! -f "$COMPOSE_FILE" ]; then
    printf '[deploy] compose file not found: %s/%s\n' "$APP_DIR" "$COMPOSE_FILE" >&2
    exit 1
  fi

  if ! docker network inspect "$DEPLOY_NETWORK" >/dev/null 2>&1; then
    log "creating docker network: $DEPLOY_NETWORK"
    run docker network create "$DEPLOY_NETWORK"
  fi

  if [ "$SKIP_GIT" = "false" ]; then
    if [ -d ".git" ]; then
      require_cmd git
      target_ref="${DEPLOY_REF:-origin/$BRANCH}"
      log "updating code from git ref: $target_ref"
      run git fetch --tags origin "$BRANCH"
      run git reset --hard "$target_ref"
      run git clean -fd
    else
      log "no .git directory detected, skip git update"
    fi
  else
    log "skip git update"
  fi

  if [ "$SKIP_BUILD" = "false" ]; then
    log "building frontend/backend images"
    compose build "$BACKEND_SERVICE" "$FRONTEND_SERVICE"
  else
    log "skip image build"
  fi

  if [ "$SKIP_MIGRATE" = "false" ]; then
    log "running prisma migration on $BACKEND_SERVICE while the current release remains online"
    compose run --rm --no-deps "$BACKEND_SERVICE" npm run prisma:deploy
  else
    log "skip prisma migration"
  fi

  log "starting services"
  if [ "$FORCE_RECREATE" = "true" ]; then
    compose up -d --force-recreate "$BACKEND_SERVICE" "$FRONTEND_SERVICE"
  else
    compose up -d "$BACKEND_SERVICE" "$FRONTEND_SERVICE"
  fi

  if [ "$PRUNE_IMAGES" = "true" ]; then
    log "pruning dangling images"
    run docker image prune -f
  fi

  if [ "$SKIP_HEALTH_CHECK" = "false" ]; then
    log "running health checks"
    health_check "frontend" "$FRONTEND_HEALTH_URL" "$HEALTH_TIMEOUT_SECONDS" "$HEALTH_RETRY_INTERVAL_SECONDS"
    health_check "backend" "$BACKEND_HEALTH_URL" "$HEALTH_TIMEOUT_SECONDS" "$HEALTH_RETRY_INTERVAL_SECONDS"
  else
    log "skip health checks"
  fi

  log "deploy finished successfully"
}

main "$@"
