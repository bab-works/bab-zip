# AGENTS.md — 하트(하비 트래커) 작업 안내

AI 코딩 도우미(Codex, Claude 등)가 이 저장소를 고칠 때 먼저 읽는 문서. 사용자와는 **한국어**로, 쉬운 말로 이야기한다.

## 1. 이 앱은

- **하트 : 하비 트래커** — 휴대폰 홈 화면에 설치해 쓰는 개인 웹 앱(PWA). 저장소 이름·옛 이름은 BAB:ZIP.
- 주인(시트 주인 1명)은 가계부 + 취미 기록(독서·방탈출·보드게임·영화·공연) + 습관(틱틱 연동)을 쓴다.
- 친구(게스트)는 초대 링크로 들어와 가계부 없이 취미 기록·습관·친구 기능만 쓴다.
- 주소: https://bab-works.github.io/bab-zip/ (GitHub Pages, `main` 브랜치가 그대로 배포됨)
- 서버: 구글 시트 「나의 가계부」에 붙은 Apps Script 웹 앱(`apps-script/Code.gs`). 시트가 DB다.

## 2. 파일

| 파일 | 내용 |
|---|---|
| `index.html` | 화면 전체 HTML + CSS(테마 5종 포함) + SVG 아이콘(`<symbol id="i-…">`) |
| `app.js` | 앱 코드 전부(빌드 없음, 프레임워크 없음, 한 파일). `$()` = querySelector, `store` = localStorage |
| `notices.js` | 공지사항·설치 방법·Q&A·「개선 중」 목록 데이터 |
| `sw.js` | 서비스 워커(오프라인 캐시, 알림) |
| `apps-script/Code.gs` | 서버 전부. `doGet(what=…)` 읽기, `doPost` → `writeOp_` 쓰기 |
| `apps-script/deploy/put-code.js`, `.github/workflows/deploy-gas.yml` | Code.gs 자동 배포 |
| `guide/` | 「홈 화면에 추가」 안내 그림(`node guide/make.js`로 다시 만듦) |
| `tests/` | Playwright 테스트(아래 4번) |
| `push/worker.js` | 알림 서버(클라우드플레어 워커, 아직 미사용: `PUSH_URL`이 빈 값) |
| `widget/scriptable.js` | 아이폰 Scriptable 위젯 |

## 3. 꼭 지킬 것 (보안·개인정보)

- **비밀번호를 저장소에 올리지 않는다.** `Code.gs`의 `const TOKEN = '여기에-나만-아는-비밀번호를-적으세요';` 줄은 이 자리표시 그대로 둔다(자동 배포가 배포할 때만 비밀값을 넣는다).
- 저장소는 **공개**다. 계좌번호·이메일·실제 거래 데이터·사람 이름 같은 개인정보를 코드·테스트·커밋 메시지에 넣지 않는다. 테스트는 가짜 데이터만 쓴다.
  - N빵 정산 계좌는 앱에서 입력받아 그 기기 localStorage(`splitAcct`)에만 저장한다. 코드에 기본값으로 넣지 말 것.
- 외부 사이트 정보는 **공개 페이지만**(robots.txt 허용) 읽는다. 사이트의 비공개·내부 API는 쓰지 않는다.
  - 머더미스터리 로그(머미로그)는 내부 API로만 정보를 줘서 연결하지 않았다.
  - 보드다이브 시트는 주인 것이 아니라 연결하지 않는다.
- 사용자를 테스트 속 이름(예: 「나리」)으로 부르지 않는다. 테스트의 이름은 가짜다.
- 틱틱에는 앱(서버)을 통해서만 쓴다.

## 4. 고친 뒤 순서 (매번)

