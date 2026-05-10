# ファイル名規則と不変条件

## 核心の不変条件

```
EPUB spine 順 == FILENAME_MAP の値の NN 順 == docs/en/ ASCII ソート順 == docs/ja/ ASCII ソート順
```

これが守られることで:

1. `ls docs/en/` と `ls docs/ja/` の出力行を上から並べると、両ファイルが**同一行番号で1対1対応**する
2. VitePress サイドバーの自動生成や手書きが、ファイルソート順をそのまま使える
3. proof:en-ja 校正時に「同じ NN を持つ en/ja ペア」を機械的にチェックできる
4. EPUB を読みながら章番号通りに翻訳作業を進められる

## 命名規則

```
NN_kebab-case-title.md
└─┘ └────────────────┘
 │         │
 │         └─ 内容識別子: 小文字 + ハイフン区切り (kebab-case)。記号は `-` のみ。
 └─ 2 桁ゼロパディング連番 (01〜99)、EPUB spine 順を反映
```

例:
```
01_foreword.md
02_acknowledgments.md
03_about-the-author.md
04_introduction.md
05_chapter-one.md
...
22_appendix-i.md
23_other-resources.md
24_how-to-use.md
25_closing-notes.md
index.md           <- これは spine 順関係なくルート
```

## 特殊ファイル (ja/ にだけ存在)

`docs/ja/` には翻訳作業の補助ファイルを配置する。これらは **必ず `_` プレフィックス** で始める:

| ファイル | 役割 |
|---|---|
| `_glossary.md` | 用語集 (英→日 mapping、章タイトル一覧、書籍特有のターム) |
| `_styleguide.md` | スタイルガイド (である調、Markdown 規約、コードブロック扱い等) |
| `_sample.md` | Setup s4 で作成した翻訳サンプル + Go/No-Go 判定 |
| `_workflow.md` | プロジェクト固有のワークフローメモ (オプション) |
| `_comparison.md` | DeepL 等他翻訳との比較 (オプション) |
| `_errata.md` | 原文の誤りと訂正履歴 |
| `_figure-map.md` | 図のマッピング (再校正パスで使用、オプション) |
| `_proofread-report.md` | 校正フェーズの最終レポート |
| `_final-report.md` | プロジェクト完了レポート |

ASCII では `_` が `0`〜`9` より前に並ぶので、`ls docs/ja/` で `_*.md` がまとめて先頭に表示される。

## VitePress サイドバーから補助ファイルを除外

`docs/.vitepress/config.mts` の sidebar で `_*.md` をフィルタする:

```typescript
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

function chapterSidebar(lang: 'en' | 'ja') {
  const dir = join(__dirname, '..', lang);
  return readdirSync(dir)
    .filter(f => /^\d{2}_[a-z0-9-]+\.md$/.test(f))   // NN_*.md のみ
    .sort()
    .map(f => ({
      text: f.replace(/^\d{2}_|\.md$/g, ''),
      link: `/${lang}/${f.replace(/\.md$/, '')}`,
    }));
}
```

または、明示的に `_*.md` を除外:

```typescript
.filter(f => f.endsWith('.md') && !f.startsWith('_') && f !== 'index.md')
```

## 採番ガイドライン

EPUB の spine が以下の順だとして:

```
0. cover
1. title page
2. copyright
3. advance praise
4. table of contents
5. foreword
6. acknowledgments
7. about the author
8. chapter 1: Introduction
9. chapter 2: Manufacturing
...
```

これを `extract-epub.mjs` の `FILENAME_MAP` で以下のように採番:

```javascript
filenameMap: {
  '00_cover':           'index.md',      // ルート / hero ページに合流
  '01_title':           null,            // index.md に合流 (アペンド)
  '02_copyright':       'SKIP',          // 翻訳対象外
  '03_advance_praise':  'SKIP',
  '04_contents':        'SKIP',          // VitePress サイドバーで再現
  '05_foreword':        '01_foreword.md',     // 出力 NN は本編開始前から 01〜
  '06_acknowledgments': '02_acknowledgments.md',
  '07_about_author':    '03_about-the-author.md',
  '08_chapter_1':       '04_introduction.md',  // 第1章 = NN 04
  '09_chapter_2':       '05_manufacturing.md',
  // ...
}
```

**ポイント**: spine の絶対位置 (`0`〜) ではなく、出力ファイルとして必要な spine 要素の順序で `01`〜`NN` を再採番する。`SKIP` した位置は欠番にせず、次の出力に詰める。

## 不変条件の検証

```bash
# 1. 命名規則の検証
ls docs/en/ docs/ja/ | grep -vE '^(index\.md|_[a-z-]+\.md|[0-9]{2}_[a-z0-9-]+\.md)$' | head
# (空であること)

# 2. en/ja の対応確認
diff <(ls docs/en/ | grep -E '^[0-9]{2}_') <(ls docs/ja/ | grep -E '^[0-9]{2}_')
# (差分なし、または ja に欠けているファイルだけ)

# 3. NN 順序の検証
ls docs/en/ | grep -E '^[0-9]{2}_' | sort -c
# (Already sorted の場合 silent、順序逆転があればエラー)
```

## 採番の規模感

通常の技術書なら章数 15〜30、補助ファイル (`_*.md`) は 3〜8 件程度に収まる。NN は `01`〜`99` まで対応するので、章数 99 までは2桁ゼロパディングで一貫した ASCII ソート順を保てる。100 章以上の長大書籍では NN を3桁 (`001_*.md`) に拡張する。
