# Pipeline Customization (extract / gen-tickets / workflow / deploy)

5 phase pipeline 各部のカスタマイズ手順をまとめたリファレンス。

- **Workflow phases**: 5 フェーズの依存関係と作業詳細
- **extract-epub.mjs CONFIG**: EPUB 抽出設定 (出版社別パターンは EPUB Variations を参照)
- **EPUB Variations**: 出版社別 anchor 抽出パターン
- **gen-tickets.mjs CONFIG**: チケット生成設定
- **Deploy: Cloudflare Pages**: private 配信 + Cloudflare Access 移行
- **Deploy: GitHub Pages**: public 配信のシンプル構成

---

# 5 フェーズワークフロー (book-translation-pipeline)

> **agent-agnostic note**: 本書類で「Agent tool で spawn」「subagent」と書いている箇所は **Claude Code 固有の orchestration** を指す。Codex / Cursor / OpenCode 等の単一プロセス agent は、同じ `agents/<role>-agent.md` を inline prompt として読み込み、`proof:en-ja` は新規 CLI セッションで分離して実行する（context 混ざり防止）。

## 依存関係

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
| Proof: EN-JA  |   <- 対応 Translation の完了後
| (各章 1 件)    |
+-------+-------+
        |
        +---> Final (全 Translation + 全 Proof:EN-JA 完了後)
