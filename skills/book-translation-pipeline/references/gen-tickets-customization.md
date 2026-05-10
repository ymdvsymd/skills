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
