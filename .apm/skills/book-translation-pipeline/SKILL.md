---
name: book-translation-pipeline
description: |
  Orchestrates EPUB→Japanese book translation projects: 5-phase pipeline
  (setup, proof:epub-en, translation, proof:en-ja, final) producing
  bilingual VitePress sites with beads-managed tickets and separate
  subagents for translation/proofreading. Beads state persists across
  sessions and rate limits. INVOKE IMMEDIATELY without clarifying
  questions when user mentions ANY of: translating an EPUB / 技術書を翻訳
  / 翻訳したい / 日本語に訳す, translation project / 翻訳プロジェクト /
  翻訳サイト, docs/en + docs/ja / 日本語訳サイト, proof:epub-en /
  proof:en-ja / 校正チケット / 再校正バッチ, extract-epub.mjs /
  gen-tickets.mjs / 翻訳チケット, 翻訳続き / 翻訳再開 / 翻訳作業の続き /
  bd ready 再開 / rate limit 復帰, 翻訳と校正を別エージェント /
  確認バイアス, any book series (DMRB, etc.). The skill handles
  clarification — do NOT ask for details first.
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

詳細: `references/workflow-phases.md`

## When to invoke

- 新規翻訳プロジェクトを `~/oss/<project>/` に立ち上げる
- 既存 EPUB から日英並置 VitePress サイトを構築する
- proof:epub-en / proof:en-ja の 8 項目チェックリストを参照する
- extract-epub.mjs / gen-tickets.mjs を新書籍向けにカスタマイズする
- extract-epub.mjs 改修後の再校正バッチを起票する (`references/reproof-pattern.md`)
- 中断したセッションから `bd ready` で復帰する

## 設計上の不変条件

**`NN_` プレフィックスは EPUB の spine 順を反映する**:

```
EPUB spine 順 == FILENAME_MAP の値の NN 順 == docs/en/ ASCII ソート順 == docs/ja/ ASCII ソート順
```

これで `ls docs/en/` と `ls docs/ja/` が同一行番号で 1 対 1 対応する。詳細: `references/filename-conventions.md`。

## Deploy target selection

このスキルは **GitHub Pages（公開）** と **Cloudflare Pages + Basic 認証（関係者限定）** の 2 通りのデプロイ先をサポートする。`init-project.sh` 実行時に次の優先順で確定する:

| 優先順 | 入力 | 動作 |
|---|---|---|
| 1 | `--deploy-target=cloudflare` または `--deploy-target=github` | 明示指定をそのまま使う |
| 2 | 環境変数 `DEPLOY_TARGET` | 同上 |
| 3 | `gh repo view --json visibility` で自動判定 | `PRIVATE` → cloudflare、`PUBLIC` → github |
| 4 | tty があれば対話プロンプト | `1) cloudflare  2) github` |
| 5 | tty なし & 上記すべて不能 | exit 1（エラー終了） |

### orchestrator（メイン Claude）の振る舞い

ユーザー入力に**デプロイ先の指示**が含まれていれば、それを `--deploy-target=...` に翻訳して `init-project.sh` に渡す:

| ユーザー入力に含まれる語 | 解釈 |
|---|---|
| 「Cloudflare」「Cloudflare Pages」「Basic 認証で」「内部限定で」「ドラフトで」「関係者だけに」「private で公開」 | `--deploy-target=cloudflare` |
| 「GitHub Pages で」「公開で」「世界に公開」「OSS として」「オープンに」 | `--deploy-target=github` |

明示なしの場合: `gh repo view --json visibility` で確認。判定不能（リポジトリ未 push、`gh` 未ログイン、API エラー）なら **`AskUserQuestion` で人間に確認**してから `init-project.sh` を呼ぶ。**Claude Code の Bash ツールは tty を持たないため、対話 read プロンプトに到達させてはならない**（ハングする）。

### Cloudflare 選択時の追加要件

1. ユーザーは Cloudflare アカウントを所有
2. `.env.local`（`init-project.sh` が `.env.local.example` を配置するのでコピーして埋める）に:
   - `CLOUDFLARE_API_TOKEN`（`Pages > Edit` 必須、`User Details > Read` 推奨）
   - `CLOUDFLARE_ACCOUNT_ID`
   - `BASIC_AUTH_USER` / `BASIC_AUTH_PASS`
