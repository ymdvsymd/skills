# GitHub Pages デプロイ詳細手順

book-translation-pipeline スキルの GitHub Pages 対応の中身。`init-project.sh --deploy-target=github` か `gh repo` が public で自動判定された場合に使われる。

## 何が起きるか

| 配置されるもの | 役割 |
|---|---|
| `.github/workflows/deploy.yml` | master/main push で `peaceiris/actions-gh-pages@v3` を使い `gh-pages` ブランチへデプロイ |
| `docs/.vitepress/config.mts` の `base: '/<repo-name>/'` | GitHub Pages がサブパス配信する都合で必須 |

## 初回有効化（手動 1 ステップ）

GitHub のリポジトリ Settings → **Pages** → **Source** を **GitHub Actions** に設定。
（peaceiris アクションを使うので `gh-pages` ブランチも選べる。どちらでも `Settings → Pages → Source` を 1 度有効化する必要あり）

## ブランチ対応

ワークフローは `branches: [main, master]` 両対応で生成される。リポジトリのデフォルトブランチがどちらでも追加設定なしで動く。

## 公開 URL

```
https://<github-user>.github.io/<repo-name>/
```

`init-project.sh` が README に自動で記載。

## トラブルシュート

### push したのに 404

チェック順:
1. Actions タブでワークフローが成功しているか
2. Settings → Pages → Source が **GitHub Actions** または **Deploy from a branch (gh-pages / root)** になっているか
3. `gh-pages` ブランチが生成されているか（`git ls-remote origin gh-pages`）
4. `vitepress-config.mts` の `base:` がリポジトリ名と一致しているか（`init-project.sh` が自動で置換しているはず）

### CSS / アセットが 404

`base:` の値が間違っている可能性。リポジトリ名が `MyRepo` なのに `base: '/myrepo/'` で配信されると、ブラウザは `/MyRepo/...` にリクエストして 404。`__REPO_NAME__` が小文字化されているのは仕様（GitHub Pages の URL は小文字）。

### 公開してから「やはり関係者限定にしたい」

```bash
bash $SKILL_DIR/scripts/migrate-to-cloudflare.sh
# .env.local を埋めてから
bash $SKILL_DIR/scripts/migrate-to-cloudflare.sh --continue
```

これで GitHub Pages → Cloudflare Pages + Basic 認証へ切替。詳細は `references/deploy-cloudflare.md`。
