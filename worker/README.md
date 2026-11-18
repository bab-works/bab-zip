# 친구 Worker 배포

앱 주소와 운영 데이터 전환은 별도 단계다. 이 워크플로는 Worker와 D1 스키마만 배포한다.

1. Cloudflare 대시보드에서 **Workers & Pages**를 열어 해당 계정의 workers.dev 하위 도메인을 설정한다. **D1 SQL Database → Create database**에서 `bab-zip-friends`를 만들고 데이터베이스 ID와 계정 ID를 확인한다.
2. **My Profile → API Tokens → Create Token → Create Custom Token**에서 해당 계정 하나만 선택한다. Account 권한은 **Workers Scripts · Edit**, **D1 · Edit**를 선택한다.
3. GitHub 저장소의 **Settings → Secrets and variables → Actions → New repository secret**에 아래 값을 각각 입력한다.

| 이름 | 값 |
|---|---|
| CLOUDFLARE_API_TOKEN | 2번에서 만든 API 토큰 |
| CLOUDFLARE_ACCOUNT_ID | 해당 Cloudflare 계정 ID |
| CLOUDFLARE_D1_DATABASE_ID | 새 D1의 데이터베이스 ID |
| FRIENDS_BRIDGE_SECRET | 비밀번호 관리기로 새로 만든 32자 이상의 무작위 값. 서버 간 주인 인증에 사용 |
| FRIENDS_FIRST_PASSWORD | 기존 앱에서 새 친구에게 주던 초기 비밀번호. 기존 친구의 해시는 별도로 이전 |

4. GitHub **Actions → 친구 Worker 배포 → Run workflow → main**을 실행한다. 테스트 후 마이그레이션을 적용하고 서버 비밀값을 등록한 뒤 배포한다. 배포 출력의 Worker 주소 뒤에 `/health`를 붙여 열면 `{"ok":true}`를 반환한다. 이 검사는 DB 연결 및 스키마만 확인한다.

로컬 검증은 저장소 루트에서 `npm ci --prefix worker` 후 `node tests/worker.mjs`로 실행한다. 테스트는 매번 비어 있는 로컬 D1과 가짜 계정을 사용한다.
