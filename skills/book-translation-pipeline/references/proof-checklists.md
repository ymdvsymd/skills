# Proof Checklists (epub-en / en-ja / reproof)

校正フェーズの 3 種チェックリストをまとめたリファレンス。

- **proof:epub-en**: 抽出した英文 MD の構造校正 (10 項目)
- **proof:en-ja**: 日本語訳文の校正 (11 項目)
- **reproof**: extract-epub.mjs 改修後の再校正パターン

---

# Proof:EPUB-EN 10 項目チェックリスト

EPUB → Markdown 抽出結果 (`docs/en/*.md`) の構造校正用 10 項目。`Proof-EPUB-EN Agent` が使用する。

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

### 10. コードブロック断片化検出

EPUB の sidebar/Note 内 `<pre class="skip">` には syntax highlighting 用に各トークンが個別 `<code>` 要素として並んでいることがある (O'Reilly 系で頻発)。`extract-epub.mjs` の `convertOReillyNote` で `<p>` regex に word boundary がないと `<pre>` まで誤マッチし、各 `<code>` が個別バッククォートに展開されて以下のような断片化が起きる:

```
> `def` `allocate``(``line``:` `OrderLine``,` `repo``:` `AbstractRepository``)` `->` `str``:`
```

**自動検出**:

```bash
node scripts/check-code-fragments.mjs docs/en/*.md
```

exit 1 / 検出ありの場合:

- 検出された行を EPUB 内の対応 XHTML で確認 (`unzip -p docs/<book>.epub OEBPS/<file>.html | grep -A2 <近傍テキスト>`)
- 元構造が `<pre>...<code>...</code></pre>` であれば、本来 fenced code block (` ```language ``` `) として抽出されるはず
- `extract-epub.mjs` の `convertOReillyNote` (regex `<p\b[^>]*>`) と `<pre>` 子要素対応を確認

代表的なバグパターン:
- `convertOReillyNote` の child regex が `<p[^>]*>` のままで `<pre>` を誤マッチ → `<p\b[^>]*>` に修正
- sidebar/Note 内 `<pre>` が child iteration の対象から漏れている → `<p|pre|ul|ol>` の alternation に追加

## 進め方

1. `docs/en/<file>.md` を冒頭から末尾まで通読
2. EPUB の対応 XHTML を `unzip -p docs/<book>.epub OEBPS/<file>.html` で抽出して比較
3. 軽微な問題は直接 `docs/en/<file>.md` を修正
4. 構造的不具合は `extract-epub.mjs` 改修 follow-up チケットを起票
5. 修正観点と件数を bd notes に記録 (例: `"#3 missing image: foo.jpg, #5 figurecaption 3件追加, #8 watermark 2行除去, #9 anchor 漏れ 4件 inject"`)
6. `bd close <ticket_id> --reason "proof:epub-en passed (10/10)"` を実行

---

# Proof:EN-JA 11 項目チェックリスト

訳文 (`docs/ja/*.md`) の品質校正用 8 項目。`Proof-EN-JA Agent` が **Translation Agent とは別プロセスで初見** で読みながら使用する。確認バイアスを排除するため、自分が訳したのではないと意識する。

## 観点

### 1. 訳漏れなし

原文の段落・見出し・リスト項目が**全て訳出**されているか。

```bash
# 段落数の比較 (粗いが目安)
en_p=$(grep -cE '^[^#`>|*-]' docs/en/<file>.md)
ja_p=$(grep -cE '^[^#`>|*-]' docs/ja/<file>.md)
echo "en: $en_p, ja: $ja_p"
```

差異が大きい場合は手動で en/ja を並べて比較。

### 2. 誤訳なし

以下の誤読パターンに注意:

- **主述の誤り**: 主語と動詞の対応
- **否定の見落とし**: `not`, `no`, `never`, 二重否定
- **複数形/単数形**: `s` の有無で意味が変わる用語
- **受動態**: `be done` を能動的に訳していないか
- **専門用語**: 文脈に合った訳になっているか (用語集に従う)
- **冠詞**: `a/the` の使い分けで意味が変わるケース
- **時制**: 過去・現在・現在完了の訳し分け

### 3. 用語一貫性

`docs/ja/_glossary.md` 記載の用語が章内で**統一表記**されているか。

```bash
# 用語集にある用語が章でどう訳されているか確認
while IFS='|' read -r en ja; do
  count=$(grep -c "$ja" docs/ja/<file>.md || echo 0)
  echo "$en -> $ja: $count occurrences"