```

## 各フェーズの内訳

### Setup (s1 -> s2 -> s3 -> s4 直列、メインエージェント自身が担当)

| ID | 内容 | 担当 | acceptance |
|---|---|---|---|
| s1 | docs/ja/ ディレクトリ整備、VitePress サイドバー確認 | Orchestrator | docs/ja/index.md 表示、サイドバーに全翻訳ターゲット |
| s2 | docs/ja/_glossary.md 確定 (ジャンル別用語集) | Orchestrator | 主要用語が定義済み、章タイトル日本語訳あり |
| s3 | docs/ja/_styleguide.md 確定 (である調・コードブロック等) | Orchestrator | スタイルガイドが文書化 |
| s4 | _sample.md による翻訳品質確認 | Orchestrator が Translation Agent を 1 度 spawn | _sample.md 8 観点クリア、Go 判定 |

### Translation (各章 1 件、s4 完了が前提)

- **担当**: Translation Agent (`agents/translation-agent.md`) を担当（Claude Code: Agent tool で spawn / 他 agent: inline prompt）
- **依存**: setup s1〜s4 (`setupDeps`)
- **入力**: docs/en/<file>, docs/ja/_glossary.md, docs/ja/_styleguide.md
- **出力**: docs/ja/<file>
- **並列度**: 章ごとに独立、`bd ready` 順で消化

### Proof:EPUB-EN (各章 1 件、Setup と独立に並列実行可)

- **担当**: Proof-EPUB-EN Agent (`agents/proof-epub-en-agent.md`)
- **依存**: なし (setup を待たない、translation も待たない)
- **入力**: docs/en/<file>, docs/<book>.epub の対応 XHTML
- **出力**: docs/en/<file> 修正、必要なら extract-epub.mjs 改修 follow-up チケット
- **並列度**: 章ごとに独立。translation と並走可

### Proof:EN-JA (各章 1 件、対応 Translation 完了が前提)

- **担当**: Proof-EN-JA Agent (`agents/proof-en-ja-agent.md`) を**翻訳とは別 context** で担当（Claude Code: Agent tool で別 subagent として spawn / 他 agent: 別セッションで起動）
- **依存**: 対応する translation チケット (1:1)
- **入力**: docs/en/<file>, docs/ja/<file>, _glossary.md, _styleguide.md
- **出力**: docs/ja/<file> 修正
- **重要**: **Translation Agent とは別プロセスで起動**。確認バイアスを排除する核心設計

### Final (全 translation + 全 proof:en-ja 完了後)

- **担当**: Orchestrator 自身
- **依存**: 全 translation + 全 proof:en-ja
- **作業**:
  1. `npm run build` 成功確認
  2. 全 docs/ja/*.md ファイル存在確認
  3. 画像参照リンク切れチェック
  4. 用語一貫性 grep
  5. である調逸脱チェック (`grep "です。\|ます。" docs/ja/*.md`)
  6. **内部リンクの整合性確認** (リンク機能化):
     ```bash
     node scripts/fix-internal-links.mjs   # docs/ja の xhtml ref 残存があれば修正
     node scripts/inject-anchors.mjs       # extract で漏れた figure/table/heading/sidebar id を補完
     node scripts/check-links.mjs          # 死リンクゼロを確認 (errors=0 必須)
     ```
     - VitePress dev server (`npm run dev`) で章間ジャンプ・図表アンカー・脚注・sidebar を 10 件以上抜き打ちクリック確認
     - 残った死リンクは「ja の table 翻訳不在」「ja の見出し構造が en と不一致」など個別案件として記録 (proof:en-ja の re-pass で対応)
  7. 代表章を目視確認 (ユーザーに promo)

## proofPhase 設定

`scripts/gen-tickets.mjs` の `CONFIG.proofPhase`:

- **`'full'`** (推奨): proof:epub-en + proof:en-ja の両方を生成 — 商用書籍など品質要求が高い場合
- **`'epub-only'`**: proof:epub-en のみ — 抽出 MD の構造校正は走らせるが、訳文校正は手動レビューに委ねる
- **`'none'`**: proof フェーズなし — シンプル翻訳プロジェクト (個人用・社内資料・ドラフト品質)

## オーケストレーションループ (毎セッション)

```
loop:
  ticket = bd ready --json | head -1
  if ticket is None: break

  bd update <ticket.id> --claim

  switch ticket.label:
    'translation'   -> spawn_or_inline(agents/translation-agent.md)
    'proof:epub-en' -> spawn_or_inline(agents/proof-epub-en-agent.md)
    'proof:en-ja'   -> spawn_or_inline(agents/proof-en-ja-agent.md)   # 別 context 必須
    'setup'/'final' -> Orchestrator 自身が処理

  # spawn_or_inline:
  #   Claude Code: Agent(subagent_type="general-purpose", prompt=...)
  #   Codex 等  : 同 prompt を inline で読み込んで実行 (proof:en-ja のみ別セッション推奨)
  # 役割 agent が bd close を実行
  # 失敗時は in_progress のまま残る -> 次回セッションで再 claim
```

## 中断・再開

- bd の状態 = 真実のソース
- 中断時: `bd dolt push && git push` でリモート同期
- 再開時: `bd dolt pull` -> `bd ready` -> ループ再開
- 別マシン・別エージェントから再開可能 (コンテキストは bd 上の description / notes に集約)

---

# extract-epub.mjs CONFIG 埋め方ガイド

`scripts/extract-epub.mjs` の冒頭にある `CONFIG` オブジェクトを書籍に応じて埋める。テンプレートロジック (ヘルパー関数群) は基本変更不要。

## CONFIG 各項目

### `epubFilename`

`docs/` 配下に配置する EPUB ファイルの名前。例: `'dmrb4.epub'`

### `outDir` / `imgDir`

通常は `'docs/en'` / `'docs/images'` のまま。a-philosophy は `'docs/figures'` を使うが、新規プロジェクトは `images` を推奨 (Vol1/2/3 と統一)。

### `opfPath`

| 値 | 適用ケース |
|---|---|
| `'auto'` | `META-INF/container.xml` から動的解決。**推奨デフォルト**。Vol1/2 で使用 |
| `'content.opf'` | EPUB ZIP 直下に `content.opf` がある場合 (a-philosophy) |
| `'OEBPS/content.opf'` | OEBPS/ 配下に固定 (Vol3) |

迷ったら `'auto'`。

### `filenameMap`

EPUB spine の id (or href stem) を出力ファイル名にマップ。詳細は `references/filename-conventions.md` 参照。

```javascript
filenameMap: {
  // 'spine_id': 'output.md' | null | 'SKIP'
  '00_cover':            'index.md',
  '01_title':            null,            // 直前 (index.md) にアペンド
  '02_copyright':        'SKIP',          // 翻訳対象外
  '05_foreword':         '01_foreword.md',
  '08_chapter_1':        '04_introduction.md',
  // ...
}
```

#### spine の id を確認する手順

```bash
# 1. EPUB を一時展開
mkdir -p /tmp/epub && unzip -q docs/<book>.epub -d /tmp/epub

# 2. content.opf の場所を特定
cat /tmp/epub/META-INF/container.xml
# <rootfile full-path="OEBPS/content.opf" .../>

# 3. spine の順序を抽出
python3 -c "
import re
with open('/tmp/epub/OEBPS/content.opf') as f: xml = f.read()
manifest = dict(re.findall(r'<item[^>]*\bid=\"([^\"]+)\"[^>]*\bhref=\"([^\"]+)\"', xml))
order = re.findall(r'<itemref[^>]*\bidref=\"([^\"]+)\"', xml)
for i, idref in enumerate(order):
    print(f'{i:02d} {idref:30s} -> {manifest.get(idref, \"???\")}')"
```

この出力を見ながら `filenameMap` を埋める。

### `parser.supportsH1toH4`

| 値 | EPUB タイプ |
|---|---|
| `true` | 標準的な `<h1>`〜`<h4>` 構造 (Vol2/3) |
| `false` | `<p class="chaptertitle">` ベースの古い CSS スタイル (a-philosophy/Vol1) |

EPUB 内の任意の章 HTML を `unzip -p docs/<book>.epub OEBPS/<chapter>.html | head` で確認:

- `<h1>...</h1>` が見える -> `true`
- `<p class="chaptertitle">...</p>` が見える -> `false`

### `parser.noteDivClasses`

`<div class="...">` を `> **Title**` 引用ブロックに変換する class 名。

通常: `['note', 'feature']` (Vol1/2/3、a-philosophy はそもそも note なし)

### `parser.watermarkPatterns`

行ごとに削除する正規表現の配列。

| ケース | 設定例 |
|---|---|
| 通常 | `[]` |
| OceanofPDF.com 透かし (Vol3) | `[/OceanofPDF\.com/i]` |
| 海賊版書籍に多い透かし | `[/.*pirated.*/i, /\bbookzz\.org\b/i]` |

`extract-epub.mjs` を 1 度走らせて、出力の冒頭・末尾・章境界に余計な行があれば追加する。

### `parser.contentDivId` / `contentDivClass`

章本体を内包する `<div>` の id / class:

| 値 | 適用ケース |
|---|---|
| `contentDivId: 'sbo-rt-content'` | Vol2 |
| `contentDivClass: 'story'` | Vol1 |
| 両方 `null` | a-philosophy/Vol3 (body 直下にコンテンツ) |

両方指定すると、まず id 優先で抽出し、見つからなければ class で再試行する。

## 4 プロジェクトの設定早見表

| 項目 | a-philosophy | DMRB-Vol1 | DMRB-Vol2 | DMRB-Vol3 |
|---|---|---|---|---|
| `epubFilename` | psd2nd.epub | dmrb1.epub | dmrb2.epub | dmrb3.epub |
| `outDir` | docs/en | 同左 | 同左 | 同左 |
| `imgDir` | docs/figures | docs/images | docs/images | docs/images |
| `opfPath` | `'content.opf'` | `'auto'` | `'auto'` | `'OEBPS/content.opf'` |
| `filenameMap` キー形式 | `part0001`〜 | ISBN 由来 (`9781118082324c01`) | 連番 (`08_chapter_1`) | ISBN+suffix (`9781118080832c01`) |
| `parser.supportsH1toH4` | `false` | `false` | `true` | `true` |
| `parser.noteDivClasses` | `[]` (span 変換) | `['feature','note']` | 同左 | 同左 |
| `parser.watermarkPatterns` | `[]` | `[]` | `[]` | `[/OceanofPDF\.com/i]` |
| `parser.contentDivId` | `null` | `null` | `'sbo-rt-content'` | `null` |
| `parser.contentDivClass` | `null` | `'story'` | `null` | `null` |

## 動作確認の手順

```bash
# 1. CONFIG を埋めた後、まず dry-run
node scripts/extract-epub.mjs --dry-run
# 期待: 「[DRY] docs/en/01_foo.md (X.X KB)」のような行が並ぶ
#      unmapped が出たら filenameMap に追加

