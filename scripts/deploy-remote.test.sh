#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT="$SCRIPT_DIR/deploy-remote.sh"

grep -F -- "--exclude='.env'" "$SCRIPT" >/dev/null
grep -F -- "--exclude='.env.*'" "$SCRIPT" >/dev/null
grep -F -- "--exclude='backend/.env'" "$SCRIPT" >/dev/null
grep -F -- "--exclude='.github/.env'" "$SCRIPT" >/dev/null
grep -F -- "--exclude='miniprogram/utils/config.local.js'" "$SCRIPT" >/dev/null
grep -F -- '"prisma":' "$SCRIPT_DIR/../backend/package.json" >/dev/null
grep -F -- './node_modules/.bin/prisma generate' "$SCRIPT_DIR/../backend/Dockerfile" >/dev/null

TEST_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/chatty-deploy-test.XXXXXX")
trap 'rm -rf "$TEST_ROOT"' EXIT HUP INT TERM
mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/work/.github" "$TEST_ROOT/work/backend" "$TEST_ROOT/work/miniprogram/utils"
printf 'keep\n' > "$TEST_ROOT/work/README.md"
printf 'secret\n' > "$TEST_ROOT/work/.env.local"
printf 'secret\n' > "$TEST_ROOT/work/.github/.env"
printf 'secret\n' > "$TEST_ROOT/work/backend/.env"
printf 'secret\n' > "$TEST_ROOT/work/miniprogram/utils/config.local.js"
printf '#!/bin/sh\nexit 0\n' > "$TEST_ROOT/bin/ssh"
printf '#!/bin/sh\nexit 0\n' > "$TEST_ROOT/bin/scp"
chmod +x "$TEST_ROOT/bin/ssh" "$TEST_ROOT/bin/scp"
LOCAL_ROOT="$TEST_ROOT/work" \
TAR_PATH="$TEST_ROOT/release.tar.gz" \
REMOTE_USER=deploy \
PATH="$TEST_ROOT/bin:$PATH" \
"$SCRIPT" >/dev/null

tar -tzf "$TEST_ROOT/release.tar.gz" > "$TEST_ROOT/archive.list"
grep -F -- './README.md' "$TEST_ROOT/archive.list" >/dev/null
if grep -E -- '(^|/)(\.env|\.env\.|config\.local\.js)(/|$)' "$TEST_ROOT/archive.list" >/dev/null; then
  printf 'release archive contains a secret file\n' >&2
  exit 1
fi

printf 'deploy archive exclusion checks passed\n'
