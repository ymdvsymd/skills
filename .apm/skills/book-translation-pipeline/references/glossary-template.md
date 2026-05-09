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
