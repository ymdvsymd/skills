# Templates (filename conventions / glossary / styleguide)

翻訳プロジェクトの初期化時に使うテンプレート群。

- **Filename Conventions**: docs/en と docs/ja の 1 対 1 対応ファイル名規則
- **Glossary Template**: 用語集 (docs/ja/_glossary.md) の雛形
- **Styleguide Template**: 翻訳スタイルガイド (docs/ja/_styleguide.md) の雛形

---

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

---

# 用語集 (`docs/ja/_glossary.md`) テンプレート

翻訳全体で使用する用語の英→日対応表。Setup s2 で確定し、translation/proof フェーズの全エージェントが厳守する。

## 基本構造

```markdown
# 用語集 — <書籍名>

本書の翻訳で使用する用語の英→日対応。**翻訳前に必ず参照し、表記を統一する**。

## 章タイトル

| EPUB stem (en/) | 章番号 | 日本語タイトル |
|---|---|---|
| `01_foreword` | — | 序文 (Foreword) |
| `04_introduction` | 第1章 | はじめに |
| `05_manufacturing` | 第2章 | 製造業 |
| ... | ... | ... |

## 書誌構造用語 (全書籍共通)

書籍の構造を示す用語。**翻訳ブレが起きやすいので最初に表記を確定する**。"後付" のような旧字は使わず、現代日本の出版慣習に従う。

| English | 日本語 | 備考 |
|---|---|---|
| Front Matter | 前付 | 章番号なし扉部分の総称 |
| Back Matter | 巻末 | "後付" は誤用、現代の出版慣習では「巻末」 |
| Foreword | 序文 | 著者以外による紹介文 |
| Preface | まえがき | 著者によるはじめの言葉 |
| Introduction | 序章 / はじめに | 文脈で使い分け (本書独自の章扱いなら「序章」) |
| Epilogue | エピローグ / おわりに | |
| Acknowledgments | 謝辞 | |
| Appendix | 付録 | "Appendix A" → "付録A" |
| Bibliography | 参考文献 | |
| References | 参考文献 / 参照 | 文脈で使い分け |
| Index | 索引 | |
| Colophon | 奥付 | 印刷情報。O'Reilly 系では末尾 |
| Errata | 正誤表 | |
| Chapter | 章 | "Chapter N" → "第N章" |
| Section | 節 / セクション | 文脈で |
| Part | 部 | "Part I" → "第I部" |

## 共通技術用語

| English | 日本語 | 備考 |
|---|---|---|
| module | モジュール | カタカナ統一 |
| interface | インターフェース | 「インタフェース」と表記揺れしない |
| abstraction | 抽象 | 名詞、動詞 abstract → 抽象化する |
| ... | ... | ... |

## 書籍固有用語 (ジャンル別)

### 〈カテゴリ A〉

| English | 日本語 | 備考 |
|---|---|---|
| ... | ... | ... |

### 〈カテゴリ B〉

| ... | ... | ... |
```

## 書籍ジャンル別の用語カテゴリ

### 一般技術書 (a-philosophy 系)

- 設計概念: complexity, dependency, obscurity, modularity, abstraction
- モジュール論: deep/shallow module, information hiding, leakage
- 戦術/戦略: tactical/strategic programming
- 命名: naming, choosing names
- コメント: comments, documentation
- パフォーマンス: performance, optimization

### データモデリング書 (DMRB 系)

- データモデリング基本: Entity, Attribute, Relationship, Cardinality, Surrogate Key, Primary Key, Foreign Key
- パーティと組織: Party, Person, Organization, Role, Contact Mechanism, Address
- 製品: Product, Supplier, Inventory Item, Stock Keeping Unit (SKU)
- 注文と出荷: Order, Order Item, Shipment, Agreement, Quote
- 請求と会計: Invoice, Payment, Budget, General Ledger
- データウェアハウス: Star Schema, Fact Table, Dimension, Measure, Aggregation

### Vol2 業界別追加カテゴリ

- 製造業 (Manufacturing): BOM, Work Order, MRP, Production Line, Raw Material
- 通信業 (Telecommunications): Subscriber, Billing Cycle, Line Item, Service Offering, Call Detail Record
- ヘルスケア (Health Care): Patient Encounter, Diagnosis, Procedure, Provider, Medical Record
- 保険 (Insurance): Policy, Claim, Beneficiary, Premium, Coverage, Underwriting
- 金融サービス (Financial Services): Account, Transaction, Securities, Portfolio, Holding
- プロフェッショナルサービス: Engagement, Time Entry, Billable Hour, Deliverable
- 旅行業 (Travel): Itinerary, Reservation, Fare, Leg, Segment, Traveler
- E-Commerce: Cart, Checkout, Web Visit, Session, Click Stream