3. `bash $SKILL_DIR/scripts/init-cloudflare-deployment.sh` を 1 回実行
   - wrangler の追加 / プロジェクト作成 / secret 登録 / 初回デプロイ / GitHub Secrets 登録 / README 更新までを CLI で完結
4. 配信 URL は `https://<RANDOM_16_CHARS>.pages.dev/`（**プロジェクト名はランダム生成**で URL 推測困難化）

### Cloudflare プロジェクト名のランダム化

リポジトリ名そのままを使うと `<repo>.pages.dev` という推測しやすい URL になり、Basic 認証ダイアログまで誰でも到達する。それを避けるため `init-project.sh` は **デフォルトで 16 文字のランダム英数字**（先頭は英字保証）を Cloudflare プロジェクト名にする。`wrangler.toml` の `name` と `cloudflare-pages.yml` の `--project-name=` に同じ値が書き込まれる。

明示したい場合は `--cloudflare-project-name=<name>` で上書き可能。

**前提**: Cloudflare デプロイは private リポジトリ運用が前提。public リポジトリだと `wrangler.toml` を誰でも読めてしまうので URL ランダム化が無意味になる。完全な隠蔽が要件なら **Cloudflare Access** に切替（独自ドメイン + Access ポリシー、`functions/_middleware.ts` 削除のみで移行可能、`references/deploy-cloudflare.md` 参照）。

### 既存プロジェクトの移行

既に GitHub Pages で運用中のプロジェクトを Cloudflare Pages + Basic 認証へ切り替えたいときは:

```bash
bash $SKILL_DIR/scripts/migrate-to-cloudflare.sh
# 案内に従って .env.local を作成し、値を埋めてから:
bash $SKILL_DIR/scripts/migrate-to-cloudflare.sh --continue
```

migrate スクリプトが旧 `.github/workflows/deploy.yml` 削除・`base:` 行削除・Cloudflare 系ファイル配置・初回デプロイ・GitHub Secrets 登録・GitHub Pages 停止・`gh-pages` ブランチ削除・README の URL 更新までを一気通貫で行う。最後にコミット内容を表示するので、ユーザーが内容を確認して `git commit && git push` する。

## Step-by-step

### 初回 (新規プロジェクト)

1. **プロジェクト初期化**
   ```bash
   mkdir -p ~/oss/<project> && cd ~/oss/<project>
   gh repo create --private --source=.   # private なら Cloudflare、public なら GitHub Pages を自動選択
   ~/.claude/skills/book-translation-pipeline/scripts/init-project.sh \
       <PROJECT_NAME> <epub-filename>.epub "<BOOK_TITLE_JA>" \
       [--deploy-target=cloudflare|github] [--cloudflare-project-name=<name>]
   ```
   配置されるファイル（共通）: `README.md` / `package.json` / `.gitignore` / `CLAUDE.md` / `docs/.vitepress/config.mts` / `docs/.vitepress/theme/{custom.css,index.ts}` / `docs/index.md` / `docs/ja/index.md` / `scripts/{extract-epub.mjs,gen-tickets.mjs,claim-next-ticket.sh}`

   デプロイ先別:
   - **GitHub Pages**: `.github/workflows/deploy.yml`（既存どおり）
   - **Cloudflare Pages**: `.github/workflows/cloudflare-pages.yml` / `functions/_middleware.ts` / `wrangler.toml` / `.env.local.example`、加えて `vitepress-config.mts` の `base:` 行は自動削除（ルート配信のため）

   詳細は **「Deploy target selection」章**（下）と `references/deploy-{cloudflare,github-pages}.md`。

2. **EPUB 配置と依存インストール**
   ```bash
   cp /path/to/book.epub docs/<epub-filename>.epub
   npm install
   ```

   `init-project.sh` が配置する `.github/workflows/*.yml` は **`branches: [main, master]` 両対応**で生成されるため、リポジトリのデフォルトブランチが `main` でも `master` でも追加設定なくデプロイされる。

   - **GitHub Pages 選択時**: `vitepress-config.mts` の `base: '/<repo-name>/'` がリポジトリ名で置換済みなので、`Settings → Pages → Source: GitHub Actions` を 1 度有効化すれば push 経由で自動公開される。詳細は `references/deploy-github-pages.md`
   - **Cloudflare Pages 選択時**: 別途 `.env.local` を埋めて `bash $SKILL_DIR/scripts/init-cloudflare-deployment.sh` を 1 回実行する必要がある（API Token・Account ID・Basic 認証 ID/PW を設定し、初回デプロイと GitHub Secrets 登録を行う）。詳細は `references/deploy-cloudflare.md`

