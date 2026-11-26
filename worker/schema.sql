-- Cloudflare D1 스키마 (wrangler d1 execute planbook --remote --file=schema.sql)
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  pid TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  UNIQUE(provider,pid)
);
CREATE TABLE IF NOT EXISTS sessions(
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS logins(      -- 소셜 로그인 직후 1회용 코드 (60초)
  hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plans(
  id TEXT PRIMARY KEY,                  -- [a-z0-9]{12}
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL = 아직 주인이 없는 이전 대기 플랜북
  data TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  sub TEXT NOT NULL DEFAULT '',
  start TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  tpl INTEGER NOT NULL DEFAULT 0,
  share TEXT,                           -- 읽기 전용 공유 토큰 (NULL = 공유 안 함)
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plans_owner ON plans(owner_id,updated DESC);
