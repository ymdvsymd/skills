---
name: sync-with-origin-main
description: >-
  Sync the local branch with the latest origin/main (rebase first, fall back to merge on conflict).
  ローカルブランチに最新の `origin/main` を取り込む。
  「最新のorigin/mainをリベース」「origin/main を取り込む」「origin/main にリベース」
  「main を最新に追従」「リモートの main を取り込んで」「main を最新化」
  「origin/main で更新」「最新の main に追従」のような依頼で発動する。
  `git fetch` → 乖離確認 → まず `git rebase origin/main` を試し、衝突したら
  `--abort` して `git merge origin/main` に切り替えることで、線形履歴を優先しつつ
  コンフリクト解決を最小回数に抑える。dirty working tree は中断、push は常に手動。
  Git で main の最新を追従したい依頼が来たら、明示的に「スキル」と言われなくても
  これを使うこと。
---

# Sync with origin/main

ローカルブランチに最新の `origin/main` を取り込むスキル。
「rebase で取り込む」のが**手段**であり、目的は **「origin/main を取り込む」**こと。
そのため rebase に固執せず、衝突時には merge にフォールバックする。

## When to Use

- 「最新の origin/main をリベース / 取り込んで / に追従して」のような依頼
- main を最新化したい場面全般
- 派生ブランチで開発中に、上流の更新を取り込みたいとき

このスキルを**使わない**ケース:

- ユーザーが明示的に「rebase だけで」「merge で」と戦略を指定したとき
  → 指定されたコマンドに素直に従う（このスキルのハイブリッド戦略は適用しない）
- ベースが `origin/main` 以外（`origin/develop`, `upstream/main` など）
  → 個別に対応する

## Strategy: rebase-first, merge-fallback

このスキルの判断軸は **「コンフリクト解決を最小回数に抑える」**。
そのために、以下の優先順位で取り込みを試みる:

1. **まず rebase** — 線形履歴を保てる、PR レビューしやすい
2. **衝突したら abort して merge** — rebase は per-commit で衝突を繰り返すことが多く、
   merge なら一回の衝突解決で済む

戦略切り替えは**必ずユーザーに通知**してから行う。サイレントな方針変更は避ける。

## Workflow

### Step 1: 事前検査

取り込み開始前に、以下のいずれかに該当すれば**中断してユーザーに状況を報告**する:

```bash
# dirty working tree
git status --porcelain

# 進行中の rebase / merge
ls -d .git/rebase-merge .git/rebase-apply .git/MERGE_HEAD 2>/dev/null

# detached HEAD
git symbolic-ref -q HEAD
```

中断の理由:
- **dirty**: 暗黙の stash はユーザーを驚かせる。状態を伝えて指示を仰ぐ
- **rebase / merge 進行中**: 既存の作業を壊さないため、ユーザーに完了 or abort を委ねる
- **detached HEAD**: ブランチ上にいないので何にリベースしても固定先がない

### Step 2: fetch

```bash
git fetch origin
```

### Step 3: 乖離確認

```bash
git status
git log --oneline origin/main..HEAD
git log --oneline HEAD..origin/main | head -20
```

- **両方ゼロ** → 取り込み対象なし。「すでに origin/main と一致しています」と報告して終了
- **ローカルだけ ahead、リモート 0** → 取り込み対象なし。同上
- それ以外 → Step 4 へ

### Step 4: rebase 試行

```bash
git rebase origin/main
```

- 成功 → Step 7（事後検査と報告）へ
- 失敗（衝突発生）→ Step 5 へ

### Step 5: rebase abort と merge 切り替え

衝突したら、rebase をその場で破棄して merge へ切り替える:

```bash
git rebase --abort
```

ユーザーに通知:

> rebase で衝突が発生したため、merge 戦略に切り替えます。
> （rebase は commit ごとに衝突を繰り返しがちなので、merge で一度にまとめて解決します）

その後 merge を試行:

```bash
git merge origin/main
```

- 成功 → Step 7 へ
- 衝突 → Step 6 へ

