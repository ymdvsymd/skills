#!/usr/bin/env bash
# place-cloudflare-assets.sh — Cloudflare Pages 用の各種ファイルを assets/ から配置
#
# Usage:
#   place-cloudflare-assets.sh <CF_PROJECT_NAME> <REPO_NAME> <BRANCH> [<COMPAT_DATE>]
#
# 配置するもの:
#   .github/workflows/cloudflare-pages.yml
#   functions/_middleware.ts
#   wrangler.toml
#   .env.local.example
#
# 既に存在するファイルはスキップ（init-project.sh と同じ idempotent 挙動）。

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <CF_PROJECT_NAME> <REPO_NAME> <BRANCH> [<COMPAT_DATE>]" >&2
  exit 1
fi

CF_PROJECT_NAME="$1"
REPO_NAME="$2"
BRANCH="$3"
COMPAT_DATE="${4:-$(date -u +%Y-%m-%d)}"

SKILL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ASSETS_DIR="$SKILL_DIR/assets"

if [[ ! -d "$ASSETS_DIR" ]]; then
  echo "Error: assets/ not found at $ASSETS_DIR" >&2
  exit 1
fi

mkdir -p .github/workflows functions

place() {
  local src="$1"
  local dst="$2"
  if [[ -e "$dst" ]]; then
    echo "  skip (exists): $dst"
    return
  fi
  sed \
    -e "s|__CF_PROJECT_NAME__|${CF_PROJECT_NAME}|g" \
    -e "s|__REPO_NAME__|${REPO_NAME}|g" \
    -e "s|__BRANCH__|${BRANCH}|g" \
    -e "s|__COMPAT_DATE__|${COMPAT_DATE}|g" \
    "$src" > "$dst"
  echo "  wrote: $dst"
}

place "$ASSETS_DIR/cloudflare-pages-yml.template"      ".github/workflows/cloudflare-pages.yml"
place "$ASSETS_DIR/cloudflare-middleware-ts.template"  "functions/_middleware.ts"
place "$ASSETS_DIR/wrangler-toml.template"             "wrangler.toml"
place "$ASSETS_DIR/env-local-example.template"         ".env.local.example"
