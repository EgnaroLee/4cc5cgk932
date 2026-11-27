-- 계정 연결 기능 (이미 운영 중인 DB 에 한 번만 실행)
ALTER TABLE logins ADD COLUMN cc TEXT;
CREATE TABLE IF NOT EXISTS identities(id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, pid TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL, UNIQUE(provider,pid));
CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id);
INSERT OR IGNORE INTO identities(provider,pid,user_id,name,created) SELECT provider,pid,id,name,created FROM users WHERE provider<>'acct';
DELETE FROM logins;
