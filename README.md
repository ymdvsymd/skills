# skills

Claude Code の user-scope skill を [APM (Agent Package Manager)](https://microsoft.github.io/apm/) で管理する repository。

## 管理対象 skill

| skill | 概要 |
|-------|------|
| [`book-translation-pipeline`](./.apm/skills/book-translation-pipeline/SKILL.md) | EPUB → 日本語訳 VitePress サイトを構築する 5 フェーズ翻訳パイプライン (beads チケット管理付き) |
| [`history-report`](./.apm/skills/history-report/SKILL.md) | 特定バージョン以降の更新を調査して `.history/` に日本語の構造化レポートを出力 |
| [`usage-guide`](./.apm/skills/usage-guide/SKILL.md) | リポジトリ現在状態を分析し `.usage/` に使い方ドキュメントを生成 |
| [`sync-with-origin-main`](./.apm/skills/sync-with-origin-main/SKILL.md) | rebase → 衝突時 merge fallback で `origin/main` を線形に追従 |

## インストール (user scope = `~/.claude/skills/`)

このrepoはuser scope skill 配布用 APM package。
利用者は `apm install -g ymdvsymd/skills` だけで `~/.claude/skills/` に4 skill 全てが展開される。

```bash
# 1. APM CLI を入れる (まだなら)
brew install microsoft/apm/apm

# 2. user scope へ install (~/.apm/apm.yml は auto-create される)
apm install -g ymdvsymd/skills
```

実行後、`~/.claude/skills/<name>/` に各 skill が verbatim で展開され、
新規 Claude Code セッションから skill が認識される。

更新は `apm install -g ymdvsymd/skills --update` で latest を取得。

## 開発フロー (このrepo の編集者向け)

1. `.apm/skills/<name>/` 配下のファイル (`SKILL.md` および付随 `scripts/`, `references/`, `assets/` 等) を編集
2. `git add` → `git commit` → `git push` で GitHub に反映
3. ローカルの user scope に取り込むには `apm install -g ymdvsymd/skills --update`

ローカル試し置き (project scope に試展開) は repo root で:
```bash
apm install --target claude   # <repo>/.claude/skills/ に test 展開 (gitignore対象)
```

`book-translation-pipeline` のように subdirectory を持つ skill も、
ディレクトリ全体が verbatim にコピーされる。

## ファイル構成

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

## 参考

- [APM 公式ドキュメント](https://microsoft.github.io/apm/)
- [Your First Package](https://microsoft.github.io/apm/getting-started/first-package/)
- [Skills ガイド](https://microsoft.github.io/apm/guides/skills/)
- [CLI コマンドリファレンス](https://microsoft.github.io/apm/reference/cli-commands/)