# 2. 本番実行
node scripts/extract-epub.mjs

# 3. 出力確認
ls docs/en/
head -50 docs/en/04_introduction.md   # 例

# 4. 順序検証 (spine 順 == ASCII ソート順)
diff <(ls docs/en/ | grep '^[0-9]') <(ls docs/en/ | grep '^[0-9]' | sort)
# (空 = 一致)
```

## トラブルシューティング

**Q: `[DRY] skip (unmapped): 09_chapter_1`** と出る
A: その spine id が `filenameMap` に未登録。追加して再試行。

**Q: 出力 MD に画像が表示されない**
A: `parser.contentDivId` / `contentDivClass` を確認。コンテンツが間違った div で囲まれていて画像走査されていない可能性。

**Q: 見出しが `# ` のままで階層が崩れている**
A: `parser.supportsH1toH4` の値を確認。EPUB が `<p class="chaptertitle">` ベースなら `false`、`<h1>` ベースなら `true`。

**Q: 章本文に "OceanofPDF.com" のような透かしが残る**
A: `parser.watermarkPatterns` に正規表現を追加。

**Q: Note ブロックが `> **Note**` で始まらず、内容が `<div>` のまま残る**
A: `parser.noteDivClasses` の class 名が一致していない。EPUB 内の note の HTML を見て、`<div class="...">` の class 名を `noteDivClasses` 配列に追加。

**Q: 表のキャプション (`Table N.N ...`) が docs/en/ から消えている**
A: Wiley 系 EPUB は **画像版テーブル** を `<p class="tablecaption">...</p><div class="graphic"><img/></div>` 構造で持つ。`pendingTableCaption` は `<table>` でしか flush されないため、`<div class="graphic">` が来ると caption が捨てられる。`scripts/extract-epub.mjs` の `case 'div'` の `cls === 'figure' || cls === 'graphic'` ブロック先頭で `pendingTableCaption` を flush するように修正済 (本テンプレートには反映済)。プロジェクト側の `extract-epub.mjs` を init から派生させた古いバージョンの場合は、同じ修正をプロジェクト側にも適用する。検出方法: `grep -c "<p class=\"tablecaption\">" OEBPS/*.xhtml` の合計と `grep -c "^\*\*\*\[Table " docs/en/*.md` の合計が一致しているか確認。

## リンク変換とアンカー保持 (内部相互参照)

EPUB 内の `<a href="ch03.xhtml#anchor">` のような内部参照は、そのまま Markdown に貫通させると VitePress 上で機能しない。`scripts/extract-epub.mjs` は以下を自動で行う:

### 1. `transformHref()` による href 正規化

- `xxx.xhtml(#yyy)?` → `./<NN_slug>.md(#yyy)?` (filenameMap から MD ファイル名を解決)
- `Images/xxx.html(#yyy)?` のような EPUB 著者ミスの誤 prefix も補正
- 同一ファイル内 self-ref は `#yyy` だけに短縮 (スクロール挙動が綺麗)
- 外部 URL (`http(s)://`, `mailto:`) はそのまま貫通
- `filenameMap` に未登録の stem は warn を出してそのまま残す

### 2. id 保持 (figure / table / chapter / sect)

- `<div class="figure" id="X">` → `<a id="X"></a>` を画像直前に注入
- `<figure>` は tagAlt に追加されているので、`<figure><div class="figure" id="X">` のような二重ラップも正しく拾う
- `<table id="X">` → `<a id="X"></a>` を table 直前に注入 (table は pre-extract で placeholder 化されているので、内部 `<td><div>` の `</div>` が外側 div を早く閉じる問題を回避)
- `<div class="chapter|preface|sect[1-3]|part" id="X">` → 直後の見出しに `{#X}` を追記

### 3. table caption / sup ref / callout 復元

- `<table><caption>...` → caption が table 直前にイタリック斜体で出力
- 本文中の脚注 sup ref (`<sup><a href="X#Y" id="Y-marker">N</a></sup>`) → `<sup><a id="Y-marker"></a>[N](./X.md#Y)</sup>` (双方向リンク)
- `<ol class="calloutlist">` → 各 `<li>` の `<a id="callout_..."></a>` を保持

### 4. nested div 制約 (extract で完全には拾えないケース)

正規表現ベースの実装では、外側 `<div class="chapter">` の non-greedy `[\s\S]*?</div>` が、内側 `<table><td><div>` の `</div>` で早く閉じる「nested div 問題」が発生する。本テンプレートでは:

- `<figure>` を tagAlt に追加 (`<figure>` 自身がトップレベルマッチ)
- `<table>` を pre-extract & placeholder 化 (`<!--TBL_N-->`)

で対応しているが、**章冒頭の最初の figure や深いネストの sidebar 内 example div** は、依然として外側 div の早期 close で id が拾えないケースがある。

これらの漏れは `scripts/inject-anchors.mjs` (後処理スクリプト) で補完する。EPUB から id 一覧を抽出して、対応する MD 上の位置 (画像 basename / 見出し position / `> **Title**` blockquote 行 等) に idempotent に注入する。en と ja 両方に適用される。

### 5. extract で sidebar の h5 タイトルが `> **Sidebar**` 固定になる場合

EPUB の `<aside data-type="sidebar"><div class="sidebar"><h5>真のタイトル</h5>...</div></aside>` 構造で、`convertOReillyNote()` 内の処理順序が `<h6>...</h6>` 削除 → `<h5>` 抽出 になっていると、h5 タイトルが先に消費されて `> **Sidebar**` 固定になる。本テンプレートでは sidebar の場合のみ h5 抽出を先に行うよう修正済。