1. **버전 올리기**: `app.js`의 `APP_VERSION`과 `sw.js`의 `CACHE`를 **같은 값**으로 하나 올린다(`gagyebu-vNN`). 안 올리면 휴대폰에 옛 화면이 남는다. `tests/version.js`가 둘이 같은지 본다.
2. **친구들이 쓰는 기능이 바뀌면** `notices.js`의 `NOTICES` 맨 앞에 공지를 하나 넣는다(`ver`는 새 버전 숫자). 그러면 앱을 연 사람에게 「업데이트됐어요」 창이 뜬다. 주인 전용(가계부) 변경은 넣지 않는다.
3. **테스트**: `bash tests/run.sh` (전부 `… OK`/`ALL PASS`여야 함). 새 기능은 `tests/`에 테스트를 하나 더하고 `run.sh` 목록에 넣는다.
   - Playwright와 크로미움이 필요: `npm i -g playwright && npx playwright install chromium` (환경에 이미 있으면 생략).
   - 테스트는 `script.google.com` 요청을 `page.route`로 가짜 응답한다. 진짜 시트는 건드리지 않는다.
   - 앱의 `confirm/prompt` 대신 쓰는 `ask()`는 테스트에서 `window.__askAuto = (msg, isInput) => …`로 자동 응답한다.
4. **커밋하고 `main`에 푸시**. 사용자는 직접 커밋하지 않는다. 앱은 푸시하면 바로 배포된다.
5. **Code.gs를 바꿨다면** 푸시만 하면 GitHub Actions(「Code.gs 자동 배포」)가 같은 배포 주소에 새 버전으로 올린다.
   - 결과 확인: `https://api.github.com/repos/bab-works/bab-zip/actions/workflows/deploy-gas.yml/runs?per_page=1`
   - 저장소 비밀값 `CLASPRC_JSON`, `SCRIPT_ID`, `APP_TOKEN`이 필요하다(이미 넣어 둠). 실패하면 앱은 그대로고 배포만 멈춘다.
   - Apps Script 버전은 프로젝트당 200개까지. 많이 쌓이면 사용자에게 오래된 버전 정리를 알린다.

## 5. 구조에서 알아야 할 것

### 서버 (Code.gs)
- 인증: 토큰(`?token=`) = 주인 비밀번호(스크립트 속성 `APP_TOKEN` 우선, 없으면 `TOKEN`) 또는 친구 접속코드(`f`+11자리). `who_(token)` → `{role:'owner'|'friend', name, code}`.
- 친구는 `친구` 탭에 [이름, 접속코드, 만든 날, 초대ID, 비밀번호 해시]. 처음 비밀번호는 1234. 친구 비밀번호 칸을 지우면 1234로 돌아간다.
- 주인 전용 동작은 `OWNER_ONLY_` 배열. 친구는 가계부(`what=` summary·거래)를 못 본다.
- 목록(`LISTS`): book·buy·wish·escape·board·movie·play와 위시리스트 escapeWant·boardWant·movieWant·playWant.
  - 주인 것은 시트의 각 탭에 있다(열 이름으로 찾음).
  - 친구 것은 `친구 기록` 탭(JSON)에 있다.
- 친구 기능 탭: `친구 관계`(신청/친구), `공개`(친구 집에 공개한 기록 id), `집`(아이콘·소개), `제보`, `친구 습관`.
- 태그: 기록의 「함께한 사람」에 친구 이름이 있으면 그 친구 목록에 읽기 전용(`id: 's:…'`, `shared: 이름`)으로 보인다.
  - 친구 사이일 때만 보인다.
  - 내가 같은 작품을 이미 기록했으면 따로 띄우지 않고 내 기록의 `others`에 친구 평가만 붙인다.
- 속도: `cached_(key, 초, fresh, fn)`가 CacheService에 응답을 잠깐 둔다. 쓰기가 있으면 `DATA_VER`가 바뀌어 캐시가 무효가 된다. 시트 쓰기는 `withLock_`.
- 검색(서버가 외부 공개 페이지를 읽음): 책=알라딘, 보드게임=코리아보드게임즈, 영화·시리즈=Worker의 TMDB API(비밀값 TMDB_READ_TOKEN), 별도 시트 설치본의 영화=키노라이츠, 방탈출=전국방탈출 테마 목록을 시트에 모아 둔 것.

