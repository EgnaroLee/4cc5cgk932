-- 소셜 로그인 콜백 중복 처리 방지 (이미 운영 중인 DB 에 한 번만 실행)
CREATE TABLE IF NOT EXISTS oauth_codes(hash TEXT PRIMARY KEY, user_id INTEGER, exp INTEGER NOT NULL);