3. **extract-epub.mjs CONFIG 編集** (`references/extract-epub-customization.md` 参照)
   - `epubFilename`, `opfPath`, `filenameMap`, `parser.*` を埋める
   - `node scripts/extract-epub.mjs --dry-run` で検証
   - `node scripts/extract-epub.mjs` で本番実行

4. **用語集・スタイルガイド作成** (Setup s2/s3 — orchestrator 自身が担当)
   - `docs/ja/_glossary.md`: `references/glossary-template.md` を参照して書籍ジャンル別用語をまとめる
   - `docs/ja/_styleguide.md`: `references/styleguide-template.md` をコピー・調整

5. **gen-tickets.mjs CONFIG 編集** (`references/gen-tickets-customization.md` 参照)
   - `chapterTitleJa`, `specialTitleJa`, `prioritizeP1`, `proofPhase` を埋める
   - `bd init` (まだなら)
   - `node scripts/gen-tickets.mjs --dry-run` で確認
   - `node scripts/gen-tickets.mjs` で本番起票

6. **オーケストレーションループ突入** (下記)

### オーケストレーションループ (毎セッション、再開時もここから)

```
loop:
  ticket_json = $(./scripts/claim-next-ticket.sh)
  ticket_id = $(echo $ticket_json | jq -r '.id')
  if ticket_id is empty: break  # 全完了 or 全 blocked

  labels = $(echo $ticket_json | jq -r '.labels[]')

  switch labels:
    contains 'translation' AND NOT 'proof:*':
      Agent(subagent_type="general-purpose",
            prompt=read("agents/translation-agent.md")
                   .replace('__TICKET_ID__', ticket_id)
                   .replace('__FILE__', ticket.file)
                   .replace('__TITLE_JA__', ticket.title_ja)
                   .replace('__EPUB_FILENAME__', config.epubFilename))
    contains 'proof:epub-en':
      Agent(subagent_type="general-purpose",
            prompt=read("agents/proof-epub-en-agent.md").replace(...))
    contains 'proof:en-ja':
      Agent(subagent_type="general-purpose",
            prompt=read("agents/proof-en-ja-agent.md").replace(...))
    contains 'setup' or 'final':
      # orchestrator (=メインエージェント) 自身が処理
      handle_inline(ticket)

  # subagent が bd close を実行する。失敗時は in_progress のまま残る
  # 同一章の translation と proof:en-ja を同時に subagent spawn しない (ファイル書き込み race を防ぐ)
  # subagent 戻り後に `bd show <id> --json | jq -r .status` で確認、closed でなければインラインで close
```

メインエージェントとしての行動:

- 各イテレーションで `claim-next-ticket.sh` を呼び、claim 済みチケットの JSON を取得
- ラベルから種別を判定し、`Agent` tool で対応する subagent を spawn
- subagent の戻り値 (200 字サマリ) を確認し、次のイテレーションへ
- ループ中 `bd dolt push && git push` でリモート同期 (10 チケットに 1 度程度)

### 中断・再開時

- **中断時**: 進行中の subagent が `bd update <id> --status in_progress` で残す。`bd dolt push && git push` でリモート同期
- **再開時 (別セッション)**: `bd dolt pull` → skill が再 triggers → オーケストレーションループに戻る
- bd の状態 = 真実のソース。orchestrator は前セッションのコンテキストを引き継がず、`bd ready` で次の作業を機械的に取得

### Setup フェーズの細部

- **s1** (ディレクトリ準備): `init-project.sh` 出力を確認するだけ
- **s2** (用語集): orchestrator が `references/glossary-template.md` を参考に書籍ジャンル別用語を集めて `docs/ja/_glossary.md` を作成。書籍特有の用語を最低 30 件以上、章タイトル一覧を含める
- **s3** (スタイルガイド): orchestrator が `references/styleguide-template.md` をコピーして書籍に合わせて調整
- **s4** (品質確認): orchestrator が **Translation Agent を 1 度 spawn** して `_sample.md` を生成。8 観点 (proof:en-ja-checklist) でセルフ評価し、Go なら次へ