## 出版社・書籍別の構造バリエーション

`extract-epub.mjs` のテンプレは O'Reilly Atlas 構造を前提にしているが、Wiley DMRB / Yaknyam Press 等の出版社では HTML 構造が大きく異なる。新書籍に着手する際の判定フローと、既存 5 プロジェクトで観測した構造パターンと対応カスタマイズは `references/epub-variations.md` に集約。

着手時の流れ:

1. EPUB を `unzip -p` で開いて 1 章サンプルを確認
2. `references/epub-variations.md` の判定フローチャート (`<h1>`/`<p class="chaptertitle">`/`<p id class="class_sNN">` の有無) で出版社系統を特定
3. 該当する既存プロジェクトの `extract-epub.mjs` をベースにコピーしてカスタマイズ
4. 新パターンが出てきたら `references/epub-variations.md` に追記

## 後処理スクリプト (Final フェーズで必須)

extract で漏れた id 補完と、手動翻訳済の docs/ja への適用は以下 3 本で行う:

| スクリプト | 役割 | 対象 |
|---|---|---|
| `scripts/fix-internal-links.mjs` | xhtml ref → 相対 MD パス | docs/ja (`--en-also` で en も) |
| `scripts/inject-anchors.mjs` | figure / table / heading / sidebar の id 注入 | docs/en + docs/ja (idempotent) |
| `scripts/check-links.mjs` | 死リンク検出 (heading 自動 slug を含む) | docs/en + docs/ja |

`check-links.mjs` の errors=0 が Final フェーズの完了条件。残ったエラーは「ja の table 翻訳不在」「ja の見出し構造が en と不一致」など、proof:en-ja の re-pass で対応するべき領域。

---

# EPUB バリエーション別 anchor / inline anchor 抽出パターン

`extract-epub.mjs` と `inject-anchors.mjs` の anchor 処理は **EPUB 構造に強く依存**する。テンプレは O'Reilly Atlas (`<figure id>` / `<table id>` / `<div class="sect[123]" id>`) を前提にしているが、出版社により構造が大きく変わるため、書籍ごとにカスタマイズが必要となる。

書籍の EPUB を初めて開いた時に **どの構造に該当するか** を素早く判定できるよう、過去 4 プロジェクトで遭遇したバリエーションをここにまとめる。

## 判定フローチャート

```
1 章だけ unzip し HTML を見て:

  <h1>...</h1> がある            ─→ O'Reilly Atlas または Wiley DMRB Vol2/Vol3
    ├ <figure id="...">         ─→ O'Reilly Atlas
    └ <p class="text" id>       ─→ Wiley DMRB (本文 <p> に id がある)

  <p class="chaptertitle">      ─→ Wiley DMRB Vol1 系 (h1 不使用)

  <p id="aXXX" class="class_s7t"> ─→ Yaknyam Press (a-philosophy-of-software-design)
                                    h1〜h4 を使わず class で見出し階層を表現

  <span id="aXXX"></span>       ─→ Yaknyam Press の inline anchor (脚注 reverse 用)
```

`grep` で素早く判別:

```bash
unzip -p docs/<book>.epub OEBPS/<chapter>.xhtml > /tmp/sample.html
grep -cE '<h[1-4]\b' /tmp/sample.html
grep -cE '<p[^>]+class="(chaptertitle|class_s7t)"' /tmp/sample.html
grep -cE '<span[^>]+id="a[0-9]+"' /tmp/sample.html
grep -cE '<figure\b|<div[^>]+class="figure"' /tmp/sample.html
grep -cE '<p[^>]+class="(figurecaption|tablecaption)"' /tmp/sample.html
```

---

## 1. O'Reilly Atlas — 標準テンプレ

**書籍例**: `architecture-patterns-with-python` (Cosmic Python)

**HTML 構造**:
- 見出し: `<h1>`〜`<h4>`、id は親 `<div class="sect1" id="X">` に付与
- figure: `<figure id="X"><img/></figure>` または `<div class="figure" id="X"><img/></div>`
- table: `<table id="X"><caption>...</caption>...</table>`
- 脚注 sup ref: `<sup><a href="X#Y" id="Y-marker">N</a></sup>`
- callout: `<ol class="calloutlist"><li><a id="callout_..."></a>...</li></ol>`
- sidebar: `<aside data-type="sidebar"><div class="sidebar"><h5>...</h5>...</div></aside>`
- example: `<div data-type="example">`
- warning/note/tip: `<div data-type="warning|note|tip|caution|important">`

**カスタマイズ不要** (skill のテンプレ extract-epub.mjs / inject-anchors.mjs がそのまま動く想定):
- `transformHref()` で xhtml → 相対 MD 変換
- `<figure>` を tagAlt に追加して independent matching
- `<table>` / `<aside>` / `<div data-type="...">` を depth-aware に **placeholder pre-extract** (TBL_N / EX_N / SB_N / NT_N) して nested div 問題回避
- inject-anchors.mjs は en で英語テキスト照合、ja で位置 (見出しレベル列) ベース照合

---

## 2. Wiley DMRB Vol1 — `<a id href>` 両持ち + p ベース見出し

**書籍例**: DMRB-Vol1 (Universal Data Models)

**HTML 構造**:
- 見出し: `<p class="chaptertitle|h1|h2|h3">` (`<h1>` 不使用、CSS class で階層表現)
- inline anchor: `<a id="X" href="Y">text</a>` (id と href を **両持ち**)
- table caption: `<p class="tablecaption" id="X">Table N-N. ...</p>` (`<p>` 自身に id)
- figure caption: `<p class="figurecaption" id="X">Figure N-N. ...</p>`
- footnote 本文: `<p class="footnoteentry" id="X">...</p>` (本文側にも id)

