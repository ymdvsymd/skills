#!/usr/bin/env bash
# init-project.sh — book-translation-pipeline skill の新規プロジェクト初期化
#
# Usage:
#   init-project.sh <project-name> <epub-filename> <book-title-ja> \
#       [--branch main|master] \
#       [--deploy-target=cloudflare|github] \
#       [--cloudflare-project-name=<name>]
#
# 例:
#   init-project.sh DMRB-Vol4 dmrb4.epub "DMRB Vol.4 — Japanese Translation"
#   init-project.sh DMRB-Vol4 dmrb4.epub "DMRB Vol.4" --branch master --deploy-target=cloudflare
#
# デプロイ先判定の優先順:
#   1. --deploy-target=... 引数
#   2. 環境変数 DEPLOY_TARGET
#   3. gh CLI で visibility 自動判定 (PRIVATE→cloudflare, PUBLIC→github)
#   4. tty があれば read で対話プロンプト、なければ exit 1
#
# 動作:
#   - カレントディレクトリ (= プロジェクトディレクトリ) に対して assets/ 配下のテンプレートを
#     プレースホルダ置換しながらコピー配置する。
#   - placeholder: __PROJECT_NAME__, __EPUB_FILENAME__, __BOOK_TITLE_JA__, __BRANCH__,
#                  __REPO_NAME__ (PROJECT_NAME を小文字化), __GITHUB_USER__,
#                  __CF_PROJECT_NAME__, __COMPAT_DATE__,
#                  __DEPLOY_URL__, __DEPLOY_ACCESS_NOTE__, __DEPLOY_INSTRUCTIONS_BLOCK__
#   - Cloudflare 選択時は wrangler.toml / functions/_middleware.ts / cloudflare-pages.yml /
#     .env.local.example を配置し、vitepress-config.mts の `base:` 行は削除する
#   - GitHub Pages 選択時は既存どおり github-deploy-yml.template を配置
#   - bd (beads) は別途 `bd init` を実行してください。

set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <project-name> <epub-filename> <book-title-ja> [--branch main|master] [--deploy-target=cloudflare|github] [--cloudflare-project-name=<name>]" >&2
  exit 1
fi

PROJECT_NAME="$1"
EPUB_FILENAME="$2"
BOOK_TITLE_JA="$3"
shift 3

BRANCH="main"
DEPLOY_TARGET="${DEPLOY_TARGET:-}"
CF_PROJECT_NAME="${CLOUDFLARE_PROJECT_NAME:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      BRANCH="$2"; shift 2 ;;
    --branch=*)
      BRANCH="${1#*=}"; shift ;;
    --deploy-target=*)
      DEPLOY_TARGET="${1#*=}"; shift ;;
    --cloudflare-project-name=*)
      CF_PROJECT_NAME="${1#*=}"; shift ;;
    *)
      echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

REPO_NAME=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]')
GITHUB_USER=$(git config --global --get github.user 2>/dev/null || git config --get user.email 2>/dev/null | cut -d@ -f1 || echo "your-github-user")
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS_DIR="$SKILL_DIR/assets"
SCRIPTS_DIR="$SKILL_DIR/scripts"
COMPAT_DATE=$(date -u +%Y-%m-%d)

if [[ ! -d "$ASSETS_DIR" ]]; then
  echo "Error: assets/ not found at $ASSETS_DIR" >&2
  exit 1
fi

# === デプロイ先判定 ===

if [[ -z "$DEPLOY_TARGET" ]]; then
  visibility=$(gh repo view --json visibility -q .visibility 2>/dev/null || true)
  case "$visibility" in
    PRIVATE) DEPLOY_TARGET=cloudflare ;;
    PUBLIC)  DEPLOY_TARGET=github ;;
  esac
fi

if [[ -z "$DEPLOY_TARGET" ]]; then
  if [[ -t 0 ]]; then
    echo "Could not auto-detect deploy target. Choose:"
    echo "  1) Cloudflare Pages (Basic auth, for private/draft sharing)"
    echo "  2) GitHub Pages (public)"
    read -rp "Enter 1 or 2: " choice
    case "$choice" in
      1) DEPLOY_TARGET=cloudflare ;;
      2) DEPLOY_TARGET=github ;;
      *) echo "Invalid choice" >&2; exit 1 ;;
    esac
  else
    echo "ERROR: --deploy-target not specified and cannot determine automatically." >&2
    echo "Pass --deploy-target=cloudflare or --deploy-target=github." >&2
    exit 1
  fi
fi

if [[ "$DEPLOY_TARGET" != "cloudflare" && "$DEPLOY_TARGET" != "github" ]]; then
  echo "ERROR: invalid deploy target: $DEPLOY_TARGET (must be cloudflare or github)" >&2
  exit 1
fi

# === Cloudflare 選択時のプロジェクト名 (URL 推測困難化のためランダム) ===