#### s2 / s3 を自走するか、人間レビューを挟むか

「自動進行で任せたい」と明示された場合は **s2/s3 を orchestrator が自走** で書く。ただし以下のいずれかに該当する場合は、s2/s3 完了後に **ユーザーレビューを 1 回挟むこと** を推奨し、judgement を求める:

- 書籍が**特殊なドメイン** (法律・医学・芸術・文化人類学など、訳語選択が訳文全体の品質を左右するもの)
- 同じシリーズの**先行翻訳プロジェクト** (`Vol1→Vol2` のような) が無く、用語の前例がない
- 書籍が**長大** (章数 30+ または 1 章あたり 20 ページ超)、用語ぶれが後半まで波及してリカバリが高コストになる
- ユーザーが「である調以外の文体にしたい」など**特殊なスタイル要求**を最初の対話で示している

該当しない場合 (汎用技術書・前作の用語が継承可能・章数 25 以下) は **自走で問題ない**。`_glossary.md` / `_styleguide.md` の更新は途中で発生しても run-time に追記すれば OK で、初版に完璧を求めなくてよい。

### Final フェーズ

- `npm run build` 成功確認
- 用語一貫性 grep (`docs/ja/_glossary.md` の用語が章で統一されているか)
- である調逸脱チェック: `grep -nE 'です。|ます。' docs/ja/*.md` がゼロ件
- 代表章 (章番号 1, 中央, 最後) を目視確認 — 可能ならユーザーに promo
- VitePress dev server (`npm run dev`) で表示確認
- **内部リンクの整合性チェック** (リンク機能化):
  ```bash
  node scripts/fix-internal-links.mjs   # docs/ja の xhtml ref を相対 MD に
  node scripts/inject-anchors.mjs       # 漏れた figure / table / heading / sidebar id を補完
  node scripts/check-links.mjs          # 死リンクゼロを確認 (errors=0 必須)
  ```
  ローカル dev (`npm run dev`) で章間ジャンプ・図表アンカー・脚注・sidebar を 10 件以上抜き打ちクリック確認

## 翻訳規約 (要約)

- 文体: **である調** (です・ます禁止)
- 用語: `docs/ja/_glossary.md` 準拠
- Markdown 構造: 見出しレベル・リスト・表を保持
- コードブロック・SQL・テーブル名・書名・著者名: 原文維持
- 画像参照 `./images/` はそのまま (alt は訳す)
- 図表参照: 「図N.N」「表N.N」「第N章」「付録N」で統一
- **内部リンク (xref / figure / table / section / sidebar / 脚注)**:
  - `xxx.xhtml#anchor` 形式の EPUB 内部参照は `extract-epub.mjs` が自動で `./<NN_slug>.md#anchor` に変換 (内部 `transformHref`)
  - 図表アンカーは `<a id="..."></a>` (figure / table 直前) または見出しの `{#id}` で定義
  - 脚注本文側 `<sup>` は `<sup><a id="X-marker"></a>[N](./Y.md#X)</sup>` 形式
  - table caption は `*Table N-N. ...*` をテーブル直前にイタリック斜体で出力
  - callout `(N)` の脚注リスト側に `<a id="callout_..."></a>` を保持
  - 既存プロジェクトの後追い修正: `node scripts/fix-internal-links.mjs && node scripts/inject-anchors.mjs`
  - リンク機能検証: `node scripts/check-links.mjs` (Final フェーズで必須、errors=0)

詳細: `docs/ja/_styleguide.md` (プロジェクト固有) または `references/styleguide-template.md` (skill テンプレート)

## エージェント分離 (核心設計)

**翻訳と校正は同じ Claude プロセスのコンテキストで処理してはいけない**:

- Translation Agent は「自分が選んだ訳語」「自分の訳文構造」に対して**確認バイアス**を持つため、自分の訳を客観的に校正できない
- 校正は「読んでいない訳文を初見で見て、原文との齟齬を発見する」作業であり、コンテキスト分離が品質の前提条件

skill では各タスクごとに `Agent` tool で `subagent_type="general-purpose"` を呼び、`agents/<role>-agent.md` の prompt template をそのまま渡す:

| Agent 種別 | prompt template | 担当 |
|---|---|---|
| Translation | `agents/translation-agent.md` | translation ラベルのチケット |
| Proof-EPUB-EN | `agents/proof-epub-en-agent.md` | proof:epub-en ラベル |
| Proof-EN-JA | `agents/proof-en-ja-agent.md` | proof:en-ja ラベル (translation とは別 subagent で起動) |

