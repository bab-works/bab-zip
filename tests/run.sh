#!/usr/bin/env bash
# 전체 테스트: bash tests/run.sh  (Playwright와 크로미움이 깔린 환경 필요, 스크린샷은 임시 폴더에 저장)
set -e
cd "$(dirname "$0")"
for t in ticktick.js e2e.js habit.js menu-swipe.js menu-edit.js short-link.js book-views.js; do
  echo "== $t"; node "$t" | tail -1
done
