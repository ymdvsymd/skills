# Proof:EPUB-EN 8 項目チェックリスト

EPUB → Markdown 抽出結果 (`docs/en/*.md`) の構造校正用 8 項目。`Proof-EPUB-EN Agent` が使用する。

## 観点

### 1. 構造保持

H1〜H4 が原文 XHTML の見出し構造と一致しているか:

- 原文の `<h1>` / `<p class="chaptertitle">` → Markdown `# 章タイトル`
- 原文の `<h2>` / `<p class="h1">` → `## セクションタイトル`
- 原文の `<h3>` / `<p class="h2">` → `### サブセクション`
- 原文の `<h4>` / `<p class="h3"|"h4"|"h5">` → `#### `

不一致が見つかったら `extract-epub.mjs` の `convertToBlocks` 内 `case 'p'` の class 判定を見直す。

### 2. 段落の欠落なし

原文 `<p>` タグが Markdown 段落として存在するか。EPUB の `<div class="story">` や `<div id="sbo-rt-content">` の中身が漏れなく走査されているか確認。`extract-epub.mjs` の `parser.contentDivId` / `contentDivClass` 設定が適切か。

### 3. 画像参照

`![alt](../images/...)` の参照先が `docs/images/` に**実在**するか (CONFIG で `imgDir` を変えていればその出力先)。

```bash
# 全画像参照を抽出
grep -oE '!\[[^]]*\]\(\.\./images/[^)]+\)' docs/en/<file>.md \
  | sed 's|.*(\.\./images/||;s|).*||' | sort -u | while read f; do
    [[ -e "docs/images/$f" ]] || echo "MISSING: $f"
  done
```

### 4. 表組み

パイプ記法 `| ... |` の列ずれ・セル抜け確認:

- 各行の `|` の数が一致しているか
- ヘッダ行と区切り行 (`| --- | --- |`) のカラム数が一致
- セル内のパイプ `|` がエスケープ (`\|`) されているか

### 5. 特殊ブロック

- **Note**: `<div class="note"|"feature">` → `> **Title**\n> ...\n> - 箇条書き` 形式
- **figurecaption**: `*Figure N.N: ...*` (italic、内部に `**bold**` を含めない)
- **tablecaption**: 同様に `*Table N.N: ...*`

`extract-epub.mjs` の `convertNote` / `figurecaption` 処理を経ているか確認。

#### figurecaption / tablecaption の件数チェック (取りこぼし検出)

EPUB と docs/en/ で件数を比較し、取りこぼしを検出する:

```bash
# EPUB 側 (展開済みディレクトリで実行)
grep -hc "<p class=\"figurecaption\"" OEBPS/*.xhtml | awk '{s+=$1} END {print "EPUB figure:", s}'
grep -hc "<p class=\"tablecaption\""  OEBPS/*.xhtml | awk '{s+=$1} END {print "EPUB table:",  s}'
# h6-based caption (O'Reilly 系)
grep -hcE "<h6[^>]*><span class=\"label\">Figure" OEBPS/*.xhtml | awk '{s+=$1} END {print "EPUB h6 figure:", s}'

# docs/en/ 側
grep -hcE "^\*\[Figure |^\*\*\*\[Figure " docs/en/*.md | awk -F: '{s+=$1} END {print "EN figure:", s}'
grep -hcE "^\*\*\*\[Table " docs/en/*.md | awk -F: '{s+=$1} END {print "EN table:",  s}'
```

EPUB と EN で件数が一致しない場合、`extract-epub.mjs` のバグ可能性大。代表的な症状:

