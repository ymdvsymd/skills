# 5 フェーズワークフロー (book-translation-pipeline)

> **agent-agnostic note**: 本書類で「Agent tool で spawn」「subagent」と書いている箇所は **Claude Code 固有の orchestration** を指す。Codex / Cursor / OpenCode 等の単一プロセス agent は、同じ `agents/<role>-agent.md` を inline prompt として読み込み、`proof:en-ja` は新規 CLI セッションで分離して実行する（context 混ざり防止）。

## 依存関係

```
            +---------+
            |  Setup  |  s1 -> s2 -> s3 -> s4 (直列)
            +----+----+
                 |
       +---------+---------+
       |                   |
       v                   v
+---------------+   +-------------+
| Translation   |   | Proof:      |   <- Setup と独立に並列実行可
| (各章 1 件)    |   |  EPUB-EN    |
+-------+-------+   +-------------+
        |
        v
+---------------+
| Proof: EN-JA  |   <- 対応 Translation の完了後
| (各章 1 件)    |
+-------+-------+
        |
        +---> Final (全 Translation + 全 Proof:EN-JA 完了後)
```

## 各フェーズの内訳

### Setup (s1 -> s2 -> s3 -> s4 直列、メインエージェント自身が担当)

| ID | 内容 | 担当 | acceptance |
|---|---|---|---|
| s1 | docs/ja/ ディレクトリ整備、VitePress サイドバー確認 | Orchestrator | docs/ja/index.md 表示、サイドバーに全翻訳ターゲット |
| s2 | docs/ja/_glossary.md 確定 (ジャンル別用語集) | Orchestrator | 主要用語が定義済み、章タイトル日本語訳あり |
| s3 | docs/ja/_styleguide.md 確定 (である調・コードブロック等) | Orchestrator | スタイルガイドが文書化 |
| s4 | _sample.md による翻訳品質確認 | Orchestrator が Translation Agent を 1 度 spawn | _sample.md 8 観点クリア、Go 判定 |

### Translation (各章 1 件、s4 完了が前提)

- **担当**: Translation Agent (`agents/translation-agent.md`) を担当（Claude Code: Agent tool で spawn / 他 agent: inline prompt）
- **依存**: setup s1〜s4 (`setupDeps`)
- **入力**: docs/en/<file>, docs/ja/_glossary.md, docs/ja/_styleguide.md
- **出力**: docs/ja/<file>
- **並列度**: 章ごとに独立、`bd ready` 順で消化

### Proof:EPUB-EN (各章 1 件、Setup と独立に並列実行可)

- **担当**: Proof-EPUB-EN Agent (`agents/proof-epub-en-agent.md`)
- **依存**: なし (setup を待たない、translation も待たない)
- **入力**: docs/en/<file>, docs/<book>.epub の対応 XHTML
- **出力**: docs/en/<file> 修正、必要なら extract-epub.mjs 改修 follow-up チケット
- **並列度**: 章ごとに独立。translation と並走可

### Proof:EN-JA (各章 1 件、対応 Translation 完了が前提)

- **担当**: Proof-EN-JA Agent (`agents/proof-en-ja-agent.md`) を**翻訳とは別 context** で担当（Claude Code: Agent tool で別 subagent として spawn / 他 agent: 別セッションで起動）
- **依存**: 対応する translation チケット (1:1)
- **入力**: docs/en/<file>, docs/ja/<file>, _glossary.md, _styleguide.md
- **出力**: docs/ja/<file> 修正
- **重要**: **Translation Agent とは別プロセスで起動**。確認バイアスを排除する核心設計

### Final (全 translation + 全 proof:en-ja 完了後)

- **担当**: Orchestrator 自身
- **依存**: 全 translation + 全 proof:en-ja
- **作業**:
  1. `npm run build` 成功確認
  2. 全 docs/ja/*.md ファイル存在確認
  3. 画像参照リンク切れチェック
  4. 用語一貫性 grep
  5. である調逸脱チェック (`grep "です。\|ます。" docs/ja/*.md`)
  6. **内部リンクの整合性確認** (リンク機能化):
     ```bash
     node scripts/fix-internal-links.mjs   # docs/ja の xhtml ref 残存があれば修正
     node scripts/inject-anchors.mjs       # extract で漏れた figure/table/heading/sidebar id を補完
     node scripts/check-links.mjs          # 死リンクゼロを確認 (errors=0 必須)
     ```
     - VitePress dev server (`npm run dev`) で章間ジャンプ・図表アンカー・脚注・sidebar を 10 件以上抜き打ちクリック確認
     - 残った死リンクは「ja の table 翻訳不在」「ja の見出し構造が en と不一致」など個別案件として記録 (proof:en-ja の re-pass で対応)
  7. 代表章を目視確認 (ユーザーに promo)

## proofPhase 設定

`scripts/gen-tickets.mjs` の `CONFIG.proofPhase`:

- **`'full'`** (推奨): proof:epub-en + proof:en-ja の両方を生成 — 商用書籍など品質要求が高い場合
- **`'epub-only'`**: proof:epub-en のみ — 抽出 MD の構造校正は走らせるが、訳文校正は手動レビューに委ねる
- **`'none'`**: proof フェーズなし — シンプル翻訳プロジェクト (個人用・社内資料・ドラフト品質)

## オーケストレーションループ (毎セッション)

```
loop:
  ticket = bd ready --json | head -1
  if ticket is None: break

  bd update <ticket.id> --claim

  switch ticket.label:
    'translation'   -> spawn_or_inline(agents/translation-agent.md)
    'proof:epub-en' -> spawn_or_inline(agents/proof-epub-en-agent.md)
    'proof:en-ja'   -> spawn_or_inline(agents/proof-en-ja-agent.md)   # 別 context 必須
    'setup'/'final' -> Orchestrator 自身が処理

  # spawn_or_inline:
  #   Claude Code: Agent(subagent_type="general-purpose", prompt=...)
  #   Codex 等  : 同 prompt を inline で読み込んで実行 (proof:en-ja のみ別セッション推奨)
  # 役割 agent が bd close を実行
  # 失敗時は in_progress のまま残る -> 次回セッションで再 claim
```

## 中断・再開

- bd の状態 = 真実のソース
- 中断時: `bd dolt push && git push` でリモート同期
- 再開時: `bd dolt pull` -> `bd ready` -> ループ再開
- 別マシン・別エージェントから再開可能 (コンテキストは bd 上の description / notes に集約)
