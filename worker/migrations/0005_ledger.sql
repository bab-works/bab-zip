-- 주인 가계부 (2단계). 시트 「거래」 탭과 같은 내용. 결제유형·할부 진행은 저장하지 않고 읽을 때 계산
-- seq = 시트의 줄 순서(새 거래는 맨 뒤), rev = 마지막으로 바뀐 시각(ms, 앱의 지난 기록 지문용)
CREATE TABLE IF NOT EXISTS ledger_tx (
 id TEXT PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL DEFAULT '', type TEXT NOT NULL,
 major TEXT NOT NULL, minor TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', pay TEXT NOT NULL DEFAULT '',
 amount INTEGER NOT NULL, memo TEXT NOT NULL DEFAULT '', orig TEXT NOT NULL DEFAULT '', inst INTEGER NOT NULL DEFAULT 0,
 seq INTEGER NOT NULL, rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ledger_tx_date ON ledger_tx (date);
CREATE INDEX IF NOT EXISTS ledger_tx_seq ON ledger_tx (seq);
-- 카테고리·결제수단·분류규칙(시트에서 고침) / 예산·반복·카드 실적(앱에서 고침) / active(전환 여부)·ver(바뀐 시각)·recRun
CREATE TABLE IF NOT EXISTS ledger_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK (json_valid(value)));
