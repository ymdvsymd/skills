#!/usr/bin/env bash
# update-readme-deploy-section.sh — README.md の "## 公開先" セクションを冪等に更新
#
# Usage:
#   update-readme-deploy-section.sh \
#     --url=<deploy-url> \
#     --target=cloudflare|github \
#     [--access-note="..."]
#
# 動作:
#   - <!-- DEPLOY_SECTION_BEGIN --> ... <!-- DEPLOY_SECTION_END --> ブロックを新内容で置換
#   - ブロックが無い README には冒頭の `# <title>` の直後に挿入
#   - README が無いプロジェクトでは何もしない（init-project.sh が新規生成する想定）

set -euo pipefail

URL=""
TARGET=""
ACCESS_NOTE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url=*)         URL="${1#*=}" ;;
    --target=*)      TARGET="${1#*=}" ;;
    --access-note=*) ACCESS_NOTE="${1#*=}" ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

if [[ -z "$URL" || -z "$TARGET" ]]; then
  echo "Usage: $0 --url=<URL> --target=cloudflare|github [--access-note=...]" >&2
  exit 1
fi

if [[ ! -e README.md ]]; then
  echo "  README.md not present; skipping deploy section update."
  exit 0
fi

case "$TARGET" in
  cloudflare)
    [[ -z "$ACCESS_NOTE" ]] && ACCESS_NOTE="関係者限定（HTTP Basic 認証）"
    INSTRUCTIONS='master/main push で GitHub Actions が Cloudflare Pages へ自動デプロイ。認証情報は別チャネルで共有。詳細は skill 内 `references/deploy-cloudflare.md` 参照。'
    ;;
  github)
    [[ -z "$ACCESS_NOTE" ]] && ACCESS_NOTE="公開（誰でも閲覧可）"
    INSTRUCTIONS='master/main push で GitHub Actions が GitHub Pages へ自動デプロイ。初回のみ Settings → Pages → Source: GitHub Actions の有効化が必要。'
    ;;
  *)
    echo "Unknown target: $TARGET" >&2
    exit 1
    ;;
esac

NEW_BLOCK=$(cat <<BLOCK
<!-- DEPLOY_SECTION_BEGIN -->
## 公開先

- **URL**: ${URL}
- **アクセス**: ${ACCESS_NOTE}

${INSTRUCTIONS}
<!-- DEPLOY_SECTION_END -->
BLOCK
)

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# 複数行を持つ NEW_BLOCK は awk -v では扱えないので環境変数経由 (ENVIRON)
export NEW_BLOCK

if grep -q '<!-- DEPLOY_SECTION_BEGIN -->' README.md; then
  awk '
    /<!-- DEPLOY_SECTION_BEGIN -->/ { print ENVIRON["NEW_BLOCK"]; in_block=1; next }
    /<!-- DEPLOY_SECTION_END -->/   { in_block=0; next }
    !in_block { print }
  ' README.md > "$TMP"
else
  awk '
    NR==1 && $0 ~ /^# / { print; print ""; print ENVIRON["NEW_BLOCK"]; printed=1; next }
    !printed && /^# / { print; print ""; print ENVIRON["NEW_BLOCK"]; printed=1; next }
    { print }
  ' README.md > "$TMP"
fi

mv "$TMP" README.md
trap - EXIT
echo "  updated: README.md (deploy section: $TARGET → $URL)"