**extract-epub.mjs カスタマイズ**:
- `convertInline` で `<a id="X" href="Y">text</a>` を **`<a id="X"></a>[text](変換後Y)`** に分離変換
- 分離した anchor を **`ANC_N` placeholder** で保護してタグ剥がしから守る (これをやらないと後段の `stripTags` で `<a id>` が消える)
- `<p class="chaptertitle|h1|h2|h3">` 内 inline `<a id>` を見出し `{#id}` に **hoist** (見出し直前ではなく見出し行末尾の `{#id}` 注釈に)
- `<p class="tablecaption" id>` / `<p class="figurecaption" id>` / `<p class="footnoteentry" id>` の `<p>` 自身の id を anchor 化

**inject-anchors.mjs カスタマイズ**:
- 4 種のパターンで en→ja ミラーリング:
  1. **caption-precedent anchor**: en の `<a id></a>` と直後の caption 行をペア化 → ja の同じ caption の前に注入
  2. **inline anchor**: `<a id></a>[text](#anchor)` を ja の同じ `[text](#anchor)` の前に注入
  3. **heading 位置同期**: 見出しレベル列で en/ja を照合し `{#id}` を末尾に付与
  4. **footnote**: `<p class="footnoteentry" id>` 系を ja の対応する footnote に注入

---

## 3. Wiley DMRB Vol2 — `<p class="text" id>` 構造

**書籍例**: DMRB-Vol2 (Industries)

**HTML 構造**:
- 見出し: `<h1>`〜`<h4>` 標準
- 本文: `<p class="text" id="X">` (本文 `<p>` 自体に id がある独特の構造)
- table caption: `<p class="tablecaption" id="X">` (Vol1 と同様)
- ja の caption 表記が **2 形式混在**:
  - `*図2.1...*` (空白なし、シングルアスタリスク)
  - `**表A.1...**` (bold 二重アスタリスク)

**extract-epub.mjs カスタマイズ**:
- `parser.contentDivId: 'sbo-rt-content'` (Vol2 固有のコンテンツ wrap div)
- 本文 `<p class="text" id>` の id を anchor 化
- `parser.supportsH1toH4: true` (Vol1 と異なり h1〜h4 使う)

**inject-anchors.mjs カスタマイズ**:
- `isCaption` regex を **両形式対応** に拡張:
  ```javascript
  // 旧: /^\*[図表] /        (空白あり前提)
  // 新: /^\*\*?[図表]\d/    (bold/non-bold + 空白省略形)
  ```
- enAnchorPairs 抽出時、**連続 anchor を許容**: `<a id="table_A_1">` + `<a id="page_444">` + `**Table A.1...**` のように複数 `<a id>` が連続する場合がある。空行 + 別 anchor をスキップしてペアを完成させる
- `buildXhtmlPathMap` は item id (`body001`) ではなく **href stem (`00_cover`)** ベースに修正 (manifest item id と spine 順序が一致しない構造に対応)

---

## 4. Wiley DMRB Vol3 — image-based table + ラベル一致同期

**書籍例**: DMRB-Vol3 (Universal Patterns for Data Modeling)

**HTML 構造**:
- 見出し: `<h1>`〜`<h4>` 標準
- **image-based table**: `<p class="tablecaption">` が `<div class="graphic"><img/></div>` の前に来る (table 自体が画像。Wiley のデータモデル系書籍に多い)
- xhtml stem に Wiley 系プレフィックス (`9781118080832c01` 等の ISBN+章番号)

**extract-epub.mjs カスタマイズ**:
- `parser.opfPath: 'OEBPS/content.opf'` (auto 解決でなく固定)
- `parser.watermarkPatterns: [/OceanofPDF\.com/i]` (海賊版透かし除去、Vol3 のみ)
- `case 'div'` の `cls === 'graphic'` ブロック先頭で `pendingTableCaption` を flush (caption が `<table>` でなく `<div class="graphic">` の直前に来るため)
- `<a id ...>` を heading `{#id}` 注釈として抽出 (Vol1 と類似)
- convertInline で `<a href id>` 両方を保持、残タグ除去で `<a id></a>` と `<sup>` を退避

**inject-anchors.mjs カスタマイズ**:
- ja に対して **label match** で 1:1 同期する `applyJaInlineAnchorsByMatch` を追加:
  - matcher: `Figure / Figures / Tables / figure / 図 / 表 / 単独番号 (N-N)`
  - en の `<a id></a>[Figure 1-1](#fig)` のような anchor 付き label を、ja の `[図 1-1](#fig)` の前に注入
- `handleImage` を **既存ファイル上書き禁止** に変更 (回転済み画像など、人手で修正された画像が消えるのを防ぐ。Vol3 では 82 枚の手動回転画像を保護した実績あり)

---

## 5. Yaknyam Press — class ベースの全体構造

**書籍例**: a-philosophy-of-software-design (APoSD-2nd)

**HTML 構造** (h1〜h4 を**一切使わない**):
- 見出し: `<p id="aXXX" class="class_s7t">タイトル</p>` (class_s7t / s7r / s5r で階層)
- figure caption: `<p id="aXXX" class="class_s5">caption</p>`
- inline anchor: `<span id="aXXX"></span>` (脚注 reverse 用、本文中に空 span が散在)
- xhtml stem: `part0001.xhtml` 形式

**extract-epub.mjs カスタマイズ**:
- `parser.supportsH1toH4: false`
- `parser.opfPath: 'content.opf'` (ZIP 直下)
- `imgDir: 'docs/figures'` (Yaknyam デフォルト、images ではない)
- skill の `<div class="figure">` 系正規表現は**一切不適合**。Yaknyam 独自仕様のテンプレを別途持つ
- `transformHref` / `isEphemeralId` を追加し、`<p>` の id 抽出 / `<span>` を anchor 化する処理を独自実装
- 見出し階層: `class_s7t` → `<h1>`、`class_s7r` → `<h2>`、... のような class→level マップを持つ

