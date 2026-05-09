#!/usr/bin/env bash
# migrate-to-cloudflare.sh — 既存 GitHub Pages 構成を Cloudflare Pages + Basic 認証に切り替え
#
# Usage:
#   bash migrate-to-cloudflare.sh                  # Phase 1: ファイル配置 + .env.local 待機
#   bash migrate-to-cloudflare.sh --continue       # Phase 2: .env.local 入力後に実デプロイ + GH Pages 停止
#
# Optional:
#   --cloudflare-project-name=<name>   ランダム生成された名前を上書き
#   --branch=<main|master>             デフォルトは現在のブランチ

set -euo pipefail

CF_PROJECT_NAME=""
BRANCH=""
CONTINUE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cloudflare-project-name=*) CF_PROJECT_NAME="${1#*=}" ;;
    --branch=*) BRANCH="${1#*=}" ;;
    --continue) CONTINUE=1 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_NAME=$(basename "$PWD")
[[ -z "$BRANCH" ]] && BRANCH=$(git branch --show-current 2>/dev/null || echo master)

# ランダム CF プロジェクト名生成（英字始まり 16 文字）
gen_project_name() {
  local raw
  raw=$(head -c 96 /dev/urandom | base64 | LC_ALL=C tr -dc 'A-Za-z0-9' | LC_ALL=C tr 'A-Z' 'a-z' | head -c 16)
  if [[ "${raw:0:1}" =~ [0-9] ]]; then
    raw="a${raw:0:15}"
  fi
  printf '%s' "$raw"
}

if [[ "$CONTINUE" -eq 0 ]]; then
  echo "=== Phase 1: Placing Cloudflare assets ==="

  # 1. wrangler.toml がまだ無ければランダム名で配置
  if [[ ! -e wrangler.toml ]]; then
    [[ -z "$CF_PROJECT_NAME" ]] && CF_PROJECT_NAME=$(gen_project_name)
    "$SKILL_DIR/scripts/lib/place-cloudflare-assets.sh" "$CF_PROJECT_NAME" "$REPO_NAME" "$BRANCH"
  else
    CF_PROJECT_NAME=$(awk -F'"' '/^name[[:space:]]*=/{print $2; exit}' wrangler.toml)
    echo "  wrangler.toml already exists; using project name: $CF_PROJECT_NAME"
  fi

  # 2. VitePress config の base 行を削除（js / mts 両対応）
  for cfg in docs/.vitepress/config.mts docs/.vitepress/config.js; do
    [[ -e "$cfg" ]] || continue
    if grep -qE "^[[:space:]]*base:[[:space:]]*'/.*/',?[[:space:]]*$" "$cfg"; then
      sed -i.bak -E "/^[[:space:]]*base:[[:space:]]*'\/.*\/',?[[:space:]]*$/d" "$cfg"
      rm -f "$cfg.bak"
      echo "  removed: base line from $cfg"
    fi
  done

  # 3. 旧 GitHub Pages workflow を削除
  if [[ -e .github/workflows/deploy.yml ]]; then
    git rm -f .github/workflows/deploy.yml >/dev/null 2>&1 || rm -f .github/workflows/deploy.yml
    echo "  removed: .github/workflows/deploy.yml"
  fi

  # 4. .gitignore に .env.local を追加（既にあれば no-op）
  if [[ -e .gitignore ]] && ! grep -qxF '.env.local' .gitignore; then
    printf '\n# Local secrets for Cloudflare Pages\n.env.local\n' >> .gitignore
    echo "  appended: .env.local to .gitignore"
  fi

  echo ""
  echo "=========================================================="
  echo "Phase 1 done. Next steps:"
  echo "  1) cp .env.local.example .env.local"
  echo "  2) Edit .env.local and fill in CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,"
  echo "     BASIC_AUTH_USER, BASIC_AUTH_PASS"
  echo "  3) Re-run with --continue:"
  echo "       bash $0 --continue"
  echo "=========================================================="
  exit 0
fi

# === Phase 2 ===
echo "=== Phase 2: Deploy + disable GitHub Pages ==="

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local not found. Run Phase 1 first and fill in .env.local." >&2
  exit 1
fi

# 5. Cloudflare 初回デプロイ + GitHub Secrets + README 更新
"$SKILL_DIR/scripts/init-cloudflare-deployment.sh"

# 6. GitHub Pages を停止
OWNER_REPO=$(gh repo view --json owner,name -q '.owner.login + "/" + .name' 2>/dev/null || echo "")
if [[ -n "$OWNER_REPO" ]]; then
  echo ""
  echo "=== 8. Disabling GitHub Pages ==="
  gh api -X DELETE "repos/$OWNER_REPO/pages" 2>&1 \
    | tail -3 || echo "(Pages may have been already disabled or never configured)"

  echo ""
  echo "=== 9. Deleting gh-pages branch ==="
  git push origin --delete gh-pages 2>&1 \
    | tail -3 || echo "(gh-pages branch absent or already deleted)"
fi

echo ""
echo "=========================================================="
echo "✅ Migration complete."
echo "Review the staged changes and commit:"
echo ""
git status --short
echo ""
echo "  git add -A"
echo "  git commit -m 'feat: switch hosting to Cloudflare Pages with Basic auth'"
echo "  git push"
echo "=========================================================="
