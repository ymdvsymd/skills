# skills

[anthropics/skills](https://github.com/anthropics/skills) のレイアウト規約に倣った skill 集を、[APM (Agent Package Manager)](https://microsoft.github.io/apm/) で配布する repository。**agent 非依存**で書いてあり、Claude Code / Codex CLI / その他 [agents.md](https://agents.md/) 標準対応エージェントで利用できる。Claude Code Plugin Marketplace 経由のインストールにも対応。

## 管理対象 skill

| skill | 概要 |
|-------|------|
| [`book-translation-pipeline`](./skills/book-translation-pipeline/SKILL.md) | EPUB → 日本語訳 VitePress サイトを構築する 5 フェーズ翻訳パイプライン (beads チケット管理付き)。scaffolding は `AGENTS.md` (canonical) と `CLAUDE.md` (`@./AGENTS.md` import + Claude Code 固有 hint) を両方生成する。 |
| [`history-report`](./skills/history-report/SKILL.md) | 特定バージョン以降の更新を調査して `.history/` に日本語の構造化レポートを出力 |
| [`usage-guide`](./skills/usage-guide/SKILL.md) | リポジトリ現在状態を分析し `.usage/` に使い方ドキュメントを生成 |
| [`sync-with-origin-main`](./skills/sync-with-origin-main/SKILL.md) | rebase → 衝突時 merge fallback で `origin/main` を線形に追従 |

## インストール

### APM (推奨)

```bash
# Claude Code 用 (~/.claude/skills/)
apm install -g ymdvsymd/skills --target claude

# Codex CLI 用 (~/.agents/skills/ — Codex は agent-skills 共通配置を読む)
apm install -g ymdvsymd/skills --target codex

# Cross-client 共通配置 (~/.agents/skills/) — Cursor / Copilot / OpenCode / Gemini 等
apm install -g ymdvsymd/skills --target agent-skills
```

各 install は **deploy 先を 1 つに限定する**ことが重要 (`--target` を指定する)。`--target` を省略すると複数 location に展開され、同じ skill が **二重登録**されて description ブロックが context に複数回入り、trigger 解決でも重複マッチする。

APM CLI 自体のインストール、対応 platform (`claude` / `copilot` / `cursor` / `codex` / `gemini` / `windsurf` / `opencode` / `agent-skills`)、その他オプションは [APM 公式ドキュメント](https://microsoft.github.io/apm/) 参照。

### Claude Code Plugin Marketplace

Claude Code 内で:

```
/plugin marketplace add ymdvsymd/skills
/plugin install ymdvsymd-skills@ymdvsymd-skills
```

`.claude-plugin/marketplace.json` が plugin 定義を提供する。

## 構成

[anthropics/skills](https://github.com/anthropics/skills) と同じ top-level `skills/` レイアウト:

```
.
├── apm.yml                          APM manifest (targets: claude, codex, agent-skills)
├── .claude-plugin/
│   └── marketplace.json             Claude Code Plugin Marketplace 定義
├── README.md
├── .gitignore                       apm.lock.yaml, .claude/skills/, ローカル設定を除外
└── skills/
    ├── book-translation-pipeline/   subdirectory 付き skill
    │   ├── SKILL.md
    │   ├── agents/                  role-prompt template (Claude: subagent / 他: inline)
    │   ├── assets/                  agents-md.template / claude-md.template 他
    │   ├── evals/
    │   ├── references/
    │   └── scripts/
    ├── history-report/
    ├── usage-guide/
    └── sync-with-origin-main/
```

`SKILL.md` は [Anthropic Skills spec](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) と [agentskills.io](https://agentskills.io/) 準拠で書いてあり、Claude Code でも Codex でも description trigger が機能する。Claude 固有の orchestration (`Agent` tool による subagent spawn 等) は SKILL.md 内で明示的に注記してあり、他 agent では inline prompt として読み替える指針も併記している。

`skills/<name>/` を編集 → `git push` した内容は、利用者側が `apm install -g ymdvsymd/skills --update --target <target>` で取得する。