**inject-anchors.mjs カスタマイズ**:
- `buildXhtmlPathMap` は `part0001.xhtml` のような id 形式に対応するよう拡張
- en の `<a id="aXXX"></a>` を見出し位置で抽出 → ja の対応する見出し位置に同期
- anchor refs が原本にほぼ無い (引用は別ページの脚注のみ) ため、注入の効果は他書より小さい

---

## バリエーション追加の手順

新書籍に着手する際、上記 5 種に該当しない構造が出てきたら:

1. **判定**: 上記の `grep` コマンドで該当出版社/シリーズを特定
2. **既存テンプレを開始点に**: 最も近い既存バリエーション (例: 標準なら Atlas、p ベース見出しなら DMRB Vol1) をベースに既存 `extract-epub.mjs` をコピー
3. **カスタマイズ**: 新たに必要になった処理を追加
4. **このファイルに追記**: `## 6. <出版社名> — <特徴>` セクションで構造とカスタマイズを記録
5. `extract-epub-customization.md` の「設定早見表」テーブルに列を追加

## デバッグ tips

- **id がほとんど抽出されない**: タグ単位で grep `<p[^>]+id="`, `<span[^>]+id="`, `<figure[^>]+id="` を試して、どこに id が集中しているかを把握
- **anchor が ja に注入されない**: en の anchor 数 vs ja の caption 数を比較し、両者の出現順を確認 (順序不一致なら手動で 1 件修正してパターン確立)
- **見出しレベル列が一致しない (proof:en-ja 未完了の章)**: inject-anchors を走らせると警告が出る。en の構造が正しく ja の構造が翻訳過程でズレているケースがほとんど。ja 側の見出しレベルを en に合わせて手動修正
- **本文 `<a id>` の数が一致しない**: en で `<a id="X"></a>[text](#X)` を含む行と ja の `[text](#X)` を含む行を行番号で並べてみる (`paste` で並列表示)

---

# gen-tickets.mjs CONFIG 埋め方ガイド

`scripts/gen-tickets.mjs` の冒頭にある `CONFIG` オブジェクトを書籍に応じて埋める。テンプレートロジック (Epic / Setup / Translation / Proof / Final 生成) は基本変更不要。

## CONFIG 各項目

### `epicTitle`

Epic チケットのタイトル。書籍名を含めて分かりやすく。

例: `'docs/en/ の全章を日本語化 (DMRB Vol.4)'`

### `bookCitation`

書籍の書誌情報。Epic description に埋め込まれる。

例: `'The Data Model Resource Book Vol.4, Author Name, Wiley 2026, ISBN 9781234567890'`

### `chapterTitleJa`

本編の章タイトル対応表。**連番接頭辞付き stem** -> `'第N章 日本語タイトル'` のマップ。

```javascript
chapterTitleJa: {
  '04_introduction':              '第1章 はじめに',
  '05_manufacturing':             '第2章 製造業',
  '06_telecommunications':        '第3章 通信業',
  // ...
}
```

`extract-epub.mjs` 完了後に `ls docs/en/` で生成された stems を確認しながら埋める。

### `specialTitleJa`

前付け・付録・補足の章タイトル対応表。同じく **連番接頭辞付き stem** -> 表記文字列。

```javascript
specialTitleJa: {
  '01_foreword':         '序文 (Foreword)',
  '02_acknowledgments':  '謝辞 (Acknowledgments)',
  '03_about-the-author': '著者について (About the Author)',
  '14_appendix-a':       '付録A 製造業のエンティティと属性',
  // ...
}
```

### `chapterOffset`

本編の最初のファイルが第何章に対応するか:

| 例 | 意味 | `chapterOffset` |
|---|---|---|
| `'04_introduction'` が第1章 | seqNum=4, chNum=1 | `3` |
| `'05_introduction'` が第1章 | seqNum=5, chNum=1 | `4` |
| `'01_introduction'` が第1章 | seqNum=1, chNum=1 | `0` |

数式: `chapterOffset = (本編最初の seqNum) - 1`

`bd` チケットのラベル `chapter:NN` (例: `chapter:01`) はこの値で計算される。

### `prioritizeP1`

P1 優先度 (高優先) のチケットにする stem の配列。通常は以下を入れる:

- 序文 (`_foreword`)
- 第1章 (introduction)
- 最終章 (conclusion / using-the-models)
- 代表的な章 (DMRB-Vol2 なら manufacturing / financial-services / e-commerce)

例:
```javascript
prioritizeP1: [
  '01_foreword',
  '04_introduction',                  // 第1章
  '05_manufacturing',                 // 第2章 (Vol2 主要分野)
  '09_financial-services',            // 第6章 (Vol2 主要分野)
  '13_using-the-industry-models',     // 第10章 (まとめ)
],
```

それ以外は P2 (中優先) になる。bd ready は priority 順に並ぶので、P1 から先に消化される。

### `glossarySetupHint`

Setup s2 (用語集作成) チケットの description に挿入されるヒント文。書籍ジャンル別の用語カテゴリリスト。

例 (DMRB Vol2):
```
## Vol2 で追記が必要な業界別用語カテゴリ
- 製造業 (Manufacturing): BOM, work order, MRP, production line
- 通信業 (Telecommunications): subscriber, billing cycle, line item
- ヘルスケア (Health Care): patient encounter, diagnosis, procedure
- 保険 (Insurance): policy, claim, beneficiary, premium
- 金融サービス (Financial Services): account, transaction, securities
```

### `proofPhase`

| 値 | 生成チケット | 適用ケース |
|---|---|---|
| `'full'` | proof:epub-en (各章) + proof:en-ja (各章) | DMRB系 (Vol1/2 のフルワークフロー) |
| `'epub-only'` | proof:epub-en のみ | 訳文校正は手動レビュー想定 |
| `'none'` | proof チケットなし | a-philosophy 1u2 epic タイプ (シンプル翻訳) |

`'full'` がデフォルト推奨。`'none'` は別途 proof epic を後から立てる場合に使う。

### `sizeBuckets`

ファイルサイズ分類の行数閾値。デフォルト `{ small: 50, medium: 300 }`:

