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
