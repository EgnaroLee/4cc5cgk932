-- Cloudflare D1 스키마 (새로 설치할 때: wrangler d1 execute planbook --remote --file=schema.sql)
-- 이미 운영 중인 DB 는 migrations/ 의 파일을 번호 순서대로 실행하세요.
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
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  sub TEXT NOT NULL DEFAULT '',
  start TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',       -- 사용 안 함 (외부 이미지 제거)
  tpl INTEGER NOT NULL DEFAULT 0,
  share TEXT,                           -- 링크 공유 토큰
  updated INTEGER NOT NULL,
  access TEXT NOT NULL DEFAULT 'private', -- 링크 공유 범위: private | view | edit(로그인 필요)
  rev INTEGER NOT NULL DEFAULT 1          -- 저장할 때마다 +1, 동시 편집 충돌 감지
);
CREATE INDEX IF NOT EXISTS plans_owner ON plans(owner_id,updated DESC);
CREATE TABLE IF NOT EXISTS plan_members(  -- 초대 링크로 들어온 사람
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                     -- viewer | editor
  added INTEGER NOT NULL,
  PRIMARY KEY(plan_id,user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON plan_members(user_id);
CREATE TABLE IF NOT EXISTS plan_invites(  -- 초대 링크
  token TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  exp INTEGER,                            -- NULL = 만료 없음
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_plan ON plan_invites(plan_id);