### Vol3 パターン別カテゴリ

- ロール: Role, Role Type, Party Role
- 階層: Hierarchy, Aggregation, Peer-to-peer Relationship
- 型/カテゴリ: Type, Category, Classification
- ステータス: Status, Status Type, State Transition
- ビジネスルール: Business Rule, Constraint, Derivation Rule

## 用語選定の指針

1. **既存翻訳との一貫性**: シリーズもの (DMRB Vol1→Vol2→Vol3) では Vol1 由来の用語を継承
2. **業界標準語の優先**: 翻訳業界・学術出版で定着している訳語を優先 (例: Entity → エンティティ、模型 ではなく)
3. **カタカナ vs 漢字**: 技術用語は原則カタカナ、抽象概念は漢字 (例: モジュール / 抽象)
4. **複合語の扱い**: 「データモデル」「データウェアハウス」のように原語が複合の場合は中黒なし
5. **曖昧さ排除**: 同じ英単語が複数の意味で使われる場合、文脈別に訳語を分ける (例: relationship → リレーションシップ / 関連)

## 用語追加・改訂のフロー

翻訳中に用語集にない重要語が出たら:

1. Translation Agent が `bd note <translation_ticket_id> "用語集追加候補: foo → フー (出現箇所: 章N section X)"`
2. 翻訳完了後 (proof:en-ja 前)、Orchestrator が用語集追加チケットを起票:
   ```
   bd create --title "_glossary.md 追加: foo → フー" \
              --type task --priority 2 --labels "glossary,setup"
   ```
3. 用語集に追記したら、影響を受ける既訳ファイルを `grep -l 'foo' docs/ja/*.md` で抽出し、必要なら一括置換チケット起票

## 検証

```bash
# 用語集に登録されている全用語が章で使われているかカウント
grep -E '^\| ' docs/ja/_glossary.md | tail -n +3 | while IFS='|' read -r _ en ja _; do
  en_clean=$(echo "$en" | xargs)
  ja_clean=$(echo "$ja" | xargs)
  total=$(grep -l "$ja_clean" docs/ja/*.md 2>/dev/null | wc -l)
  printf "%-40s -> %-30s : %d files\n" "$en_clean" "$ja_clean" "$total"
done
```

---

# スタイルガイド (`docs/ja/_styleguide.md`) テンプレート

翻訳全体の文体・Markdown 規約。Setup s3 で確定し、translation/proof フェーズの全エージェントが厳守する。

## 基本構造

