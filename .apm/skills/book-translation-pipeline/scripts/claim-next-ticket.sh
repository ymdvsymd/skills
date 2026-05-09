#!/usr/bin/env bash
# claim-next-ticket.sh — book-translation-pipeline オーケストレーション用
#
# bd ready から先頭チケットを取得し、--claim して JSON で stdout に出力する。
# メインエージェント (orchestrator) がループ内で呼ぶ。
#
# Usage:
#   ./scripts/claim-next-ticket.sh
#
# 出力:
#   - 作業可能チケットがある場合: 該当チケットの JSON 1 件を stdout に出力 (claim 成功)
#   - 作業可能チケットがない場合: 空の JSON {} を出力し exit 0
#
# 終了コード:
#   0  正常終了 (claim 済み or 在庫なし)
#   1  bd コマンド失敗

set -euo pipefail

# 先頭の ready チケットを JSON で取得
READY_JSON=$(bd ready --json 2>/dev/null || echo '[]')

# 空配列または null なら何もしない
if [[ -z "$READY_JSON" || "$READY_JSON" == "[]" || "$READY_JSON" == "null" ]]; then
  echo '{}'
  exit 0
fi

# 先頭の id とラベル (jq があれば使う、なければ python3 にフォールバック)
if command -v jq >/dev/null 2>&1; then
  TICKET_ID=$(echo "$READY_JSON" | jq -r '.[0].id // empty')
  TICKET_INFO=$(echo "$READY_JSON" | jq -c '.[0]')
else
  TICKET_ID=$(echo "$READY_JSON" | python3 -c "import json,sys; data=json.load(sys.stdin); print(data[0]['id'] if data else '')")
  TICKET_INFO=$(echo "$READY_JSON" | python3 -c "import json,sys; data=json.load(sys.stdin); print(json.dumps(data[0]) if data else '{}')")
fi

if [[ -z "$TICKET_ID" ]]; then
  echo '{}'
  exit 0
fi

# claim
bd update "$TICKET_ID" --claim >/dev/null 2>&1 || {
  echo "claim failed for $TICKET_ID" >&2
  echo "$TICKET_INFO"
  exit 1
}

echo "$TICKET_INFO"