done < <(grep -E '^\| ' docs/ja/_glossary.md | tail -n +2)
```

ブレ (例: 「モジュール」と「モジユール」) を一括置換で修正。

### 4. 文体: である調統一

```bash
grep -nE 'です。|ます。|だろう。|でしょう。|ますね' docs/ja/<file>.md
```

ゼロ件であること。混入していたら **である調**に書き換え:

| NG | OK |
|---|---|
| 〜である**です** | 〜である |
| モジュール**です** | モジュールである |
| 設計**します** | 設計する |
| 良い**でしょう** | 良いだろう / 良い |

### 5. Markdown 構造

見出しレベル・リスト・表・画像 alt が原文と完全一致しているか:

```bash
diff <(grep -E '^#+' docs/en/<file>.md) <(grep -E '^#+' docs/ja/<file>.md)
diff <(grep -cE '^\| ' docs/en/<file>.md) <(grep -cE '^\| ' docs/ja/<file>.md)
diff <(grep -cE '^- |^\d+\.' docs/en/<file>.md) <(grep -cE '^- |^\d+\.' docs/ja/<file>.md)
```

差異があれば修正。

### 6. 図表参照

「図N.N」「表N.N」「第N章」「付録N」の表記が章内で**統一**されているか。原文の `Figure N.N` / `Table N.N` / `Chapter N` / `Appendix N` がそのまま残っていないか:

```bash
grep -nE 'Figure [0-9]|Table [0-9]|Chapter [0-9]|Appendix [A-Z]' docs/ja/<file>.md
```

### 7. 原文維持

以下は**訳していない**ことを確認:

- コードブロック ` ```sql ... ``` ` 内
- SQL の予約語・関数名・カラム名・テーブル名・属性名
- 書名 (例: *Database Modeling and Design* はそのまま)
- 著者名・出版社名
- URL
- 学術論文の Title

```bash
# コードブロック内に日本語がないか確認 (粗い)
sed -n '/^```/,/^```/p' docs/ja/<file>.md | grep -P '[\p{Hiragana}\p{Katakana}\p{Han}]' | head
```

### 8. 数値・年号

数値・日付・パーセント・URL が原文と一致しているか:

```bash
diff <(grep -oE '[0-9]+(\.[0-9]+)?(%|[年月日])?' docs/en/<file>.md | sort -u) \
     <(grep -oE '[0-9]+(\.[0-9]+)?(%|[年月日])?' docs/ja/<file>.md | sort -u) | head
