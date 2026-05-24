# Phase 2: Source Research

素材調査の戦略。ソースの種類と規模を判定し、それに見合った調査手段を選ぶ。

## 規模判定の手順

1. ソースがディレクトリなら、まず `find <dir> -type f \( -name '*.md' -o -name '*.mdx' \) | wc -l` でファイル数を数える
2. URL なら、Read（WebFetch）で 1 件取得して長さを見る
3. 個別ファイル群なら、`wc -l` で各ファイルの行数を合算

判定基準：

| 規模 | ファイル数 / 総量目安 | 戦略 |
|---|---|---|
| 小規模 | 5 ファイル以下 / 累計 2,000 行以下 | 直接 Read で全読 |
| 中規模 | 5〜20 ファイル / 累計 2,000〜10,000 行 | 主要ファイル Read + `grep` で骨子把握 |
| 大規模 | 20 ファイル超 / 累計 10,000 行超 | **Explore subagent を 2〜4 並列** で観点別に分担 |

## 並列 Explore の使い方（大規模時）

### 観点割りのテンプレ

ソースのディレクトリ構成を見て、観点を 2〜4 個に分ける。よくあるパターン：

**パターン A: 技術 OSS ドキュメント**
- 観点 1: 概念・メンタルモデル（`concepts/`, `overview/`, `getting-started/`）
- 観点 2: 使い方ガイド（`consumer/`, `producer/`, `usage/`, `guide/`）
- 観点 3: 運用・統合（`enterprise/`, `integrations/`, `ci-cd/`, `deployment/`）
- 観点 4: リファレンス（`reference/`, `api/`, `cli/`）

**パターン B: 社内プロダクトドキュメント**
- 観点 1: アーキテクチャ・データモデル
- 観点 2: 機能仕様・ユースケース
- 観点 3: 運用手順・障害対応

**パターン C: ライブラリ・SDK**
- 観点 1: 設計思想・主要 API
- 観点 2: 使い方・サンプル
- 観点 3: 高度な機能・拡張

### Explore prompt テンプレ

各 subagent に渡すプロンプトは以下の構造で書く：

```
You're helping me write a 30-minute Japanese technical blog article about <TOPIC>.
I need you to read the documentation in <DIR> focused on <PERSPECTIVE>, and report
the most important and concrete material for a Japanese software engineer audience
who <READER PREMISE>.

Specifically, read these files:
- <file 1>
- <file 2>
- ...

For each file, report under 200 words:
1. What this lets a user accomplish (the actual problem)
2. The key commands/snippets with realistic examples
3. Non-obvious gotchas worth surfacing in a blog

Total under 3000 words. Prioritize concreteness — I will be quoting examples directly.
Don't summarize at a high level; quote actual commands, yaml, and frontmatter snippets.

Respond in English (I will translate to Japanese myself).
```

ポイント：
- **「Respond in English」と明示** ─ 並列 Explore は素材抽出が目的。日本語化は本体の執筆 phase で行うので、ここで翻訳されると質が落ちる
- **「quote actual commands」と明示** ─ 抽象的なサマリではなく、引用形式で取れる素材を集める
- **語数上限を明示** ─ 各 subagent の出力が肥大化すると本体コンテキストを圧迫する

### 並列起動

`Agent` ツールを **1 メッセージ内に複数 tool_use** で並列起動する。順次起動しない。

## 中規模・小規模の場合

中規模なら、ディレクトリ全体の `find` + 主要ファイル 5〜10 個を Read で読む。`grep` で特定キーワード（`primitive`, `lifecycle`, `policy` など）の出現箇所を絞り込んで、密度の高い部分だけ精読するのが効率的。

小規模なら全文 Read で問題ない。

## URL ソースの場合

WebFetch で取得する。記事 1 本程度なら直接 Read。複数ページにわたるドキュメントサイトなら、まずトップページの目次的なページを取得して、リンク先を 2〜4 並列で取得する。

## 調査完了後

調査結果（コマンド例・YAML 例・概念定義）を、執筆 phase で引用しやすい形でメモしておく。subagent からの返答は **そのまま記事に貼り付けない**（記事のトーンと文体に合わない）。あくまで素材として咀嚼してから執筆する。

### 重要: subagent の返答は素材であり、ソースではない

**subagent はハルシネーションする可能性がある**。固有のコマンド名・フラグ名・YAML フィールド名・数値・出力例を、ソース doc に書かれていないにも関わらず、もっともらしく作り出してしまうことがある。

本スキルの過去事例:

- subagent が `waza dev evals/.../eval.yaml --model claude-sonnet-...` と書いて報告したが、実際の `waza dev` は `[skill-path]` を引数に取り、`--model` は `--copilot` 非対話モード限定だった
- subagent が `waza compare --format detailed` というフラグを報告したが、実際の `--format` の値は `table` / `json` のみで `detailed` は存在しない
- subagent が「グレーダーは 11 種類」と報告したが、実際は `not implemented` マーク付きの除外計算で 12 種類だった (この事例は逆方向で、subagent の誤判定により記事の正しい記述が疑われた)

**Phase 5b (Fact Check) では subagent レポートではなく、必ず一次ソース** (引数で指定された md ファイル) を直接 grep して裏付けを確認すること。特に CLI コマンド・フラグ・数値・YAML フィールド・JSON 出力例は subagent 報告の中でハルシネーションが起こりやすい高リスク領域である。

Phase 2 で subagent から受け取った素材を執筆に流し込むときも、可能なら執筆と並行して `grep -rn 'waza dev' <source-dir>/` のような一次ソース確認をその場で行うのが理想。少なくとも Phase 5b では必ず確認する。