if [[ "$DEPLOY_TARGET" == "cloudflare" && -z "$CF_PROJECT_NAME" ]]; then
  # base64 経由で ASCII 化してから filter (macOS の tr は /dev/urandom の生バイトで Illegal byte sequence を出すため)
  raw=$(head -c 96 /dev/urandom | base64 | LC_ALL=C tr -dc 'A-Za-z0-9' | LC_ALL=C tr 'A-Z' 'a-z' | head -c 16)
  if [[ "${raw:0:1}" =~ [0-9] ]]; then
    raw="a${raw:0:15}"
  fi
  CF_PROJECT_NAME="$raw"
fi

# === デプロイ先別のメタ情報 ===

case "$DEPLOY_TARGET" in
  cloudflare)
    DEPLOY_URL="https://${CF_PROJECT_NAME}.pages.dev/"
    DEPLOY_ACCESS_NOTE="関係者限定（HTTP Basic 認証）"
    ;;
  github)
    DEPLOY_URL="https://${GITHUB_USER}.github.io/${REPO_NAME}/"
    DEPLOY_ACCESS_NOTE="公開（誰でも閲覧可）"
    ;;
esac

echo "Initializing project: $PROJECT_NAME"
echo "  EPUB:           $EPUB_FILENAME"
echo "  Title:          $BOOK_TITLE_JA"
echo "  Branch:         $BRANCH"
echo "  Repo name:      $REPO_NAME"
echo "  GitHub user:    $GITHUB_USER"
echo "  Deploy target:  $DEPLOY_TARGET"
echo "  Deploy URL:     $DEPLOY_URL"
[[ "$DEPLOY_TARGET" == "cloudflare" ]] && echo "  CF project:     $CF_PROJECT_NAME (random, unguessable)"
echo

mkdir -p docs/en docs/ja docs/.vitepress docs/.vitepress/theme scripts scripts/lib .github/workflows

# Placeholder 置換コピー
copy_with_replace() {
  local src="$1"
  local dst="$2"
  if [[ -e "$dst" ]]; then
    echo "  skip (exists): $dst"
    return
  fi
  sed \
    -e "s|__PROJECT_NAME__|${PROJECT_NAME}|g" \
    -e "s|__EPUB_FILENAME__|${EPUB_FILENAME}|g" \
    -e "s|__BOOK_TITLE_JA__|${BOOK_TITLE_JA}|g" \
    -e "s|__BRANCH__|${BRANCH}|g" \
    -e "s|__REPO_NAME__|${REPO_NAME}|g" \
    -e "s|__GITHUB_USER__|${GITHUB_USER}|g" \
    -e "s|__CF_PROJECT_NAME__|${CF_PROJECT_NAME}|g" \
    -e "s|__COMPAT_DATE__|${COMPAT_DATE}|g" \
    -e "s|__DEPLOY_URL__|${DEPLOY_URL}|g" \
    -e "s|__DEPLOY_ACCESS_NOTE__|${DEPLOY_ACCESS_NOTE}|g" \
    "$src" > "$dst"
  echo "  wrote: $dst"
}

# === 雛形を配置 (共通) ===
copy_with_replace "$ASSETS_DIR/package.json.template"               "package.json"
copy_with_replace "$ASSETS_DIR/gitignore.template"                  ".gitignore"
copy_with_replace "$ASSETS_DIR/agents-md.template"                  "AGENTS.md"
copy_with_replace "$ASSETS_DIR/claude-md.template"                  "CLAUDE.md"
copy_with_replace "$ASSETS_DIR/vitepress-config.mts.template"       "docs/.vitepress/config.mts"
copy_with_replace "$ASSETS_DIR/vitepress-theme-custom-css.template" "docs/.vitepress/theme/custom.css"
copy_with_replace "$ASSETS_DIR/vitepress-theme-index-ts.template"   "docs/.vitepress/theme/index.ts"
copy_with_replace "$ASSETS_DIR/docs-index-md.template"              "docs/index.md"
copy_with_replace "$ASSETS_DIR/docs-ja-index-md.template"           "docs/ja/index.md"

# === デプロイ先別の配置 ===
case "$DEPLOY_TARGET" in
  cloudflare)
    "$SKILL_DIR/scripts/lib/place-cloudflare-assets.sh" \
      "$CF_PROJECT_NAME" "$REPO_NAME" "$BRANCH" "$COMPAT_DATE"
    # vitepress-config.mts の base 行削除（GitHub Pages 用の base は不要）
    if [[ -e docs/.vitepress/config.mts ]] && \
       grep -qE "^[[:space:]]*base:[[:space:]]*'/.*/',?[[:space:]]*$" docs/.vitepress/config.mts; then
      sed -i.bak -E "/^[[:space:]]*base:[[:space:]]*'\/.*\/',?[[:space:]]*$/d" docs/.vitepress/config.mts
      rm -f docs/.vitepress/config.mts.bak
      echo "  removed: base line from docs/.vitepress/config.mts"
    fi
    ;;
  github)
    copy_with_replace "$ASSETS_DIR/github-deploy-yml.template" ".github/workflows/deploy.yml"
    ;;
