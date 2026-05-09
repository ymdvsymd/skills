# skills

User-scope skill 集を [APM (Agent Package Manager)](https://microsoft.github.io/apm/) で配布する repository。

## 管理対象 skill

| skill | 概要 |
|-------|------|
| [`book-translation-pipeline`](./.apm/skills/book-translation-pipeline/SKILL.md) | EPUB → 日本語訳 VitePress サイトを構築する 5 フェーズ翻訳パイプライン (beads チケット管理付き) |
| [`history-report`](./.apm/skills/history-report/SKILL.md) | 特定バージョン以降の更新を調査して `.history/` に日本語の構造化レポートを出力 |
| [`usage-guide`](./.apm/skills/usage-guide/SKILL.md) | リポジトリ現在状態を分析し `.usage/` に使い方ドキュメントを生成 |
| [`sync-with-origin-main`](./.apm/skills/sync-with-origin-main/SKILL.md) | rebase → 衝突時 merge fallback で `origin/main` を線形に追従 |

## インストール

```bash
apm install -g ymdvsymd/skills
```

APM CLI 自体のインストール、対応 platform (`claude` / `copilot` / `cursor` / `codex` / `gemini` / `windsurf` / `opencode` / `agent-skills`)、`--target` や `--update` などのオプションは [APM 公式ドキュメント](https://microsoft.github.io/apm/) 参照。

skill content は Claude Code の `SKILL.md` 形式で記述している。他 platform でも install できるが各platform での挙動は要検証。

## 構成

```
.
├── apm.yml                              APM manifest
├── README.md
├── .gitignore                           apm.lock.yaml, .claude/skills/, ローカル設定を除外
└── .apm/
    └── skills/
        ├── book-translation-pipeline/   subdirectory 付き skill
        │   ├── SKILL.md
        │   ├── agents/
        │   ├── assets/
        │   ├── evals/
        │   ├── references/
        │   └── scripts/
        ├── history-report/
        ├── usage-guide/
        └── sync-with-origin-main/
```

`.apm/skills/<name>/` を編集 → `git push` した内容は、利用者側が `apm install -g ymdvsymd/skills --update` で取得する。