- 50 行以下: `size:small`
- 51〜300 行: `size:medium`
- 301 行以上: `size:large`

bd ラベルとして付与される。書籍のばらつきによって `{ small: 30, medium: 200 }` 等に調整可。

## 動作確認の手順

```bash
# 1. CONFIG を埋めた後、dry-run
bd init   # まだなら beads を初期化
node scripts/gen-tickets.mjs --dry-run
# 期待: Epic + 4 Setup + N Translation + N Proof:EPUB-EN + N Proof:EN-JA + 1 Final
#      合計 1 + 4 + 3N + 1 = 3N+6 件 (proofPhase=full の場合)

# 2. 本番実行
node scripts/gen-tickets.mjs

# 3. bd で確認
bd list --all  | head -20
bd ready
```

## CONFIG 値の典型レンジ

| 項目 | 典型値 | コメント |
|---|---|---|
| 章数 (本編) | 10〜30 | 30 を超える長大書籍では `prioritizeP1` を多めに設定して進行管理しやすくする |
| `chapterOffset` | 0〜4 | 前付け (`foreword` / `acknowledgments` / `about-the-author` 等) の枚数に応じて。`04_introduction.md` が第1章なら `3` |
| `proofPhase` | `'full'` / `'epub-only'` / `'none'` | 商用品質なら `'full'`、ドラフトや個人用なら `'none'` |
| `prioritizeP1` 件数 | 0〜10 | 序盤の章 (foreword, introduction) と看板章を P1 にして bd ready の先頭に来るようにする |

## トラブルシューティング

**Q: `bd create` が「empty title」エラー**
A: `chapterTitleJa` / `specialTitleJa` の stem 名が `docs/en/` の実ファイル名 (拡張子なし) と一致しているか確認。typo に注意。

**Q: setup s4 が translation の依存関係に入っていない**
A: テンプレートロジック内で `setupDeps = [s1, s2, s3, s4]` を全 translation の deps に渡しているので、`gen-tickets.mjs` 自体は変更不要。`bd show <translation_id>` で deps が出ることを確認。

**Q: P1 にしたい章が P2 になっている**
A: `prioritizeP1` の stem 名が `docs/en/` のファイル名 (拡張子なし) と完全一致しているか確認。

---

# Cloudflare Pages デプロイ詳細手順

book-translation-pipeline スキルの Cloudflare Pages 対応の中身を解説する。`init-project.sh --deploy-target=cloudflare` または `migrate-to-cloudflare.sh` 経由で使う。

## 何が起きるか

| 配置されるもの | 役割 |
|---|---|
| `functions/_middleware.ts` | 全リクエストに HTTP Basic 認証を強制する Pages Function。SHA-256 ハッシュ + 定数時間比較 |
| `wrangler.toml` | Cloudflare Pages プロジェクト名（**ランダム 16 文字**）とビルド出力先を固定 |
| `.github/workflows/cloudflare-pages.yml` | master/main push で Cloudflare Pages へ自動デプロイ |
| `.env.local.example` | API Token / Basic auth 情報のテンプレ。`.env.local` にコピーして埋める |
| `docs/public/robots.txt` | 全 bot に取得拒否（`Disallow: /`）。VitePress が dist 直下にコピー |
| `docs/public/_headers` | 全レスポンスに `X-Robots-Tag: noindex, nofollow` を付与（Cloudflare Pages が解釈） |

加えて、`docs/.vitepress/config.mts` の `head` に `<meta name="robots" content="noindex, nofollow">` が入る（テンプレート既定。GitHub Pages deploy 時のみ `init-project.sh` が削除）。

## 前提

- Cloudflare アカウント
- `gh` CLI でリポジトリオーナーアカウントにログイン済み
- ID/PW は固定の少人数で共有する用途（メールごとの管理は Cloudflare Access に切替推奨）

## API Token の発行（一度だけ）

GitHub Actions が Cloudflare へデプロイするために必要。

1. https://dash.cloudflare.com/profile/api-tokens
2. **Create Token** → **Custom token** → **Get started**
3. Token name: `pages-deploy-<repo>`
4. **Permissions** に以下 2 行:
   - **Account / Cloudflare Pages / Edit**
   - **User / User Details / Read**（推奨。なくても Pages デプロイ自体は動くが `wrangler whoami` 等の補助コマンドで警告が出る）
5. **Account Resources**: Include / 自分のアカウントを選択
6. **Continue to summary** → **Create Token** → 表示された値をコピー（再表示不可）

加えて **Account ID** を https://dash.cloudflare.com/ 右サイドバーからコピー。

## .env.local の中身

```
CLOUDFLARE_API_TOKEN=<上で発行した Token>
CLOUDFLARE_ACCOUNT_ID=<コピーした Account ID>
BASIC_AUTH_USER=<好きなユーザー名>
BASIC_AUTH_PASS=<強めのパスワード>
```

`.gitignore` に `.env.local` が入っているのでコミットされない。

## init-cloudflare-deployment.sh の動作（逐次）

1. `npm i -D wrangler`（既に入っていれば no-op）
2. `wrangler pages project create <random-name> --production-branch=master`
3. `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` を `wrangler pages secret put`（stdin 経由でログに値が出ない）
4. `npm run build`
5. `wrangler pages deploy docs/.vitepress/dist --project-name=<random-name>`
6. `gh secret set CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`（CI 用）
7. README の `<!-- DEPLOY_SECTION_BEGIN -->` 〜 `END` ブロックを最新の URL で更新

完了後、**Bookmark this URL** メッセージで `https://<random16>.pages.dev/` が表示される。これが配信 URL。

## ID/PW の更新方法

```bash
set -a && source .env.local && set +a
PROJECT_NAME=$(awk -F'"' '/^name/{print $2}' wrangler.toml)
printf '%s' "$BASIC_AUTH_PASS" | npx wrangler pages secret put BASIC_AUTH_PASS --project-name="$PROJECT_NAME"
```

