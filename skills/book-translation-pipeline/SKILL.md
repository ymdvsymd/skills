---
name: book-translation-pipeline
description: >-
  Orchestrate EPUB→Japanese book translation as a 5-phase pipeline (setup, proof:epub-en, translation, proof:en-ja, final) producing bilingual VitePress sites with beads-managed tickets.
  「EPUBを翻訳」「技術書を翻訳」「翻訳プロジェクト」「proof:epub-en」「proof:en-ja」「翻訳続き/再開」「bd ready 復帰」「DMRB」のような依頼で即発動する。
  USE FOR: 書籍翻訳プロジェクト初期化、5 フェーズ進行、beads チケット運用、rate limit 復帰後の続行、翻訳と校正を別 subagent で実行。
  DO NOT USE FOR: 短文・UI 文言・コードコメント翻訳、PDF 直接翻訳、機械翻訳の事後修正のみ。
  INVOKES: beads tickets, translation/proofreading subagents, extract-epub.mjs, gen-tickets.mjs.
---

# Book Translation Pipeline (EPUB → 日本語訳 VitePress)

英語版 EPUB を docs/en/ に抽出し、docs/ja/ に日本語訳を作って VitePress で日英並置サイトを構築する **5 フェーズワークフロー**を、beads チケットで永続化しながらオーケストレーションする skill。

## 5 フェーズと依存関係

```
            +---------+
            |  Setup  |  s1 -> s2 -> s3 -> s4 (直列)
            +----+----+
                 |
       +---------+---------+
       |                   |
       v                   v
+---------------+   +-------------+
| Translation   |   | Proof:      |   <- Setup と独立に並列実行可
| (各章 1 件)    |   |  EPUB-EN    |
+-------+-------+   +-------------+
        |
        v
+---------------+
| Proof: EN-JA  |   <- 対応 Translation 完了後 (別 subagent)
| (各章 1 件)    |
+-------+-------+
        |
        +---> Final (全 Translation + 全 Proof:EN-JA 完了後)
```

詳細: [references/pipeline-customization.md](references/pipeline-customization.md) の Workflow phases セクション

## When to invoke

- 新規翻訳プロジェクトを `~/oss/<project>/` に立ち上げる
- 既存 EPUB から日英並置 VitePress サイトを構築する
- proof:epub-en (11 項目) / proof:en-ja (12 項目) チェックリストを参照する
- extract-epub.mjs / gen-tickets.mjs を新書籍向けにカスタマイズする
- extract-epub.mjs 改修後の再校正バッチを起票する ([references/proof-checklists.md](references/proof-checklists.md) の reproof セクション)
- 中断したセッションから `bd ready` で復帰する

## 設計上の不変条件

**`NN_` プレフィックスは EPUB の spine 順を反映する**:

```
EPUB spine 順 == FILENAME_MAP の値の NN 順 == docs/en/ ASCII ソート順 == docs/ja/ ASCII ソート順
```

これで `ls docs/en/` と `ls docs/ja/` が同一行番号で 1 対 1 対応する。詳細: [references/templates.md](references/templates.md) の Filename Conventions。

## Deploy target selection

サポートするデプロイ先は **GitHub Pages（公開）** と **Cloudflare Pages + Basic 認証（関係者限定）** の 2 通り。

**`init-project.sh` での確定優先順**: (1) `--deploy-target=cloudflare|github` 明示 → (2) 環境変数 `DEPLOY_TARGET` → (3) `gh repo view --json visibility` で自動判定 (PRIVATE→cloudflare, PUBLIC→github) → (4) tty 対話 → (5) tty 無しで判定不能なら exit 1。

**orchestrator の振る舞い**: ユーザー入力の語彙を `--deploy-target=...` に翻訳する (「Cloudflare/Basic 認証/関係者限定/private」→ cloudflare、「GitHub Pages/公開/OSS」→ github)。明示なし & 自動判定不能なら **人間に確認** (agent CLI の Bash は tty を持たないことが多い)。

**Cloudflare 選択時**: `.env.local` に `CLOUDFLARE_API_TOKEN` (`Pages > Edit`) / `CLOUDFLARE_ACCOUNT_ID` / `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` を入れ `bash $SKILL_DIR/scripts/init-cloudflare-deployment.sh` を 1 回実行。配信 URL は `https://<RANDOM_16_CHARS>.pages.dev/` (`--cloudflare-project-name=<name>` で上書き可)。**private リポジトリ運用**前提。完全な隠蔽が要件なら **Cloudflare Access** に切替 (`functions/_middleware.ts` 削除のみ)。**既存 GitHub Pages → 移行**は `bash $SKILL_DIR/scripts/migrate-to-cloudflare.sh` → `.env.local` 編集 → `--continue` で一気通貫 (詳細は下記 references)。

