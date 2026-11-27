-- 로그인 출입증(세션). 토큰 자체는 저장하지 않고 SHA-256만. 계정이 지워지면 출입증도 같이 사라짐
CREATE TABLE IF NOT EXISTS sessions (
 hash TEXT PRIMARY KEY, person TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 expires INTEGER NOT NULL, created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_person ON sessions (person);