esac

# === README (新規プロジェクトのみ生成、既存は触らない) ===
if [[ ! -e README.md ]]; then
  case "$DEPLOY_TARGET" in
    cloudflare)
      DEPLOY_INSTRUCTIONS_BLOCK='master/main push で GitHub Actions が Cloudflare Pages へ自動デプロイ。認証情報は別チャネルで共有。詳細は skill 内 `references/deploy-cloudflare.md` 参照。'
      ;;
    github)
      DEPLOY_INSTRUCTIONS_BLOCK='master/main push で GitHub Actions が GitHub Pages へ自動デプロイ。初回のみ Settings → Pages → Source: GitHub Actions の有効化が必要。'
      ;;
  esac
  sed \
    -e "s|__PROJECT_NAME__|${PROJECT_NAME}|g" \
    -e "s|__BOOK_TITLE_JA__|${BOOK_TITLE_JA}|g" \
    -e "s|__DEPLOY_URL__|${DEPLOY_URL}|g" \
    -e "s|__DEPLOY_ACCESS_NOTE__|${DEPLOY_ACCESS_NOTE}|g" \
    -e "s|__DEPLOY_INSTRUCTIONS_BLOCK__|${DEPLOY_INSTRUCTIONS_BLOCK}|g" \
    "$ASSETS_DIR/readme-md.template" > README.md
  echo "  wrote: README.md (deploy section: $DEPLOY_TARGET → $DEPLOY_URL)"
else
  echo "  skip (exists): README.md (use scripts/lib/update-readme-deploy-section.sh to refresh deploy URL)"
fi

# === scripts は skill 本体からそのままコピー ===
for s in extract-epub.mjs gen-tickets.mjs claim-next-ticket.sh fix-internal-links.mjs inject-anchors.mjs check-links.mjs; do
  if [[ -e "scripts/$s" ]]; then
    echo "  skip (exists): scripts/$s"
  else
    cp "$SCRIPTS_DIR/$s" "scripts/$s"
    chmod +x "scripts/$s"
    echo "  wrote: scripts/$s"
  fi
done

# === lib/ 内の共有モジュール ===
for s in filename-map.mjs; do
  if [[ -e "scripts/lib/$s" ]]; then
    echo "  skip (exists): scripts/lib/$s"
  else
    cp "$SCRIPTS_DIR/lib/$s" "scripts/lib/$s"
    echo "  wrote: scripts/lib/$s"
  fi
done

echo
echo "Agent instruction files:"
echo "  - AGENTS.md  (canonical, read by Codex / Cursor / Copilot / Gemini / OpenCode 等)"
echo "  - CLAUDE.md  (thin wrapper that imports AGENTS.md via @./AGENTS.md, plus Claude Code-specific notes)"
echo
echo "Done. Next steps:"
echo "  1. Drop your EPUB at docs/$EPUB_FILENAME"
echo "  2. npm install  (vitepress)"
echo "  3. Edit scripts/lib/filename-map.mjs (xhtml stem -> MD filename mapping)"
echo "     and scripts/extract-epub.mjs CONFIG (epubFilename, parser etc.)"
echo "     See: $SKILL_DIR/references/extract-epub-customization.md"
echo "  4. node scripts/extract-epub.mjs --dry-run"
echo "  5. node scripts/extract-epub.mjs"
echo "  6. Edit scripts/gen-tickets.mjs CONFIG (chapterTitleJa, specialTitleJa, prioritizeP1, proofPhase)"
echo "  7. bd init && node scripts/gen-tickets.mjs --dry-run"
echo "  8. node scripts/gen-tickets.mjs"
echo "  9. (Skill orchestration takes over from here: bd ready loop with translation/proof subagents)"
echo

if [[ "$DEPLOY_TARGET" == "cloudflare" ]]; then
  cat <<EOM
Cloudflare Pages selected. To finish deployment setup:
  a. cp .env.local.example .env.local
  b. Edit .env.local: fill in CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
     BASIC_AUTH_USER, BASIC_AUTH_PASS
  c. bash $SKILL_DIR/scripts/init-cloudflare-deployment.sh

⚠️  Bookmark this URL — it is randomized and unguessable:
    $DEPLOY_URL

Details: $SKILL_DIR/references/deploy-cloudflare.md
EOM
fi

echo
echo "After translation phase:"
echo "  - node scripts/fix-internal-links.mjs    # Convert remaining xhtml refs in docs/ja"
echo "  - node scripts/inject-anchors.mjs        # Backfill anchor ids missed by extract"
echo "  - node scripts/check-links.mjs           # Validate all internal links (must pass before deploy)"
