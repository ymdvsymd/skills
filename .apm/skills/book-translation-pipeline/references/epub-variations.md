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
