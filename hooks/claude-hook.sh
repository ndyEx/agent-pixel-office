#!/bin/sh
# Claude Code 훅 → Pixel Office 서버로 이벤트 전달 (승인 대기를 정확하게 표시하려고)
# 훅 입력(JSON)을 stdin으로 받아 그대로 보낸다. 서버가 꺼져 있어도 Claude 작업을 막지 않도록 항상 성공으로 끝낸다.
DIR=$(cd "$(dirname "$0")/.." && pwd)
TOKEN=$(cat "$DIR/data/hook-token" 2>/dev/null)
curl -s -m 2 -o /dev/null -X POST \
  -H 'Content-Type: application/json' -H "X-Hook-Token: $TOKEN" \
  --data-binary @- "${PIXEL_OFFICE_URL:-http://127.0.0.1:4321}/api/hook" 2>/dev/null
exit 0