詳細は [references/pipeline-customization.md](references/pipeline-customization.md) の Deploy セクション。

## Step-by-step

### 初回 (新規プロジェクト)

1. **プロジェクト初期化**
   ```bash
   mkdir -p ~/oss/<project> && cd ~/oss/<project>
   gh repo create --private --source=.   # PRIVATE→Cloudflare、PUBLIC→GitHub Pages 自動選択
   "$SKILL_DIR/scripts/init-project.sh" \
       <PROJECT_NAME> <epub-filename>.epub "<BOOK_TITLE_JA>" \
       [--deploy-target=cloudflare|github] [--cloudflare-project-name=<name>]
   ```

   `$SKILL_DIR` は agent ごとに異なる (Claude Code `~/.claude/skills/`、Codex / cross-client `~/.agents/skills/`)。配置物: `README.md` / `package.json` / `AGENTS.md` (canonical) + `CLAUDE.md` import / `docs/.vitepress/` / `docs/{index.md,ja/index.md}` / `scripts/*` (下記 Bundled scripts)、デプロイ先別 workflow と Cloudflare 系ファイル (`vitepress-config.mts` の `base:` は Cloudflare 時自動削除)。

2. **EPUB 配置と依存インストール**: `cp /path/to/book.epub docs/<epub>.epub && npm install`。`.github/workflows/*.yml` は `branches: [main, master]` 対応。GitHub Pages なら `Settings → Pages → Source: GitHub Actions` 有効化のみ、Cloudflare なら `.env.local` 編集 + `bash $SKILL_DIR/scripts/init-cloudflare-deployment.sh` を 1 回実行。

3. **extract-epub.mjs CONFIG 編集** ([references/pipeline-customization.md](references/pipeline-customization.md) の extract-epub CONFIG セクション参照)
   - `epubFilename`, `opfPath`, `filenameMap`, `parser.*` を埋める
   - `node scripts/extract-epub.mjs --dry-run` で検証 → 引数なしで本番実行

4. **用語集・スタイルガイド作成** (Setup s2/s3 — orchestrator 自身が担当)
   - `docs/ja/_glossary.md`: [references/templates.md](references/templates.md) の Glossary Template を参照して書籍ジャンル別用語をまとめる
   - `docs/ja/_styleguide.md`: [references/templates.md](references/templates.md) の Styleguide Template をコピー・調整

5. **gen-tickets.mjs CONFIG 編集** ([references/pipeline-customization.md](references/pipeline-customization.md) の gen-tickets CONFIG セクション参照)
   - `chapterTitleJa`, `specialTitleJa`, `prioritizeP1`, `proofPhase` を埋める
   - `bd init` (まだなら) → `node scripts/gen-tickets.mjs --dry-run` で確認 → 引数なしで本番起票

6. **オーケストレーションループ突入** (下記)

### オーケストレーションループ (毎セッション、再開時もここから)

```
loop:
  ticket = $(./scripts/claim-next-ticket.sh)        # claim 済み JSON
  if ticket is empty: break                          # 全完了 / 全 blocked

  labels = ticket.labels
  switch:
    'translation' (NOT 'proof:*')  → run_role(agents/translation-agent.md)
    'proof:epub-en'                → run_role(agents/proof-epub-en-agent.md)
    'proof:en-ja'                  → run_role(agents/proof-en-ja-agent.md)   # 別 context 必須
    'setup' or 'final'             → orchestrator が inline で処理

  # run_role: prompt template に __TICKET_ID__ / __FILE__ / __TITLE_JA__ /
  # __EPUB_FILENAME__ を埋めて担当 agent に渡す。Claude Code は `Agent` で spawn、
  # Codex 等は inline 実行 (proof:en-ja のみ新規セッションで context 分離)
  # 実行後 `bd close` は role agent が行う。failed なら in_progress 残置
  # 同一章の translation と proof:en-ja は同時起動禁止 (write race)
```

メインエージェントは各イテレーションで上を回し、subagent の 200 字サマリを確認して進める。`bd dolt push && git push` は 10 チケット程度に 1 回。

### 中断・再開時