prompt 内のプレースホルダ (`__TICKET_ID__`, `__FILE__`, `__TITLE_JA__`, `__EPUB_FILENAME__`) は orchestrator が埋める。

## bd 連携

プロジェクトの CLAUDE.md に bd 統合ブロックが含まれる場合、TodoWrite / TaskCreate ではなく **`bd` を使う**:

```bash
bd ready              # 次の作業可能チケット
bd show <id>          # チケット詳細
bd update <id> --claim  # 取得
bd note <id> "..."    # メモ追加
bd close <id> --reason "..."  # 完了
bd dolt push          # リモート同期
bd dolt pull          # 同期取得
```

orchestrator は `scripts/claim-next-ticket.sh` を使うと race condition なく安全に取得できる。

## Detailed references

- 5 フェーズの依存関係と作業詳細 → `references/workflow-phases.md`
- 抽出 MD 構造校正の 8 項目 → `references/proof-epub-en-checklist.md`
- 訳文校正の 8 項目 → `references/proof-en-ja-checklist.md`
- ファイル名規則と不変条件 → `references/filename-conventions.md`
- extract-epub.mjs CONFIG 埋め方 → `references/extract-epub-customization.md`
- EPUB 構造バリエーション (出版社別の anchor 抽出パターン) → `references/epub-variations.md`
- gen-tickets.mjs CONFIG 埋め方 → `references/gen-tickets-customization.md`
- 用語集テンプレート → `references/glossary-template.md`
- スタイルガイドテンプレート → `references/styleguide-template.md`
- 再校正パターン (extract-epub 改修後) → `references/reproof-pattern.md`
- **Cloudflare Pages デプロイ詳細** → `references/deploy-cloudflare.md`
- **GitHub Pages デプロイ詳細** → `references/deploy-github-pages.md`

## Bundled scripts と agents

- `scripts/extract-epub.mjs` — CONFIG 化リファクタ済の EPUB→Markdown 抽出
- `scripts/gen-tickets.mjs` — CONFIG 化リファクタ済の beads チケット生成
- `scripts/init-project.sh` — 新規プロジェクト初期化 (assets を雛形コピー+置換、デプロイ先選択対応)
- `scripts/init-cloudflare-deployment.sh` — Cloudflare Pages 選択時の初回デプロイ + GitHub Secrets 登録
- `scripts/migrate-to-cloudflare.sh` — 既存 GitHub Pages 構成を Cloudflare Pages + Basic 認証へ切替
- `scripts/lib/place-cloudflare-assets.sh` — Cloudflare 系テンプレ配置の共通関数
- `scripts/lib/update-readme-deploy-section.sh` — README の `## 公開先` セクションを冪等更新
- `scripts/claim-next-ticket.sh` — bd ready 安全取得
- `agents/translation-agent.md` — Translation Agent の prompt template
- `agents/proof-epub-en-agent.md` — Proof-EPUB-EN Agent の prompt template
- `agents/proof-en-ja-agent.md` — Proof-EN-JA Agent の prompt template

## proofPhase の選び方 (一般指針)

| ケース | 推奨 `proofPhase` | 理由 |
|---|---|---|
| 商用書籍をしっかり仕上げたい | `'full'` | proof:epub-en (構造校正) + proof:en-ja (訳文校正) を全章に適用 |
| 個人用・社内資料・ドラフト品質で十分 | `'epub-only'` | 抽出 MD の構造のみ確認、訳文校正は手動で代替 |
| 短い記事・ブログ翻訳 | `'none'` | proof フェーズなし、translation 一発 |

`gen-tickets.mjs` の `CONFIG.proofPhase` で切り替え可能 (詳細は `references/gen-tickets-customization.md`)。

## skill の独立性

この skill は**自己完結**している。`scripts/`, `references/`, `assets/`, `agents/` のすべての作業に必要なコンテンツが skill ディレクトリ内に揃っているため、ユーザーの環境に過去の翻訳プロジェクトが**存在しなくても動作する**。SKILL.md 内に出てくる書籍タイトルや既存プロジェクト名は、ユーザーが「同種のプロジェクト経験を想起する」ためのキーワードに過ぎず、skill 動作の前提ではない。
