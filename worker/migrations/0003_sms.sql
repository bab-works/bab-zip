-- 카드 결제 문자 보관함: 단축어가 보낸 문자를 그대로 저장 (같은 문자는 id가 같아 한 번만). 시트가 가져가면 status=done
CREATE TABLE IF NOT EXISTS sms_inbox (
  id TEXT PRIMARY KEY,
  received INTEGER NOT NULL,
  text TEXT NOT NULL,
  parsed TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sms_inbox_status ON sms_inbox (status, received);