- **中断時**: 進行中の subagent が `bd update <id> --status in_progress` で残す。`bd dolt push && git push` でリモート同期。コミット前に `bd export` (または `bd dolt push`) を走らせて `.beads/issues.jsonl` を確定させてから `git add && git commit` する。export がコミット後にずれると beads 状態が stranded する
- **再開時 (別セッション)**: `bd dolt pull` → skill が再 triggers → オーケストレーションループに戻る
- bd の状態 = 真実のソース。orchestrator は前セッションのコンテキストを引き継がず、`bd ready` で次の作業を機械的に取得

### Setup フェーズの細部

- **s1** (ディレクトリ準備): `init-project.sh` 出力を確認するだけ
- **s2** (用語集): orchestrator が [references/templates.md](references/templates.md) の Glossary を参考に書籍ジャンル別用語を集めて `docs/ja/_glossary.md` を作成。書籍特有の用語を最低 30 件以上、章タイトル一覧を含める
- **s3** (スタイルガイド): orchestrator が [references/templates.md](references/templates.md) の Styleguide をコピーして書籍に合わせて調整
- **s4** (品質確認): orchestrator が **Translation Agent を 1 度 spawn** して `_sample.md` を生成。8 観点 (proof:en-ja-checklist) でセルフ評価し、Go なら次へ

#### s2 / s3 を自走するか、人間レビューを挟むか

「自動進行で任せたい」と明示されれば **s2/s3 を orchestrator が自走**。ただし以下に該当すれば s2/s3 完了後に **ユーザーレビューを 1 回挟む**: (a) 特殊ドメイン (法律・医学・芸術等)、(b) 用語の前例なし、(c) 長大書籍 (章数 30+)、(d) である調以外の特殊スタイル要求。

該当しなければ (汎用技術書・用語継承可能・章数 25 以下) **自走で問題ない**。`_glossary.md` / `_styleguide.md` は run-time 追記で OK、初版に完璧を求めなくてよい。

### Final フェーズ

- `npm run build` 成功確認
- 用語一貫性 grep (`docs/ja/_glossary.md` の用語が章で統一されているか)
- である調逸脱チェック: `grep -nE 'です。|ます。' docs/ja/*.md` がゼロ件
- 代表章 (1 / 中央 / 最後) を目視確認、`npm run dev` で表示確認
- **内部リンク整合性**: `fix-internal-links.mjs` (xhtml→相対 MD) → `inject-anchors.mjs` (アンカー補完) → `check-links.mjs` (errors=0 必須)。dev で章間ジャンプ / 図表 / 脚注 / sidebar を 10 件以上抜き打ちクリック
- **構造パリティ**: `node scripts/check-structure-parity.mjs` (全 en/ja ペア) で hard mismatch ゼロ (サイドバー個数・コードフェンス数・見出しレベル整合、見出し隣接 `---`=C10 ゼロ)。warn (MD009/MD028/番号リスト/Recap小見出し) は 1 件ずつ確認

## 翻訳規約 (要約)

- 文体: **である調** (です・ます禁止)。用語は `docs/ja/_glossary.md` 準拠
- Markdown 構造・コードブロック・SQL・テーブル名・書名・著者名・`./images/` 参照は原文維持 (画像 alt は訳す)
- **見出しに隣接した `---` を置かない**: VitePress の `<h2>` は `border-top` を持ち、隣接 `---` と線が二重になる。区切りは見出しに任せる。`check-structure-parity.mjs` の C10 (hard) が章・補助ファイル・index.md 横断で検出
- 図表参照は「図N.N」「表N.N」「第N章」「付録N」で統一
- 内部リンク: `xxx.xhtml#anchor` → `./<NN_slug>.md#anchor` は `extract-epub.mjs` が自動変換。図表アンカー / 脚注 / callout の詳細は [references/templates.md](references/templates.md) の Styleguide を参照
- 後追い修正: `node scripts/fix-internal-links.mjs && node scripts/inject-anchors.mjs`。Final で `node scripts/check-links.mjs` (errors=0 必須)

詳細: プロジェクト固有の `docs/ja/_styleguide.md` か skill テンプレートの [references/templates.md](references/templates.md) を参照。

## エージェント分離 (核心設計)

**翻訳と校正は同じ context で処理してはいけない** (agent 種別を問わず)。Translation Agent は自分の訳語・訳文構造に **確認バイアス** を持つため客観的に校正できない。校正は「未読の訳文を初見で原文と突き合わせる」作業であり、context 分離が品質の前提。

prompt template と担当ラベル:

| prompt template | ラベル |
|---|---|
| `agents/translation-agent.md` | translation |
| `agents/proof-epub-en-agent.md` | proof:epub-en |
| `agents/proof-en-ja-agent.md` | proof:en-ja (translation とは別 subagent / 別セッションで起動) |

