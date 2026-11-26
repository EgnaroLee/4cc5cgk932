# 플랜북 Worker 설정 (소셜 로그인 + D1)

구조: GitHub Pages(정적 사이트) ⇄ Cloudflare Worker `planbook-admin` ⇄ D1 데이터베이스.
로그인은 Google / Kakao, 플랜북은 로그인한 사용자별로 저장됩니다. 공유는 읽기 전용 링크(`plan.html?id=…&s=…`)만 가능합니다.

## 1. D1 만들기

```bash
cd worker
npx wrangler d1 create planbook
```

출력된 `database_id` 를 `wrangler.toml` 의 `REPLACE_WITH_D1_DATABASE_ID` 자리에 넣습니다.

```bash
npx wrangler d1 execute planbook --remote --file=schema.sql
```

## 2. 소셜 로그인 앱 등록

리디렉션 URI(Redirect URI)는 둘 다 아래 형식입니다. (Worker 주소는 배포 후 확정)

- Google: `https://planbook-admin.sukzzang0907.workers.dev/auth/google/callback`
- Kakao: `https://planbook-admin.sukzzang0907.workers.dev/auth/kakao/callback`

**Google** — Google Cloud Console → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션).
승인된 리디렉션 URI 에 위 주소를 넣습니다. 동의 화면의 범위는 기본(`openid`, `profile`)이면 충분합니다. 이메일은 받지 않습니다.

**Kakao** — Kakao Developers → 애플리케이션 추가 → 카카오 로그인 활성화 → Redirect URI 등록.
동의항목에서 `프로필 정보(닉네임)` 만 켭니다. REST API 키를 사용합니다. (보안 → Client Secret 을 켰다면 그 값도 아래에 등록)

## 3. 시크릿 / 변수 등록

```bash
npx wrangler secret put SESSION_SECRET        # 아무 긴 무작위 문자열 (예: openssl rand -base64 32)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put KAKAO_REST_KEY
npx wrangler secret put KAKAO_CLIENT_SECRET   # 카카오에서 Client Secret 을 켠 경우만
```

`ALLOW_ORIGIN`(사이트 origin)은 `wrangler.toml` 의 `[vars]` 에 있습니다. 사이트 주소의 origin 은 저장소 이름을 바꿔도 `https://egnarolee.github.io` 로 같습니다.
시크릿 값은 저장소에 커밋하지 않습니다.

## 4. 배포

```bash
npx wrangler deploy
```

> 이전(비밀번호 + GitHub 커밋) 방식의 Worker 변수 `OWNER`, `REPO`, `ADMIN_PASSWORD`, `GITHUB_TOKEN` 은 이제 쓰지 않습니다.
> 새 Worker 를 배포하면 대시보드에 평문으로 있던 `OWNER`, `REPO` 는 지워집니다. 시크릿(`ADMIN_PASSWORD`, `GITHUB_TOKEN`)은 남으므로 사용하지 않는다면 대시보드에서 삭제하세요.
> 이 배포는 기존 사이트(비밀번호 방식)의 관리 기능을 멈추게 합니다. 새 사이트 파일과 같은 시점에 배포하세요.

## 5. 기존 푸꾸옥 플랜북 옮기기

```bash
node worker/make-seed.mjs > worker/seed.sql
cd worker && npx wrangler d1 execute planbook --remote --file=seed.sql
```

이 플랜북은 주인 없이 들어가므로 아직 아무에게도 보이지 않습니다. **사이트에서 먼저 로그인한 뒤**, 아래로 내 계정에 연결합니다.

```bash
npx wrangler d1 execute planbook --remote --command "SELECT id,provider,name FROM users"
npx wrangler d1 execute planbook --remote --command "UPDATE plans SET owner_id=<위에서 확인한 내 id> WHERE id='trip26122501'"
```

## API 요약

| 경로 | 설명 |
| --- | --- |
| `GET /auth/{google,kakao}/start?return=<사이트 URL>` | 소셜 로그인 시작 |
| `GET /auth/{google,kakao}/callback` | 제공자가 돌아오는 주소 → 사이트로 `#code=` 와 함께 이동 |
| `POST /auth/exchange` | 1회용 코드(60초) → 세션 토큰(30일) |
| `POST /auth/logout` | 세션 삭제 |
| `GET /api/plans` · `POST /api/plans` | 내 플랜북 목록 · 새로 만들기 (최대 50개) |
| `GET/PUT/DELETE /api/plans/:id` | 내 플랜북 읽기·저장·삭제 (`GET` 은 `?s=<공유토큰>` 으로 읽기 전용 열람 가능) |
| `POST/DELETE /api/plans/:id/share` | 공유 링크 만들기(`{"rotate":true}` 로 교체) · 끄기 |

남의 플랜북에 접근하면 존재 여부를 알려 주지 않고 404 를 돌려줍니다.
