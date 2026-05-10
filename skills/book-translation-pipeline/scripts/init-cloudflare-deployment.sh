#!/usr/bin/env bash
# init-cloudflare-deployment.sh — .env.local 前提で Cloudflare Pages の初回デプロイを CLI 完結
#
# 前提:
#   - .env.local に CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / BASIC_AUTH_USER / BASIC_AUTH_PASS
#   - wrangler.toml が配置済み（init-project.sh または migrate-to-cloudflare.sh が配置）
#   - npm / gh CLI がインストール済み
#   - gh CLI でリポジトリオーナーアカウントにログイン済み
#
# 動作:
#   1. wrangler を devDependency に追加（既に入っていれば no-op）
#   2. Cloudflare Pages プロジェクト作成（既存ならスキップ）
#   3. BASIC_AUTH_USER / BASIC_AUTH_PASS を Cloudflare の secret に登録（stdin 経由でログに値を出さない）
#   4. ビルド & 初回デプロイ
#   5. CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID を GitHub Secrets に登録
#   6. README の "## 公開先" セクションを deploy URL で更新

set -euo pipefail

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local not found. Copy .env.local.example and fill it in." >&2
  exit 1
fi
if [[ ! -f wrangler.toml ]]; then
  echo "ERROR: wrangler.toml not found. Run init-project.sh with --deploy-target=cloudflare first." >&2
  exit 1
fi

# 値は echo しない
set -a && source .env.local && set +a
unset NODE_TLS_REJECT_UNAUTHORIZED  # Netskope 等の SSL Inspection 環境対策

# 必須環境変数の存在確認（値の長さだけチェック、内容は出さない）
for v in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID BASIC_AUTH_USER BASIC_AUTH_PASS; do
  if [[ -z "${!v:-}" ]]; then
    echo "ERROR: $v is empty in .env.local" >&2
    exit 1
  fi
done

PROJECT_NAME=$(awk -F'"' '/^name[[:space:]]*=/{print $2; exit}' wrangler.toml)
if [[ -z "$PROJECT_NAME" ]]; then
  echo "ERROR: could not read 'name' from wrangler.toml" >&2
  exit 1
fi

# 現在の git ブランチを使う（main/master 両対応）
PROD_BRANCH=$(git branch --show-current 2>/dev/null || echo master)
if [[ -z "$PROD_BRANCH" ]]; then
  PROD_BRANCH="master"
fi

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== 1. Installing wrangler as devDependency ==="
npm i -D wrangler 2>&1 | tail -5

echo ""
echo "=== 2. Creating Cloudflare Pages project: $PROJECT_NAME (production branch: $PROD_BRANCH) ==="
npx wrangler pages project create "$PROJECT_NAME" --production-branch="$PROD_BRANCH" 2>&1 \
  | tail -10 || echo "(project may already exist; continuing)"

echo ""
echo "=== 3. Uploading Basic auth secrets ==="
printf '%s' "$BASIC_AUTH_USER" | npx wrangler pages secret put BASIC_AUTH_USER --project-name="$PROJECT_NAME" 2>&1 | tail -5
printf '%s' "$BASIC_AUTH_PASS" | npx wrangler pages secret put BASIC_AUTH_PASS --project-name="$PROJECT_NAME" 2>&1 | tail -5

echo ""
echo "=== 4. Building VitePress site ==="
npm run build 2>&1 | tail -10

echo ""
echo "=== 5. First deployment ==="
npx wrangler pages deploy docs/.vitepress/dist \
  --project-name="$PROJECT_NAME" --branch="$PROD_BRANCH" 2>&1 | tail -15

echo ""
echo "=== 6. Registering GitHub Secrets ==="
printf '%s' "$CLOUDFLARE_API_TOKEN"  | gh secret set CLOUDFLARE_API_TOKEN
printf '%s' "$CLOUDFLARE_ACCOUNT_ID" | gh secret set CLOUDFLARE_ACCOUNT_ID
echo "  registered: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID"

DEPLOY_URL="https://${PROJECT_NAME}.pages.dev/"

echo ""
echo "=== 7. Updating README ==="
"$SKILL_DIR/scripts/lib/update-readme-deploy-section.sh" \
  --url="$DEPLOY_URL" \
  --target=cloudflare \
  --access-note="関係者限定（HTTP Basic 認証）"

echo ""
echo "============================================================"
echo "✅ Cloudflare Pages setup complete."
echo ""
echo "⚠️  Bookmark this URL — it is randomized and cannot be guessed:"
echo "    $DEPLOY_URL"
echo ""
echo "Share the URL and BASIC_AUTH_USER / BASIC_AUTH_PASS via a private channel."
echo "============================================================"