- **画像版テーブル (Wiley 系)**: `<p class="tablecaption">...</p><div class="graphic"><img/></div>` 構造で、`pendingTableCaption` が `<table>` でしか flush されないため caption が捨てられる。`case 'div'` の `cls === 'figure' || cls === 'graphic'` ブロック先頭で flush するように修正。
- **figure 内 figurecaption (O'Reilly 系)**: `<div class="figure"><p class="figurecaption">...</p><img/></div>` 構造で、内部の caption 抽出ループが必要。
- **figure 内 h6 caption**: `<div class="figure"><img/><h6><span class="label">Figure...</h6></div>` の h6 を拾うループも必要。

### 6. インライン書式

- `<strong>` / `<b>` / `<span class="bold">` → `**bold**`
- `<em>` / `<i>` / `<span class="italic">` → `*italic*`
- `<sup>` / `<span class="superscript">` → `<sup>...</sup>`

両端の空白が外側に出ているか (`*foo *` → `*foo* `)、内部の `*` がエスケープされているか確認。

### 7. エンティティ展開

HTML エンティティが Unicode 文字に展開されているか:

| HTML エンティティ | 期待出力 |
|---|---|
| `&amp;` | `&` |
| `&lt;` `&gt;` | `<` `>` |
| `&mdash;` | `—` (em dash) |
| `&ndash;` | `–` (en dash) |
| `&ldquo;` `&rdquo;` | `“` `”` |
| `&copy;` | `©` |
| `&reg;` | `®` |

`grep -oE '&[a-z]+;' docs/en/<file>.md` がゼロ件であること。

### 8. ノイズ混入なし

以下が本文に紛れていないか:

- 著作権表示 (Copyright © ..., All rights reserved)
- ページ番号 ("Page N" など)
- CSS / class 属性の残骸 (`<span class="bold">` 等)
- ウォーターマーク文字列 (例: `OceanofPDF.com`、Vol3 で問題化)

`extract-epub.mjs` の `CONFIG.parser.watermarkPatterns` に正規表現を追加して除去できる。

### 9. 内部リンク・アンカー定義

extract 結果が「内部リンクが機能する状態」になっているかを確認。

**チェック項目:**

1. **xhtml 残存ゼロ**: `grep -nE '\]\([a-z0-9_-]+\.x?html' docs/en/*.md` が 0 件
   - もし残っている場合、`scripts/lib/filename-map.mjs` に未登録の stem がある可能性 → warn 出力を確認して追加
2. **figure / table アンカー**: 各 figure 直前に `<a id="..."></a>`、各 table 直前に `<a id="..."></a>` + caption (`*Table N-N. ...*`) が出ているか
3. **見出し `{#id}` 注入**: 各章の `# Chapter N. Title` に `{#chapter_NN_xxx}` が付いているか、`<div class="sect1" id="X">` の見出しに `{#X}` が付いているか
4. **sidebar アンカー**: `> **Title**` blockquote の直前に該当 sidebar の `<a id="..."></a>` が出ているか
5. **callout 双方向リンク**: コードブロック内の `(N)` と章末の脚注リスト `1. <a id="callout_..."></a>` が対応しているか
6. **脚注 sup ref**: 本文中の脚注番号が `<sup><a id="X-marker"></a>[N](./Y.md#X)</sup>` 形式で残っているか

**自動検証:**

```bash
node scripts/inject-anchors.mjs --en-only --dry-run     # extract が拾えなかった id を確認
node scripts/check-links.mjs                            # 死リンク検出 (errors を 0 に近づける)
```

**漏れがあった場合:**

- nested div が原因で extract が拾えない id (章冒頭 figure / 深い sidebar 内 example 等) は `scripts/inject-anchors.mjs` で補完
- `extract-epub.mjs` 自体のロジックに改善余地がある場合は (例: `<table>` の placeholder 化が効いていない) follow-up チケットを起票

## 進め方

1. `docs/en/<file>.md` を冒頭から末尾まで通読
2. EPUB の対応 XHTML を `unzip -p docs/<book>.epub OEBPS/<file>.html` で抽出して比較
3. 軽微な問題は直接 `docs/en/<file>.md` を修正
4. 構造的不具合は `extract-epub.mjs` 改修 follow-up チケットを起票
5. 修正観点と件数を bd notes に記録 (例: `"#3 missing image: foo.jpg, #5 figurecaption 3件追加, #8 watermark 2行除去, #9 anchor 漏れ 4件 inject"`)
6. `bd close <ticket_id> --reason "proof:epub-en passed (9/9)"` を実行
