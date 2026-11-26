-- 공유 기능 추가 (이미 운영 중인 DB 에 한 번만 실행)
ALTER TABLE plans ADD COLUMN access TEXT NOT NULL DEFAULT 'private';
ALTER TABLE plans ADD COLUMN rev INTEGER NOT NULL DEFAULT 1;
UPDATE plans SET access='view' WHERE share IS NOT NULL;
CREATE TABLE IF NOT EXISTS plan_members(plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, added INTEGER NOT NULL, PRIMARY KEY(plan_id,user_id));
CREATE INDEX IF NOT EXISTS members_user ON plan_members(user_id);
CREATE TABLE IF NOT EXISTS plan_invites(token TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE, role TEXT NOT NULL, exp INTEGER, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS invites_plan ON plan_invites(plan_id);