### Step 6: merge 衝突解決

```bash
git status
```

衝突ファイル一覧を取得し、各ファイルについて:

1. **Read** で全体を読み、衝突マーカー（`<<<<<<<`, `=======`, `>>>>>>>`）の前後文脈を理解する
2. **Edit** で衝突マーカーを取り除き、両側の意図を尊重した解決にする
3. `git add <file>` でステージ

**自信が持てない解決がある場合は、そのファイルには手を付けず**、解決済みのファイルだけ
add した状態でユーザーに引き継ぐ。`git merge --abort` は**しない**（解決済みの作業を捨てない）。

すべて解決したら:

```bash
git commit  # merge commit のデフォルトメッセージで OK
```

### Step 7: 事後検査と報告

```bash
git status
git log --oneline -3
```

報告のテンプレートは下記「Output Format」参照。

## Safety Rails

このスキルが**してはいけないこと**:

- `git push` を勝手に実行しない（force-push 含めて全面禁止）
- `git reset --hard` を勝手に実行しない
- dirty working tree の自動 stash をしない
- merge 中の `--abort` をしない（ユーザーが解決した作業を捨てない）
- `git rebase --abort` は **Step 5（戦略切り替え時）のみ許可**。
  abort 対象は今 git が始めた一時的な rebase であり、ユーザーの作業ではないため安全

戦略切り替え（rebase → merge）は**必ずユーザーに通知**してから実行する。

## Output Format

### rebase 成功時

```
origin/main を rebase で取り込みました。
- 旧 HEAD: <旧 SHA>
- 新 HEAD: <新 SHA>
- ローカルは N コミット先行（unpushed）
push が必要なら指示してください。
```

### merge フォールバック成功時

```
rebase で衝突したため merge に切り替え、取り込みました。
- merge commit: <SHA>
- 取り込んだリモートコミット数: N
push が必要なら指示してください。
```

### merge 衝突を AI が解決した時

```
rebase で衝突 → merge に切り替え → AI が衝突を解決しました。
解決したファイル:
- path/to/file1.go: ours と theirs の両方を活かす形で手動マージ
- path/to/file2.md: theirs の内容を採用（ours は削除予定の記述）
merge commit: <SHA>
push が必要なら指示してください。
```

### 中断時

```
取り込みを中断しました。
理由: <dirty working tree / rebase 進行中 / detached HEAD>
現在の状態:
  <git status の要約>
取りうる選択肢:
  - <選択肢 1>
  - <選択肢 2>
```

## Examples

### Example A: クリーン + rebase 成功（最頻ケース）

```
$ git fetch origin
$ git status
On branch main
Your branch and 'origin/main' have diverged,
and have 1 and 18 different commits each, respectively.

$ git log --oneline origin/main..HEAD
1f84f3f4 docs: add QA documentation on variable passing between formulas

$ git rebase origin/main
Successfully rebased and updated refs/heads/main.

$ git status
Your branch is ahead of 'origin/main' by 1 commit.
```

→ 「rebase で取り込み完了」と報告。push は明示指示があるまでしない。

### Example B: dirty で中断

```
$ git status --porcelain
 M src/foo.go
?? bar.txt
```

→ 中断。「working tree に未コミットの変更があります。コミット or stash してから
  再度依頼してください」と報告し、何も実行しない。

### Example C: rebase 衝突 → merge にフォールバック

```
$ git rebase origin/main
CONFLICT (content): Merge conflict in src/foo.go
error: could not apply abc1234... ...

$ git rebase --abort
$ git merge origin/main
Merge made by the 'ort' strategy.
```

→ 「rebase で衝突 → merge に切り替えて成功」と報告。

### Example D: rebase 衝突 → merge も衝突 → AI が解決

```
$ git merge origin/main
CONFLICT (content): Merge conflict in src/foo.go
Automatic merge failed; fix conflicts and then commit the result.
```

→ Read で `src/foo.go` を読み、両側の変更を理解した上で Edit で解決 →
  `git add src/foo.go` → `git commit`。報告には解決方針を明記。
