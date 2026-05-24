# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリの位置づけ

[anthropics/skills](https://github.com/anthropics/skills) レイアウト準拠の **agent-agnostic AI skill 集** を、[APM (Agent Package Manager)](https://microsoft.github.io/apm/) で配布する **producer 側**リポジトリ。Claude Code / Codex CLI / GitHub Copilot CLI / その他 [agents.md](https://agents.md/) 準拠 agent で利用される。

- 管理対象 skill (詳細は [README.md](./README.md)):
  `book-translation-pipeline`, `history-report`, `usage-guide`, `sync-with-origin-main`, `tech-blog-from-docs`, `worksample-question-generator`
- top-level 構造:
  - `skills/<name>/SKILL.md` (+任意で `references/`, `agents/`, `assets/`, `scripts/`) — 配布対象
  - `evals/<name>/{eval.yaml, tasks/, fixtures/}` — waza project-mode の評価スイート (top-level に置く)
  - `apm.yml` — APM マニフェスト (`includes: skills/**`)
  - `.waza.yaml` — waza の token budget 定義
  - `.github/workflows/waza-eval.yml` — CI ゲート

このリポジトリは **producer (skill を作って配る側)** であり、`apm.yml` の `dependencies` は空 (`apm: []`, `mcp: []`)。consumer 側のインストール手順は README に書いてある。**プロジェクト内の `apm install` はしない** (この repo は user-scope install 専用、`apm.lock.yaml` / `apm_modules/` / `.claude/skills/` は `.gitignore` 済)。

## ツールスタック

| ツール | バージョン | 実体 | 役割 |
|---|---|---|---|
| **apm** | 0.12.2 | `/opt/homebrew/bin/apm` | skill / instruction / MCP の配布 (compile / pack / audit) |
| **waza** | 0.33.0 | `~/bin/waza` | skill の品質ゲート (compliance check / token budget / eval) |

両ツールは補完関係: apm = **配布**、waza = **品質ゲート**。詳細は本ファイル末尾の「詳細ドキュメント」節を参照。

## apm の日常運用

### 主要コマンド (この repo で使うもの)

| コマンド | 用途 |
|---|---|
| `apm compile --target claude --dry-run` | コンパイル結果の preview (実書き込みなし) |
| `apm compile --validate` | primitives の syntax 検査 (書き込みなし) |
| `apm compile --watch` | ファイル変更を監視して自動再生成 (skill 編集中に便利) |
| `apm pack --dry-run` | 配布 artifact の preview |
| `apm pack --target claude --archive` | リリース用 `.tar.gz` 生成 (`build/` 配下) |
| `apm audit` | hidden Unicode / drift / lockfile 検査 |
| `apm audit --strip --dry-run` → `apm audit --strip` | hidden 文字の除去 (プレビュー → 実行) |

### CLI バージョン更新の罠

- `apm update` は **apm CLI 自体の self-update** (`--check` で確認のみ)。
- **依存関係の更新ではない**。依存更新が必要なら `apm deps update` か `apm install --update` を使う。今回の repo は dependencies が空なので通常はどちらも不要。

### 触らないファイル

| ファイル / ディレクトリ | 理由 |
|---|---|
| `apm.lock.yaml` | user-scope install 専用、commit しない (`.gitignore` 済) |
| `apm_modules/` | APM cache (生成物) |
| `.claude/skills/` | apm compile の生成物 (生成物) |
| `.claude/settings.local.json` | ローカル設定 |
| `skills/*/evals/` | legacy in-skill eval ディレクトリ。新規は **top-level の `evals/`** を使う (migration 完了済、commit `351aa57`) |

### `apm.yml` の編集ポリシー

- `name`, `version`, `author`, `targets`, `keywords` を編集する場合だけ手で触る。
- skill 追加・削除では **編集不要** (`includes: skills/**` で自動拾い)。
- `dependencies: { apm: [], mcp: [] }` は空のまま (この repo は producer 専業)。

## waza の品質ゲート

### 主要コマンド

| コマンド | 用途 |
|---|---|
| `waza check` | workspace 内の全 skill を compliance / token / eval で一括検査 |
| `waza check <name>` | 単一 skill を検査 |
| `waza check --format json` | jq に渡す機械可読出力 (CI と同じ) |
| `waza tokens check --strict` | token 上限のハードゲート (exit 1 on violation)。**コミット前必須**。 |
| `waza tokens count <path>` | ファイル単位の token 数 |
| `waza tokens compare <ref1> <ref2>` | git ref 間で token 変動を比較 |
| `waza tokens suggest <skill.md>` | over-budget 時の削減提案 |
| `waza tokens profile <skill.md>` | 構造分析 |
| `waza dev <name> --target high` | frontmatter compliance を対話的に改善 |
| `waza dev <name> --target high --auto` | `--auto` で自動適用 (review 不要なら) |
| `waza dev <name> --scaffold-triggers` | `tests/trigger_tests.yaml` を frontmatter から自動生成 |
| `waza new skill <name>` | skill + eval scaffold |
| `waza new eval <skill>` | 既存 skill に eval suite を追加 |
| `waza new task <skill>` | eval task の scaffold |
| `waza run` | workspace 内全 eval を実行 |
| `waza run <name> -v` | 単一 skill の eval (verbose) |
| `waza run --output-dir results --transcript-dir transcripts -v` | CI と同じ呼び方 |
| `waza grade <eval.yaml> --results results.json --task <id>` | 既存 result に grader だけ再実行 |
| `waza quality skills/<name>/SKILL.md` | LLM-as-Judge で 5 次元品質スコア (clarity / completeness / trigger precision / scope / anti-patterns) |
| `waza suggest skills/<name>/SKILL.md` | LLM による eval ファイル提案 (experimental、`--apply` で書き込み) |
| `waza coverage` | eval coverage grid を出力 |

### `.waza.yaml` の token budget

| ファイル glob | 上限 (tokens) |
|---|---|
| `SKILL.md` | 8000 (warningThreshold) / fallback 5000 |
| `references/*.md`, `references/**/*.md` | 10000 |
| `agents/*.md`, `agents/**/*.md` | 3000 |
| その他 `*.md` | 5000 |
| `README.md` (override) | 5000 |

上限を超えたら:

1. `waza tokens suggest <path>` で削減提案を取る
2. 抽出可能な詳細を `references/<topic>.md` に分割し、SKILL.md から `[link](./references/<topic>.md)` で参照を張る (orphaned reference にならないように)
3. それでも収まらない場合は skill 自体の責任範囲を見直す

### CI でゲートされている advisory (regression 禁止)

`.github/workflows/waza-eval.yml` の `GATED_ADVISORIES` で **必ず passed であること**が要求されている:

- `over-specificity` — 過度に具体的な指示
- `procedural-content` — 手順の埋め込みすぎ
- `body-structure` — 本文の構造的問題

これらが新たに `passed: false` になると CI は exit 1。修復は `waza dev <name> --target high` を起点に進める。

一方、以下の advisory は **accepted as failing** (CI で gate しない):

- `complexity`
- `module-count`
- `cross-model-density`

ローカルで gated advisory の状態を確認:

```bash
waza check --format json | jq '.skills[] | {name, regressed: [.advisoryChecks[] | select(.passed == false) | .name]}'
```

### CI workflow の全体像

`.github/workflows/waza-eval.yml` の実行順:

1. **`waza check`** (advisory、`continue-on-error: true`) — 概況把握用
2. **`waza tokens check --strict`** — ハードゲート (token 違反で exit 1)
3. **`waza check --format json` + jq** で 3 つを gate:
   - eval.yaml の schema validation
   - orphaned reference files (SKILL.md からリンクされていない `references/` ファイル)
   - gated advisories の regression
4. **`waza run --output-dir results --transcript-dir transcripts -v`** (mock executor)
5. `results/` と `transcripts/` を artifact upload (30 日 retention)

## Skill 新規作成 workflow

新しい skill を追加する手順。`<name>` は lowercase + hyphen の skill 識別子。

### 1. Scaffold

```bash
cd /Users/to.watanabe/oss/skills
waza new skill <name>
```

生成物:

- `skills/<name>/SKILL.md`
- `evals/<name>/eval.yaml`
- `evals/<name>/tasks/`

### 2. SKILL.md の frontmatter

```yaml
---
name: <name>                # ディレクトリ名と完全一致
description: >-
  <skill の役割を 1 文で>。
  「<trigger phrase 1>」「<trigger phrase 2>」「<trigger phrase 3>」
  のような依頼で発動する。
  USE FOR: ..., ..., ...
  DO NOT USE FOR: ... (use <other-skill> instead)
  INVOKES: <主要 MCP tool / skill>
---
```

- `description` は **命令形** + **trigger phrase の列挙** + **USE FOR / DO NOT USE FOR** を含める (waza の compliance Medium-High 以上を狙う)。
- 既存 skill (例: `skills/usage-guide/SKILL.md` の 1–13 行目) を参考にする。
- 本文は `.waza.yaml` の SKILL.md 上限 (8000 tokens) 内に収める。詳細は `references/<topic>.md` に分割。

### 3. 動作確認 (ローカル)

```bash
# compliance / token / eval の一括検査
waza check <name>

# 詳細: token と frontmatter を個別に
waza tokens check --strict skills/<name>/
waza dev <name> --target high           # 対話的改善
waza dev <name> --target high --auto    # 自動改善

# eval 実行 (mock executor)
waza run <name> -v

# 品質スコア (LLM judge、要 Copilot 認証)
waza quality skills/<name>/SKILL.md
```

### 4. apm 側の確認

```bash
apm compile --target claude --dry-run    # 配置 preview
apm compile --validate                    # syntax 検証
apm audit                                  # hidden Unicode 検査
```

`apm.yml` は通常編集不要 (`includes: skills/**` が新規ディレクトリを自動で拾う)。

### 5. README.md の更新 (**必須**)

`/Users/to.watanabe/oss/skills/README.md` の「## 管理対象 skill」テーブルに 1 行追加する:

```markdown
| [`<name>`](./skills/<name>/SKILL.md) | <1 文要約 — ユーザがこの skill を選ぶための情報> |
```

要約はユーザ目線で「何を作るか / 何を解決するか」を 1 文。既存行と同じトーン (動詞始まり、体言止め) に揃える。

### 6. コミット

```bash
git add skills/<name>/ evals/<name>/ README.md
git commit -m "feat: add <name> skill"
```

skills/ と evals/ は **必ず同一コミット** に含める。

## Skill メンテナンス workflow

既存 skill の SKILL.md / references / agents / eval を更新する手順。

### 1. 編集前の baseline

```bash
waza run <name> --output-dir baseline -v
```

eval が安定して passing なことを確認 (差分比較のため baseline を取る)。

### 2. 編集 → 都度チェック

ファイル編集中:

```bash
waza tokens check skills/<name>/             # token 超過の早期検出
waza check <name>                             # compliance / eval 概況
waza check <name> --format json | jq '.skills[].advisoryChecks[] | select(.passed == false)'
```

### 3. 編集後の eval 再実行

```bash
waza run <name> --output-dir updated -v
# baseline と updated の results を比較 (regression がないか)
```

### 4. 削除・rename 時の追加作業

- **削除**: `skills/<name>/` と `evals/<name>/` を両方削除 → README.md table 行を削除。
- **rename**: ディレクトリ rename → SKILL.md の `name:` 更新 → README.md を更新 → `evals/<name>/` も rename。

### 5. README.md の更新判断

詳細は次節 (「README.md の更新ルール」) を参照。**内部リファクタで description trigger に影響しない場合は更新不要**。

## README.md の更新ルール

skill 編集と **同一コミット** で README.md を更新すべきケース:

| 状況 | 更新 |
|---|---|
| skill の新規追加・削除・rename | **必須** (table 行の追加 / 削除 / rename) |
| `description` の主旨 (役割・USE FOR の範囲) が変わった | **必須** (1 文要約を書き直す) |
| 対応 target が増減した (例: codex 追加) | **必須** (該当 skill の行 + 「## インストール」節の確認) |
| 主要依存ツールが増減した (例: beads, vitepress) | **必須** (1 文要約に反映) |
| 内部リファクタ・typo 修正・軽微な誤り訂正 | **不要** |
| references/ の分割 / 統合 (SKILL.md の外形は不変) | **不要** |

判断基準: **「README table の現在の 1 文要約が古くなるか」** で決める。古くなるなら更新。

## CI / リリース

### PR 時のゲート

`.github/workflows/waza-eval.yml` が `skills/**`, `evals/**`, このワークフロー自体への変更で起動する。**failing gate**:

1. **token 違反** (`waza tokens check --strict`)
2. **eval.yaml の schema 違反**
3. **orphaned reference files** (SKILL.md から link されていない `references/` ファイル)
4. **gated advisories の regression** (`over-specificity`, `procedural-content`, `body-structure`)

失敗時の修復順:

| 失敗 | 修復 |
|---|---|
| token 違反 | `waza tokens suggest <path>` で削減案 → `references/` に分割 → SKILL.md から link |
| eval schema 失敗 | `evals/<name>/eval.yaml` を waza spec に合わせる (graders, tasks, config) |
| orphaned reference | SKILL.md から `[link](./references/<file>.md)` で参照を張る (もしくは不要なら削除) |
| advisory regression | `waza dev <name> --target high` で frontmatter / 本文構造を改善 |

### リリース手順

```bash
# 1. version bump
# apm.yml の version: を更新

# 2. bundle 生成 (preview)
apm pack --dry-run

# 3. 本生成
apm pack --target claude --archive
# → build/<name>.tar.gz

# 4. tag & GitHub release
git tag v<version>
git push origin v<version>
gh release create v<version> build/*.tar.gz
```

## CLAUDE.md 自体のメンテナンス

このファイルが **500 行を超えたら**、apm 詳細部と waza 詳細部を分割することを検討する:

- `docs/CLAUDE/apm.md` — apm コマンド詳細、`apm.yml` 編集規約、リリース手順
- `docs/CLAUDE/waza.md` — waza コマンド詳細、advisory 一覧、token budget、CI 統合
- 本ファイルからは Claude Code の import 構文で参照する (例: `@docs/CLAUDE/apm.md`)。

分割後も本ファイルには「リポジトリ概要」「ツールスタック」「README.md 更新ルール」「CLAUDE.md 自体のメンテナンス」を残す。

## 既に定義済みのグローバルルール (再記述しない)

以下は `~/.claude/rules/common/*.md` で既に設定されており、Claude Code セッションで自動 import される。CLAUDE.md で重複定義しない:

- `coding-style.md` — immutability、ファイル分割の指針、エラーハンドリング、入力検証
- `git-workflow.md` — conventional commit 形式 (feat / fix / refactor / docs / test / chore / perf / ci)
- `output-formatting.md` — `.md` には Mermaid、console / 会話応答には ASCII art、表は Markdown table 統一
- `development-workflow.md` — 研究 → 計画 → TDD → review → commit の流れ
- `testing.md` — 80% カバレッジ目標、TDD ワークフロー
- `security.md` — secret 管理、脆弱性チェックリスト
- `agents.md` — agent オーケストレーション (planner, tdd-guide, code-reviewer 等)
- `performance.md` — モデル選択戦略、context 管理
- `patterns.md` — Repository パターン、API 応答エンベロープ
- `hooks.md` — hook システム、TodoWrite

## 詳細ドキュメント

### apm

- 公式: <https://microsoft.github.io/apm/>
- ローカル (`/Users/to.watanabe/oss/apm/docs/src/content/docs/`):
  - `concepts/` — APM のコンセプト
  - `getting-started/` — チュートリアル
  - `producer/` — skill / instruction を作る側のガイド
  - `consumer/` — install する側のガイド
  - `reference/cli/` — 各 CLI subcommand のリファレンス
- ヘルプ: `apm <subcommand> --help`

### waza

- ローカル (`/Users/to.watanabe/oss/waza/docs/`):
  - `GETTING-STARTED.md`, `TUTORIAL.md`, `GUIDE.md` — 入門・基本操作
  - `SKILL-BEST-PRACTICES.md` — SKILL.md の書き方
  - `CI-CD-GUIDE.md`, `SKILLS_CI_INTEGRATION.md` — CI 統合
  - `TOKEN-LIMITS.md` — token 予算の設計
  - `graders/` — 各 grader タイプの詳細 (action_sequence, behavior, code, diff, file, llm, prompt, text, tool_constraint, trigger ほか)
- ヘルプ: `waza <subcommand> --help`

### Skill spec

- [Anthropic Skills spec](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [agentskills.io](https://agentskills.io/)
- [anthropics/skills](https://github.com/anthropics/skills) (レイアウト規約のリファレンス実装)