```

### 9. 日本語表現の自然さ

英語からの逐語訳が残って **日本語として不自然** な箇所がないか。原文忠実度より **読み心地** を優先する観点。観点 1〜8 (原文整合) をクリアした訳文に対して、訳文を主役にして批判的に読み直す。

#### 9.1 直訳臭の除去

英語構文を引きずった日本語は読みにくい。

| NG (直訳) | OK (自然) |
|---|---|
| 〜を持っている (have) | 〜がある / 〜を備える / (主語省略+「ある」) |
| 〜を作る (make/create) | 〜を生成する / 〜を構築する / 〜を組み立てる |
| 〜することができる (can) | 〜できる |
| 〜することが可能 | 〜できる / 〜可能となる |
| それは〜である / それらは | (主語省略) |
| 〜のうちの1つ (one of) | 〜の1つ |
| 視覚的プレースホルダー (visual placeholder) | 仮置きの図 / 見本の◯◯ |
| 〜を提供する (provide) | (文脈で「〜する」「〜を担う」) |
| 〜を含める (include) | (文脈で「〜も」「〜にも当てはまる」) |
| 〜を保存する (store) | (永続化用語以外なら「管理する」「保持する」) |

**形容詞的カタカナ語+名詞**: 「視覚的XXX」「論理的XXX」のような英語直訳調 (e.g., visual placeholder, logical separation) は名詞化または訳語の選び直しを検討。「見本のXXX」「論理を分離した」など。

**循環表現の検出**: 同じ概念を主語と述語で繰り返す英語的表現は不自然になる。例: "place an order → that the order gets placed" を「注文を発注したら注文が発注される」と訳すと冗長。「その発注が確実に完了する」のように主語を変える。

**抽象的すぎる主語**: "things can fail" を「ものが独立して失敗できる」のように訳すと曖昧。具体化して「個々のサービスが独立して失敗できる」のようにする。

#### 9.2 用語の現代的妥当性

旧字・誤読される漢字熟語が混入していないか:

- "後付" (× 古語的・不明瞭) → "巻末" (○ 現代慣用)
- "前付" の使用は良いが、文脈によって "前書き" / "まえがき" の方が自然
- カタカナ業界用語と漢語の混在は1章内で統一する (例: "ディスパッチャ" と "派遣機構" を混用しない)
- 章内・節内で同じ概念に異なる訳語が当たっていないか (用語集と異なるブレ)

#### 9.2b 重複・冗長表現

異なる種類の **重複** が混入していないか:

- **副詞重複** (英語の二重強調): "ぜひとも〜を強くお勧めする" → どちらか一方を削る
- **同義語重複**: "オンライン家具販売 EC 企業" (EC=オンライン販売) → "家具を扱うオンライン EC 企業" / "2 種類のテストタイプで共有" (タイプ=種類) → "2 種類のテストで共有"
- **重複動詞**: "出荷して発送する" / "保存して格納する" 等は片方に統一
- **強調語重複**: "本当に深く理解する" / "極めて非常に〜" 等の二重強調を避ける

英語の "in order to ensure that..." のような冗長な前置きが残っていることもあるので、論理を変えずに簡潔化できないか確認する。

#### 9.3 助詞・指示語のてにをは

- 助詞重複 (例: 「〜が〜を〜が」)
- 「これ・それ・あれ」「この・その・あの」が何を指すか曖昧
- 「は」と「が」の使い分け (主題 vs 主格)
- 「を」「に」「で」の取り違え (動詞との相性)

#### 9.4 文の長さ・読点

- 1文 80字超 → 分割を検討
- 読点なしの長文、または読点が4つ以上連続する過密
- 英文 1 sentence をそのまま 1 日本語文にしているケースは要分割

#### 9.5 主述ねじれ・係り受け曖昧

- 主語と述語のねじれ (例: 「〜は〜であることを述べた」)
- 修飾語が複数の被修飾候補を持つ曖昧さ
- 否定の係り先が曖昧

#### 9.6 検出 grep ヒューリスティクス

```bash
# 直訳臭の候補
grep -nE "を持っている|を持つ。|を作る。|それは.*である|それらは|することができる|することが可能" docs/ja/<file>.md
# 形容詞的カタカナ + 名詞 (英語直訳調)
grep -nE "視覚的[ァ-ヶー]|論理的[ァ-ヶー]|物理的[ァ-ヶー]" docs/ja/<file>.md
# 副詞重複・強調重複
grep -nE "ぜひとも.*強く|ぜひ.*ください|本当に.*深く|極めて.*非常に" docs/ja/<file>.md
# 過長文 (1 文 80 字超)
awk -F'。' '{ for (i=1; i<NF; i++) if (length($i) > 80) print FILENAME":"NR": "$i"。" }' docs/ja/<file>.md
# 助詞重複 (連続する同一助詞)
grep -nE "(が|を|に|で|と|も|の|は|から|まで)\1" docs/ja/<file>.md
# 旧字・誤訳候補
grep -nE "後付|然して|然し|嘗て|斯く" docs/ja/<file>.md
```

grep はあくまで **候補抽出**。最終判断はエージェントの裁量。修正は notes に「#9 候補N件中M件修正」と件数を記録。

#### 9.7 通読パスの推奨

機械的な grep だけでは循環表現や主述ねじれは検出しにくい。重要章 (preface / introduction / 各章の冒頭2-3節 / Conclusion) は **冒頭から末尾まで通読** して以下の観点で判断:

- 1 段落読んだら「自然な日本語として読めるか」自問
- 主述・係り受けが曖昧な文を見つけたら一度声に出してみる
- 同じ語の重複が短い区間で2回以上出ていないか確認
- 英語版を見ずに日本語だけで意味が通るか確認 (主語が不明確だと不通になる)

### 10. 内部リンクの機能確認

サイト上でクリックできない死リンクが残っていないかを確認する。

**チェック項目:**

1. **xhtml 残存ゼロ**: `grep -nE '\]\([a-z0-9_-]+\.x?html' docs/ja/*.md` が 0 件
2. **アンカー定義**: 本文中で参照される `[テキスト](#anchor)` の `#anchor` が同一ファイル内 (または別 MD) で `<a id="anchor"></a>` または見出しの `{#anchor}` として定義されている
3. **画像直前の anchor 注入**: figure 参照 (`[図N-N](#fig_id)`) のリンク先が画像直前の `<a id="fig_id"></a>` に対応している
4. **table 直前の anchor + caption 注入**: table 参照 (`[表N-N](#tbl_id)`) のリンク先が table 行直前の `<a id="tbl_id"></a>` に対応し、その上に caption 行 `*Table N-N. ...*` がある
5. **見出しの `{#id}` 注入**: section 参照 (`[セクション名](#sect_id)`) のリンク先が見出し行末尾の `{#sect_id}` に対応している
6. **sidebar の anchor 注入**: sidebar 参照 (`[コラム名](#sidebar_id)`) のリンク先が `> **コラム名**` blockquote 直前の `<a id="sidebar_id"></a>` に対応している
7. **脚注の双方向リンク**: 本文中の `<sup>1</sup>` 風要素 (= `<sup><a id="X-marker"></a>[1](./Y.md#X)</sup>`) と章末の脚注リスト (`[1](./Y.md#X-marker)`) が双方向につながる

**自動検証:**

```bash
node scripts/fix-internal-links.mjs           # 必要に応じて xhtml ref を修正
node scripts/inject-anchors.mjs                # 漏れた id を補完
node scripts/check-links.mjs                   # errors=0 必須
```

**手動検証**: VitePress dev server (`npm run dev`) で章間ジャンプ・図表アンカー・脚注・sidebar を 5 件以上抜き打ちクリック確認。

**修正方針**:
- xhtml ref 残存があれば `fix-internal-links.mjs` を再実行
- アンカー定義が漏れていれば `inject-anchors.mjs` を再実行 (idempotent なので安全)
- 見出しレベルが en と不一致で position 照合が skip された章は、見出しレベルを en に合わせて再生成
- `[テキスト](URL)` の **テキスト** (リンクラベル) が訳されていなければ訳す (URL 部分は触らない)

### 11. コードブロック整合

翻訳エージェントが ` ```language ``` ` フェンス済みコードブロックを誤って分解し、` `def` `allocate` `(` `line` `:` ` のような単一バッククォート inline code の連なりに変換してしまうことがある (LLM の出力ゆらぎ)。

**自動検出**:

```bash
# 1) en/ja でフェンス件数が一致するか
grep -c '^```' docs/en/<file>.md
grep -c '^```' docs/ja/<file>.md      # 値が一致しなければ要修正

# 2) 断片化 inline code がゼロか
node scripts/check-code-fragments.mjs docs/ja/<file>.md
```

**修正方針**:
- 断片化が検出されたら、対応する `docs/en/` のフェンス済みコードブロックを `docs/ja/` にそのままコピーし直す
- コードブロック内のコメント (`# ...`) は英語原文のまま維持 (訳さない)

## 進め方

1. `docs/en/<file>.md` と `docs/ja/<file>.md` を**並べて**対比 (両方を上から順に読み比べる)
2. 観点 1〜11 を順に確認
3. 問題箇所は `docs/ja/<file>.md` に**直接修正**
4. 修正観点と件数を bd notes に記録 (例: `"#2 誤訳 3 件 (受動態 2, 複数形 1), #3 用語不一致 2 件, #4 です・ます 1 件, #10 死リンク 5 件"`)
5. `bd close <ticket_id> --reason "proof:en-ja: <観点>×<件数> 修正"` を実行

## 大量誤訳が発見された場合

`docs/ja/<file>.md` の 30% 以上に問題があるなら、translation チケットを reopen して再翻訳依頼:

```bash
bd reopen <translation_ticket_id> --reason "proof で大量誤訳発見、再翻訳依頼"
bd note <translation_ticket_id> "問題箇所: [list]、再翻訳時の注意: [...]"
```

---

# 再校正パターン (extract-epub.mjs 改修後の対応)

`extract-epub.mjs` を改修した場合、すでに翻訳済みの章にも影響が及ぶため、**独立した再校正バッチ**を起票する。改修が積み重なるプロジェクトでは v1 → v2 → v3 のように複数バージョンの再校正バッチが立つことがある。

## 原則

1. **既存 epic に追加しない**: 既に閉じた epic (例: `dmrb-vol1-eqg`) を reopen せず、独立した再校正 epic を立てる
2. **章ごと 1 チケット**: 全章をまとめて 1 チケットにせず、章ごとに分割 (再開可能性確保)
3. **バージョン番号付きラベル**: `proof:epub-en-v2` / `proof:epub-en-v3` のように label で識別
4. **proof:en-ja には影響させない**: 構造校正と訳文校正は分離

## チケット構造

```
Reproof Epic v2 (独立)
├─ 再校正(EPUB-EN v2): 01_foreword.md  [proof:epub-en-v2]
├─ 再校正(EPUB-EN v2): 02_acknowledgments.md
├─ ...
└─ 再校正(EPUB-EN v2): NN_<last-chapter>.md
```

## 起票スクリプトのパターン

通常の `scripts/gen-tickets.mjs` を `scripts/gen-reproof-v<N>-tickets.mjs` にコピーして再校正専用の構造に書き換える。最小構成は以下:

```javascript
// gen-reproof-v<N>-tickets.mjs
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const VERSION = 2;  // または 3
const REASON = 'extract-epub.mjs 改修: figurecaption 取り込み + Note 型拡張';

const enFiles = readdirSync('docs/en')
  .filter(f => /^\d{2}_.*\.md$/.test(f))
  .sort();

// Epic 起票
const epicArgs = [
  'create',
  '--title', `再校正 (EPUB-EN v${VERSION}): extract-epub.mjs 改修追従`,
  '--description', `## 改修内容\n${REASON}\n\n## 対象\n全 ${enFiles.length} 章を v${VERSION} で再校正する。`,
  '--type', 'epic',
  '--priority', '2',
  '--labels', `proof:epub-en-v${VERSION},translation,epic`,
  '--silent',
];
const epicId = spawnSync('bd', epicArgs, { encoding: 'utf-8' }).stdout.trim().split('\n').pop();

// 各章チケット
for (const f of enFiles) {
  const args = [
    'create',
    '--title', `再校正(EPUB-EN v${VERSION}): ${f} 抽出 MD の構造校正`,
    '--description', `extract-epub.mjs ${REASON} に対応するため、${f} を v${VERSION} で再校正する。\n\n## 観点\n[8 項目チェックリスト + 改修箇所に特化した追加観点]`,
    '--type', 'task',
    '--priority', '2',
    '--labels', `proof:epub-en-v${VERSION},translation`,
    '--parent', epicId,
    '--silent',
  ];
  spawnSync('bd', args, { encoding: 'utf-8' });
}
```

## 改修パターンのありがちな例

extract-epub.mjs の改修は **1 ファイル内の 5〜30 行レベルの微修正**でも、出力 MD の差分が章をまたいで広範囲に出るため、再校正バッチが必要になりやすい。よく観察される改修と再校正トリガ:

| 改修内容 | 影響範囲 |
|---|---|
| `figurecaption` / `tablecaption` 取り込み漏れ修正 | 図表のある全章 |
| Note 型の拡張 (`<div class="feature">` 等のサブクラス対応) | 注のある章 |
| `tablecaption` 即 push (重複出力の修正) | 表のある章 |
| `listnumbered` の二重番号防止 | 番号付きリストのある章 |
| Note 内の四重 bold 剥がし (`> ****Title****`) | 見出しに強調のある Note |
| caption の italic+bold 混在防止 | キャプションのある章 |
| 透かしテキスト (`OceanofPDF.com` 等) の除去 | 全章 |
| 段落結合バグ (改行欠落) の修正 | 該当する spine の章のみ |
| **内部 xref 変換 (`xxx.xhtml` → `./<NN_slug>.md`)** | 章間リンクのある章 (大半) |
| **figure / table / heading id 保持** (`{#id}` / `<a id="..."></a>`) | 図・表・章 id 参照のある章 |
| **`<table>` placeholder 化 (nested `<td><div>` 対応)** | trade-offs 等の複雑表のある章 |
| **`<figure>` を tagAlt に追加 (nested `<div class="figure">` 対応)** | 章冒頭 figure のある章 |
| **`<aside data-type="sidebar">` placeholder 化** | sidebar が多数ある章 (nested div で外側 chapter div の早期 close を回避) |
| **`<div data-type="example">` placeholder 化 (depth-aware)** | コード例題のある章 (sidebar 内 nested 対応) |
| **`<div data-type="warning\|note\|tip\|caution\|important">` placeholder 化** | warning / note / tip 系がある章 |
| **sidebar h5 タイトル抽出順の修正** | sidebar のある章 |
| **sup ref 双方向リンク復元** | 脚注のある章 |
| **callout `(N)` の `<a id="callout_...">` 保持** | コードブロック callout のある章 |

## 再校正フローの判断

| 改修の規模 | 対応 |
|---|---|
| 1〜2 章だけ影響 | 該当章のみ追加 proof:epub-en チケット起票 |
| 全章に広範な影響 | 再校正バッチ epic (proof:epub-en-v<N>) を起票 |
| 訳文に影響なし (en/ のみ) | proof:en-ja は再走させない |
| 訳文の見出しレベル/構造に影響 | proof:en-ja-v<N> も追加で起票 |

## proof:en-ja への伝播

extract-epub.mjs の改修が `docs/en/<file>.md` の **訳に影響する変更** (見出し追加・段落追加・構造変更) を含む場合:

1. 影響を受ける章を `git diff docs/en/` でリストアップ
2. 該当章の translation チケットを再開して翻訳追加
3. または、小さな変更なら proof:en-ja を再起票して訳文側で吸収

## 履歴管理

extract-epub.mjs の主要改修はコミットメッセージに `extract-epub: v2 改修` と明記し、`bd note <reproof_epic_id>` にもコミット SHA を記録。後から「なぜこの再校正バッチがあるのか」を追跡可能に。

## extract-epub 改修以外の再校正トリガー

「既存の翻訳済みデータに対して横断的な再校正パスを走らせる」必要があるのは extract-epub.mjs の改修だけでない。以下の場合も独立 epic として再校正バッチを切る:

- **図表マッピング再校正**: Setup-A (図表マッピング作成) + Setup-B (不足画像抽出) + 全章 (図表参照を見直す proof:en-ja-figure) を 1 epic に
- **用語集の大改訂**: `_glossary.md` を後から大幅追加・整理した場合、既訳全章を新用語で grep して書き直すバッチ
- **スタイルガイド変更**: である調 → ですます調への切替など、文体方針を後から変えた場合の全章書き直しバッチ

いずれも「再校正専用 epic + 章ごと 1 チケット + 専用ラベル (例: `proof:figure-v1`, `proof:terms-v1`)」というパターンは共通。

## 検証

再校正バッチ完了後:

```bash
# v2 ラベルの全チケットが closed か
bd list --all --label proof:epub-en-v2 --status closed | wc -l
bd list --all --label proof:epub-en-v2 | wc -l
# (両方一致すれば全完了)

# extract-epub.mjs を再実行しても docs/en/ に変化がないことを確認
node scripts/extract-epub.mjs
git diff docs/en/   # (空であれば idempotent OK)
```