```markdown
# スタイルガイド — <書籍名>

本書の翻訳で守るべき文体・Markdown 規約。

## 文体

### である調 (絶対)
- 文末は「である」「だ」で終える
- 「です」「ます」「だろう」「でしょう」**禁止**
- 検証: `grep -nE 'です。|ます。|だろう。|でしょう。' docs/ja/*.md` がゼロ件

### 人称
- 一人称: 「我々」または主語省略
- 二人称: 「あなた」または主語省略
- 三人称: 主語を明示 (例: 「設計者は…」)

## Markdown 規約

### 構造保持
- 見出しレベルは原文と完全一致 (`#`〜`####`)
- リスト記号も統一 (英語が `-` なら日本語も `-`)
- 表のカラム数・順序は原文通り

### 水平線 (`---`) を見出しの区切りに使わない
- VitePress デフォルトテーマは `<h2>` に `border-top` を引く。見出しの直前/直後に `---` (水平線) を置くと、その境界線と `<hr>` が重なって**線が二重に表示される**
- セクションの区切りは見出しそのものに任せ、`---` を挿入しない。これは章ファイルだけでなく `_glossary.md` / `_styleguide.md` 等の補助ファイルでも同じ
- 検証: `node scripts/check-structure-parity.mjs` の C10 (hard) が見出しに隣接した `---` を検出する

### コードブロック
- 訳さない (SQL / カラム名 / テーブル名 / 属性名 / 関数名 を維持)
- 言語タグ (` ```sql` `) は保持
- コメントが日本語化されている場合のみ訳す (慎重に)

### インライン書式
- `**bold**` / `*italic*` / `<sup>` / `<sub>` は原文通り
- 内部の `*` `**` のエスケープに注意

### 画像参照
- `![alt](../images/foo.jpg)` の `alt` 属性は訳す
- パス (`../images/foo.jpg`) はそのまま

### リンク
- **内部リンク (xref / figure / table / sidebar / 脚注)**:
  - リンク URL は **`./<NN_slug>.md#anchor`** 形式 (`extract-epub.mjs` が EPUB の xhtml ref を自動正規化)
  - `xxx.xhtml#anchor` 形式はサイト上で解決されないので残してはいけない
  - 図表アンカー定義は `<a id="X"></a>` (figure / table 直前) または見出しの `{#X}` で
  - 翻訳時はリンクテキスト (本文中の `[テキスト]`) のみ訳し、URL 部分は触らない
  - 漏れがある場合は `scripts/fix-internal-links.mjs` と `scripts/inject-anchors.mjs` で補完 (Final フェーズ)
- 外部リンク: URL はそのまま、リンクテキストは訳す
- 参考文献の書誌情報は原文のまま

### サイドバー / コラム

- サイドバーは EN 側 `> **Sidebar: <title>**`、JA 側 **`> **コラム: <title>**`** に統一する。本文の全行を `>` で囲む (裸段落・`##### title`・別行 `コラム` 等の揺れた書式を使わない)
- Recap 系サイドバーの小見出し (`<dt>` 由来) は `> **小見出し**` として EN と同数保持する
- 空の引用区切り行は bare `>` (末尾スペースなし)。`> ` (末尾スペース) は markdownlint MD009 違反

### markdownlint (MD009 / MD028)

- 行末スペース禁止 (MD009)。ハードブレイクが要る箇所のみスペース 2 個 (1 個 / 3 個以上は違反)
- blockquote (`>`) ブロックの間に空行を挟まない (MD028)。連続する引用は空行なしで繋ぐ
- 検証: `node scripts/check-structure-parity.mjs <file>.md`

## 図表参照表記

| 原文 | 訳 |
|---|---|
| Figure N.N | 図N.N |
| Table N.N | 表N.N |
| Chapter N | 第N章 |
| Section N.N | N.N 節 |
| Appendix A | 付録A |
| Equation N.N | 式N.N |

## 原文維持

以下は**訳さない**:

- 書名 (例: *Database Modeling and Design*)
- 著者名 (例: Len Silverston, John Ousterhout)
- 出版社名 (例: Wiley, Yaknyam Press)
- ISBN
- 学術論文タイトル (引用部)
- URL
- ソフトウェア名・製品名 (例: PostgreSQL, MySQL)
- プログラミング言語名・キーワード

## 句読点

- 句点: 「。」 (全角)
- 読点: 「、」 (全角)
- 引用符: 「」 (全角)
- 強調引用: 『』 または太字 `**...**`
- 中黒: 「・」 (全角)
- 半角・全角混在は原則回避 (例: `1.0` のような数値はそのまま、本文中の数字は文脈次第)

## 数値・単位

- アラビア数字を原則維持 (例: 「3 つの」「10 個」)
- パーセント: `%` のまま
- 単位: 半角 (例: `100ms`, `1GB`)
- 桁区切り: 原文の `,` を維持 (例: `1,000`)

## カタカナ表記

- 長音記号「ー」は使う (例: 「サーバー」「データベース」)
- ただし業界慣例で短く済ませる用語は短く (例: 「マネージャ」 vs 「マネージャー」)
- 外来語は基本カタカナ、技術用語は `_glossary.md` 準拠

## 用語の訳し分け

- `system` → 「システム」(技術文脈) / 「制度」(社会文脈)
- `application` → 「アプリケーション」(ソフトウェア) / 「適用」(動詞)
- `data` → 「データ」 (常にカタカナ、複数形扱いせず単数として訳す)

## 校正観点 (proof:en-ja 12 項目)

詳細は book-translation-pipeline skill の `references/proof-checklists.md` の Proof:EN-JA 12 項目を参照:

1. 訳漏れなし
2. 誤訳なし
3. 用語一貫性 (`_glossary.md` 準拠)
4. である調統一
5. Markdown 構造一致 (見出しレベル列・番号リスト項目数)
6. 図表参照統一
7. 原文維持 (コードブロック、書名等)
8. 数値・年号一致
9. 日本語表現の自然さ (直訳臭・冗長・てにをは・主述ねじれ)
10. 内部リンクの機能確認
11. コードブロック整合 (フェンス断片化なし)
12. 構造パリティ (機械検査: サイドバー個数・コードフェンス・見出しレベル = hard、markdownlint / 番号リスト / Recap小見出し = warn)
```

## カスタマイズポイント

書籍ジャンルにより以下を調整:

- **学術書/教科書**: 「である」を強める (「だ」より「である」推奨)
- **実用書/啓発書**: 「だ」を許容、「である」と混在可
- **エンジニア向け**: 「だろう」「思われる」を控え、断定的に
- **入門書**: 漢字を控えめに、平易な表現

## バージョン管理

- スタイルガイドが翻訳途中で変わると、既訳の修正が必要になる
- 大きな変更は `bd create --title "_styleguide.md 改訂: <観点>"` でチケット化し、影響範囲を可視化
- 用語集 (`_glossary.md`) との整合性を保つ