Claude Code は `Agent` tool で spawn (自動 context 分離)、Codex 等は inline 実行で `proof:en-ja` のみ新規 CLI セッション。プレースホルダは orchestrator が埋める。

proof:en-ja agent を spawn する際は、完了条件に `node scripts/check-structure-parity.mjs <file>` の hard mismatch ゼロを必須とする (生成チケット本文にも記載済み)。

## bd 連携

プロジェクトの `AGENTS.md` (Claude Code は import 経由) に bd 統合ブロックがあれば、ad-hoc TODO ではなく **`bd` を使う**: `bd ready` / `bd show <id>` / `bd update <id> --claim` / `bd note` / `bd close <id> --reason` / `bd dolt {push,pull}`。orchestrator は `scripts/claim-next-ticket.sh` を使うと race-free に取得できる。

## Detailed references

3 つの reference ファイルにテーマ別に集約:

- [references/pipeline-customization.md](references/pipeline-customization.md) — 5 フェーズ全体像、extract-epub.mjs / gen-tickets.mjs の CONFIG 埋め方、EPUB 出版社別バリエーション、Cloudflare Pages / GitHub Pages 各デプロイ手順
- [references/proof-checklists.md](references/proof-checklists.md) — proof:epub-en (11 項目) / proof:en-ja (12 項目) / extract-epub 改修後の reproof パターン
- [references/templates.md](references/templates.md) — ファイル名規則、用語集テンプレート、スタイルガイドテンプレート

補足: `scripts/check-code-fragments.mjs` (コードフラグメント検出 lint) は抽出/翻訳両方で、`scripts/check-structure-parity.mjs` (en/ja 構造整合) は proof:epub-en (#11) / proof:en-ja (#12) / Final で実行する。

## Bundled scripts と agents

- `scripts/extract-epub.mjs` / `scripts/gen-tickets.mjs` — CONFIG 化された EPUB→MD 抽出 / beads チケット生成
- `scripts/check-structure-parity.mjs` — en/ja 構造パリティ検査 (サイドバー個数 / コードフェンス / 見出しレベル / 見出し隣接 `---`(C10) = hard、markdownlint / 番号リスト / Recap小見出し = warn)
- `scripts/init-project.sh` — 新規プロジェクト初期化 (assets 配置 + デプロイ先選択対応)
- `scripts/init-cloudflare-deployment.sh` / `scripts/migrate-to-cloudflare.sh` — Cloudflare 初回デプロイ / GitHub Pages からの移行
- `scripts/lib/*.sh` — Cloudflare 系テンプレ配置 / README 公開先セクションの冪等更新
- `scripts/claim-next-ticket.sh` — bd ready 安全取得
- `agents/{translation,proof-epub-en,proof-en-ja}-agent.md` — 各 role の prompt template

## proofPhase の選び方 (一般指針)

| ケース | 推奨 `proofPhase` | 理由 |
|---|---|---|
| 商用書籍をしっかり仕上げたい | `'full'` | proof:epub-en (構造校正) + proof:en-ja (訳文校正) を全章に適用 |
| 個人用・社内資料・ドラフト品質で十分 | `'epub-only'` | 抽出 MD の構造のみ確認、訳文校正は手動で代替 |
| 短い記事・ブログ翻訳 | `'none'` | proof フェーズなし、translation 一発 |

`gen-tickets.mjs` の `CONFIG.proofPhase` で切り替え可能 (詳細は [references/pipeline-customization.md](references/pipeline-customization.md) の gen-tickets CONFIG セクション)。

## skill の独立性

この skill は**自己完結**している。`scripts/`, `references/`, `assets/`, `agents/` に必要なコンテンツが揃っており、過去の翻訳プロジェクトが**存在しなくても動作する**。本文中の書籍タイトルや既存プロジェクト名は想起用のキーワードに過ぎず、動作の前提ではない。

## Examples

- **新規プロジェクト立ち上げ** — `## Step-by-step` の「### 初回」
- **中断セッションからの復帰** — `## Step-by-step` の「### 中断・再開時」
- **extract-epub.mjs 改修後の再校正バッチ** — [references/proof-checklists.md](references/proof-checklists.md) の reproof セクション

## Troubleshooting

- **Note:** translation / proof は別 subagent で実行する (確認バイアス回避、詳細は `## エージェント分離`)
- **Important:** rate limit 復帰や長セッション再開での取りこぼしは `bd ready` で再開できる。失敗時の調査は `## Detailed references` を参照