コード変更不要。

## URL ランダム化の意図と限界

- リポジトリ名そのまま（例: `dmrb-vol4.pages.dev`）だと URL を知っているだけで Basic 認証ダイアログまで誰でも到達してしまう
- **16 文字のランダム英数字**（先頭は英字保証）を Cloudflare プロジェクト名に使うことで discovery 困難化
- ただし TLS 証明書は **Certificate Transparency (CT) ログ** に登録されるため、CT ログ経由で発見される可能性はある（完全な隠蔽は不可）
- 真に閲覧者を限定したい場合は **Cloudflare Access** に切替: 独自ドメイン + Access ポリシー（メアド単位 / SSO）。`functions/_middleware.ts` を削除して Access 設定するだけで移行可能

## bot 非クロール（robots.txt / noindex / X-Robots-Tag）

著作権のある書籍の翻訳なので、検索エンジン・LLM クローラに拾われないよう **3 層** で多層防御する（Cloudflare deploy 時に既定で有効）:

| 層 | 配置 | 役割 |
|---|---|---|
| `robots.txt` | `docs/public/robots.txt`（`Disallow: /`） | 行儀の良い bot に**そもそも取得させない** |
| `meta robots` | `config.mts` の `head` | HTML を取得した bot に index 拒否を伝える |
| `X-Robots-Tag` | `docs/public/_headers` | HTTP ヘッダで index 拒否。HTML 以外の応答にも効く |

robots.txt 準拠 bot は取得しないので `noindex` を読まないが、これらのサイトはランダム URL かつ外部被リンクが無いため URL 単体の index 化は実質起きない。robots.txt を無視する bot は `meta` / `X-Robots-Tag` で index を防ぐ。GitHub Pages（公開意図）では `init-project.sh` が `noindex` head を外し、robots.txt / `_headers` も配置しない。

## トラブルシュート

### `Wrangler authorization failed` / `There was an error fetching accounts`

原因: シェル環境に `NODE_TLS_REJECT_UNAUTHORIZED=0` がセットされている（Netskope 等の SSL Inspection 環境でよくある）。Cloudflare 側がこの設定の TLS クライアントを拒否する既知挙動。

対処:
```bash
unset NODE_TLS_REJECT_UNAUTHORIZED
```
`init-cloudflare-deployment.sh` は冒頭で自動的に unset するので、別ターミナルで `wrangler login` を試す場合のみ手動 unset 必要。

`.zshrc` 等で常時 export されていれば、その export 自体を見直す（多くの場合 `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/netskope-cert-bundle.pem` で十分で、TLS 検証無効化は不要）。

### `Failed to automatically retrieve account IDs for the logged in user`

原因: API Token に `User > User Details > Read` が無い。

対処: ダッシュボードで Token 編集してパーミッション追加、または新規 Token 作成。`CLOUDFLARE_ACCOUNT_ID` を環境変数で渡せれば回避できるコマンドもある（Pages 系は OK）。

### 401 が出ない（誰でも閲覧できてしまう）

考えられる原因:
- Cloudflare 側で `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` の secret が空（`wrangler pages secret list --project-name=<name>` で確認）
- `functions/_middleware.ts` が deploy されていない（`wrangler pages deploy` の出力に `Compiled Worker successfully` があるか確認）
- ブラウザがキャッシュした認証情報を送信している（シークレットウィンドウで再確認）

### 旧 GitHub Pages の URL が 404 にならない

- リポジトリ Settings → Pages を **Source: None** に変更（手動）
- または `gh api -X DELETE repos/$OWNER/$REPO/pages` を実行
- `gh-pages` ブランチを削除（`git push origin --delete gh-pages`）

---

# GitHub Pages デプロイ詳細手順

book-translation-pipeline スキルの GitHub Pages 対応の中身。`init-project.sh --deploy-target=github` か `gh repo` が public で自動判定された場合に使われる。

## 何が起きるか

| 配置されるもの | 役割 |
|---|---|
| `.github/workflows/deploy.yml` | master/main push で `peaceiris/actions-gh-pages@v3` を使い `gh-pages` ブランチへデプロイ |
| `docs/.vitepress/config.mts` の `base: '/<repo-name>/'` | GitHub Pages がサブパス配信する都合で必須 |

## 初回有効化（手動 1 ステップ）

GitHub のリポジトリ Settings → **Pages** → **Source** を **GitHub Actions** に設定。
（peaceiris アクションを使うので `gh-pages` ブランチも選べる。どちらでも `Settings → Pages → Source` を 1 度有効化する必要あり）

## ブランチ対応

ワークフローは `branches: [main, master]` 両対応で生成される。リポジトリのデフォルトブランチがどちらでも追加設定なしで動く。

## 公開 URL

```
https://<github-user>.github.io/<repo-name>/
```

`init-project.sh` が README に自動で記載。

## トラブルシュート

### push したのに 404

チェック順:
1. Actions タブでワークフローが成功しているか
2. Settings → Pages → Source が **GitHub Actions** または **Deploy from a branch (gh-pages / root)** になっているか
3. `gh-pages` ブランチが生成されているか（`git ls-remote origin gh-pages`）
4. `vitepress-config.mts` の `base:` がリポジトリ名と一致しているか（`init-project.sh` が自動で置換しているはず）

### CSS / アセットが 404

`base:` の値が間違っている可能性。リポジトリ名が `MyRepo` なのに `base: '/myrepo/'` で配信されると、ブラウザは `/MyRepo/...` にリクエストして 404。`__REPO_NAME__` が小文字化されているのは仕様（GitHub Pages の URL は小文字）。

### 公開してから「やはり関係者限定にしたい」

```bash
bash $SKILL_DIR/scripts/migrate-to-cloudflare.sh
# .env.local を埋めてから
bash $SKILL_DIR/scripts/migrate-to-cloudflare.sh --continue
```

これで GitHub Pages → Cloudflare Pages + Basic 認証へ切替。詳細は `references/deploy-cloudflare.md`。
