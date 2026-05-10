# Cloudflare Pages デプロイ詳細手順

book-translation-pipeline スキルの Cloudflare Pages 対応の中身を解説する。`init-project.sh --deploy-target=cloudflare` または `migrate-to-cloudflare.sh` 経由で使う。

## 何が起きるか

| 配置されるもの | 役割 |
|---|---|
| `functions/_middleware.ts` | 全リクエストに HTTP Basic 認証を強制する Pages Function。SHA-256 ハッシュ + 定数時間比較 |
| `wrangler.toml` | Cloudflare Pages プロジェクト名（**ランダム 16 文字**）とビルド出力先を固定 |
| `.github/workflows/cloudflare-pages.yml` | master/main push で Cloudflare Pages へ自動デプロイ |
| `.env.local.example` | API Token / Basic auth 情報のテンプレ。`.env.local` にコピーして埋める |

## 前提

- Cloudflare アカウント
- `gh` CLI でリポジトリオーナーアカウントにログイン済み
- ID/PW は固定の少人数で共有する用途（メールごとの管理は Cloudflare Access に切替推奨）

## API Token の発行（一度だけ）

GitHub Actions が Cloudflare へデプロイするために必要。

1. https://dash.cloudflare.com/profile/api-tokens
2. **Create Token** → **Custom token** → **Get started**
3. Token name: `pages-deploy-<repo>`
4. **Permissions** に以下 2 行:
   - **Account / Cloudflare Pages / Edit**
   - **User / User Details / Read**（推奨。なくても Pages デプロイ自体は動くが `wrangler whoami` 等の補助コマンドで警告が出る）
5. **Account Resources**: Include / 自分のアカウントを選択
6. **Continue to summary** → **Create Token** → 表示された値をコピー（再表示不可）

加えて **Account ID** を https://dash.cloudflare.com/ 右サイドバーからコピー。

## .env.local の中身

```
CLOUDFLARE_API_TOKEN=<上で発行した Token>
CLOUDFLARE_ACCOUNT_ID=<コピーした Account ID>
BASIC_AUTH_USER=<好きなユーザー名>
BASIC_AUTH_PASS=<強めのパスワード>
```

`.gitignore` に `.env.local` が入っているのでコミットされない。

## init-cloudflare-deployment.sh の動作（逐次）

1. `npm i -D wrangler`（既に入っていれば no-op）
2. `wrangler pages project create <random-name> --production-branch=master`
3. `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` を `wrangler pages secret put`（stdin 経由でログに値が出ない）
4. `npm run build`
5. `wrangler pages deploy docs/.vitepress/dist --project-name=<random-name>`
6. `gh secret set CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`（CI 用）
7. README の `<!-- DEPLOY_SECTION_BEGIN -->` 〜 `END` ブロックを最新の URL で更新

完了後、**Bookmark this URL** メッセージで `https://<random16>.pages.dev/` が表示される。これが配信 URL。

## ID/PW の更新方法

```bash
set -a && source .env.local && set +a
PROJECT_NAME=$(awk -F'"' '/^name/{print $2}' wrangler.toml)
printf '%s' "$BASIC_AUTH_PASS" | npx wrangler pages secret put BASIC_AUTH_PASS --project-name="$PROJECT_NAME"
```

コード変更不要。

## URL ランダム化の意図と限界

- リポジトリ名そのまま（例: `dmrb-vol4.pages.dev`）だと URL を知っているだけで Basic 認証ダイアログまで誰でも到達してしまう
- **16 文字のランダム英数字**（先頭は英字保証）を Cloudflare プロジェクト名に使うことで discovery 困難化
- ただし TLS 証明書は **Certificate Transparency (CT) ログ** に登録されるため、CT ログ経由で発見される可能性はある（完全な隠蔽は不可）
- 真に閲覧者を限定したい場合は **Cloudflare Access** に切替: 独自ドメイン + Access ポリシー（メアド単位 / SSO）。`functions/_middleware.ts` を削除して Access 設定するだけで移行可能

## トラブルシュート

### `Wrangler authorization failed` / `There was an error fetching accounts`

原因: シェル環境に `NODE_TLS_REJECT_UNAUTHORIZED=0` がセットされている（Netskope 等の SSL Inspection 環境でよくある）。Cloudflare 側がこの設定の TLS クライアントを拒否する既知挙動。

対処:
```bash
unset NODE_TLS_REJECT_UNAUTHORIZED
```
`init-cloudflare-deployment.sh` は冒頭で自動的に unset するので、別ターミナルで `wrangler login` を試す場合のみ手動 unset 必要。

`.zshrc` 等で常時 export されていれば、その export 自体を見直す（多くの場合 `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/netskope-cert-bundle.pem` で十分で、TLS 検証無効化は不要）。

### `Failed to automatically retrieve account IDs for the logged in user`

原因: API Token に `User > User Details > Read` が無い。

対処: ダッシュボードで Token 編集してパーミッション追加、または新規 Token 作成。`CLOUDFLARE_ACCOUNT_ID` を環境変数で渡せれば回避できるコマンドもある（Pages 系は OK）。

### 401 が出ない（誰でも閲覧できてしまう）

考えられる原因:
- Cloudflare 側で `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` の secret が空（`wrangler pages secret list --project-name=<name>` で確認）
- `functions/_middleware.ts` が deploy されていない（`wrangler pages deploy` の出力に `Compiled Worker successfully` があるか確認）
- ブラウザがキャッシュした認証情報を送信している（シークレットウィンドウで再確認）

### 旧 GitHub Pages の URL が 404 にならない

- リポジトリ Settings → Pages を **Source: None** に変更（手動）
- または `gh api -X DELETE repos/$OWNER/$REPO/pages` を実行
- `gh-pages` ブランチを削除（`git push origin --delete gh-pages`）