### 앱 (app.js)
- 화면 = `SECTIONS`(사이드 메뉴): 오늘(home)·가계부(money)·독서·방탈출·보드게임·영화·연극·습관·친구·공지사항.
  - `setSection(k)`이 바꾼다.
  - 가계부 안의 보기는 `show('home'|'cal'|'list'|'rec')`.
- 목록 입력 칸은 `LIST_FIELDS`, 목록 한 줄 모양은 `LIST_ROW`.
- 쓰기는 `queue({action, …})`로 보낸다(오프라인이면 쌓였다가 나중에 보냄). 새 기록을 직접 저장할 땐 `saveNew(list, item)`(「새 기록은 친구 공개」 설정을 따름).
- 테마: `html[data-skin]`(main·clay·ios·cuberto·linear). 색은 CSS 변수(`--bg --glass --fg --muted --line --fill --accent --accent-soft --shadow`)만 쓴다. 새 화면도 이 변수로 만들어 모든 테마에서 어울리게.
- 아이콘은 이모지 대신 `index.html`의 SVG `<symbol>`(`<svg class="i"><use href="#i-…"/></svg>`). 평가 이모지(😍🙂😐😕😫)는 데이터라 그대로.
- 대화창은 브라우저 기본 alert/confirm 대신 `ask(msg, {ok, danger, input})`와 `toast(글, ms, 되돌리기)`.

### 이미 겪은 함정
- CSS 클래스 이름 `.enter`는 모든 화면이 열릴 때 붙는 애니메이션이다. 다른 용도로 같은 이름을 쓰면 화면이 커졌다 작아진다.
- `setFab(true)`가 ＋ 버튼을 **숨김**이다(이름과 반대 느낌).
- 클레이 테마는 `button`에 그림자를 강하게 준다. 카드처럼 쓰는 버튼은 `html[data-skin] .클래스 { box-shadow:none !important; … }`로 막는다.
- 파일 위쪽 코드가 아래쪽 `let/const`를 먼저 부르면 오류가 난다(TDZ). 그럴 땐 함수 선언이나 `var`.
- iOS는 사파리와 홈 화면 앱의 저장 공간이 따로라, 홈 화면 앱에서 다시 로그인해야 한다.
- iOS는 `await` 뒤에 클립보드 복사가 막힐 수 있다. 「복사하기」 버튼을 늘 같이 둔다.

## 6. 사용자가 좋아하는 방식

- 알아서 끝까지: 구현 → 테스트 → 커밋·푸시까지 하고, 결과를 쉬운 말로 짧게 알려준다.
- 휴대폰으로 많이 본다. 화면은 폭 390px 기준으로 확인하고, 글이 좁게 꺾이지 않게(`word-break:keep-all`).
- 디자인은 테마마다 일관되게. 「밤티」(촌스러움)를 싫어한다. 장식용 이모지·느낌표를 줄인다.
- 코드 파일을 보여줄 땐 내려받기보다 바로 보이게.
- 개인 계좌·비밀번호를 대화나 공개 저장소에 노출하지 않게 먼저 챙긴다.

## 7. 아직 남은 일 (notices.js의 ROADMAP과 같음)

- 연극·뮤지컬 자동 검색(공개 정보원 찾는 중), 머더미스터리 기록 방법
- 앱을 닫아도 오는 알림: `push/worker.js`를 배포하고 `PUSH_URL`을 채워야 함
- 친구 신청이 오면 바로 알리기
- 처음 여는 속도(Apps Script가 1~3초). 더 빠르게 하려면 친구 기능부터 클라우드플레어 Workers+D1로 옮기는 안이 있다(사용자와 상의 후)
- 여러 개 옮기기 되돌리기
