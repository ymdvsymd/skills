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
