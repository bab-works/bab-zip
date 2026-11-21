#!/usr/bin/env bash
# 전체 테스트: bash tests/run.sh  (Playwright와 크로미움이 깔린 환경 필요, 스크린샷은 임시 폴더에 저장)
set -eo pipefail # 테스트 하나라도 실패하면 거기서 멈춤 (| tail 때문에 실패가 묻히지 않게)
cd "$(dirname "$0")"
for t in version.js setup.js ticktick.js e2e.js habit.js menu-swipe.js menu-edit.js short-link.js book-views.js aladin.js lock.js photo.js escape.js friends.js friend-app.js skins.js login.js ptr.js social.js notice.js split.js habit-many.js review-flows.js cards.js widgets.js; do
  echo "== $t"; node "$t" | tail -1
done
if ! (cd ../worker && node -e "require.resolve('miniflare')" 2>/dev/null); then
  npm ci --prefix ../worker --no-audit --no-fund
fi
node worker.mjs
node migration.mjs
