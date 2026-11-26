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

## 5. 이전 방식의 시크릿 정리

이전(비밀번호 + GitHub 커밋) 방식에서 쓰던 `ADMIN_PASSWORD`, `GITHUB_TOKEN` 시크릿과 `OWNER`, `REPO` 변수는 더 이상 쓰지 않습니다.
Cloudflare 대시보드에서 삭제하고, GitHub 의 Personal access token 도 폐기하세요.

## 6. 이미 운영 중인 DB 를 공유 기능으로 올릴 때

`migrations/002_sharing.sql` 을 **한 번만** 실행합니다. (새로 설치하는 경우는 `schema.sql` 에 이미 포함)
기존 DB 에서 링크 공유 중이던 플랜북은 자동으로 "링크로 보기"가 됩니다. 이 변경은 이전 Worker 코드와도 호환되므로 Worker 배포보다 먼저 실행해도 됩니다.

```bash
npx wrangler d1 execute planbook --remote --file=migrations/002_sharing.sql
```

## 공유 범위

| 구분 | 선택지 |
| --- | --- |
| 링크 공유 (`access`) | `private` 나만 · `view` 링크가 있는 누구나 보기(로그인 불필요) · `edit` 링크가 있는 **로그인한** 누구나 편집 |
| 초대 링크 | 링크를 받은 사람이 로그인하면 구성원이 됨. 역할 `viewer`(보기) / `editor`(편집), 유효기간 1·7·30일 또는 무제한, 언제든 삭제 |
| 구성원 | 소유자가 역할 변경·내보내기. 본인은 스스로 나가기 가능 |

권한은 소유자 > 편집자 > 보기 순서입니다. 편집자는 내용만 고칠 수 있고, 삭제·공유 설정·초기화는 소유자만 할 수 있습니다.
저장할 때마다 `rev` 가 올라가고, 다른 사람이 먼저 저장했다면 409 로 거절하여 내용이 조용히 덮어써지는 것을 막습니다.

## API 요약

| 경로 | 설명 |
| --- | --- |
| `GET /auth/{google,kakao}/start?return=<사이트 URL>` | 소셜 로그인 시작 |
| `GET /auth/{google,kakao}/callback` | 제공자가 돌아오는 주소 → 사이트로 `#code=` 와 함께 이동 |
| `POST /auth/exchange` | 1회용 코드(60초) → 세션 토큰(30일) |
| `POST /auth/logout` | 세션 삭제 |
| `GET /api/plans` · `POST /api/plans` | 내 플랜북 + 공유받은 플랜북 목록 · 새로 만들기 (최대 50개) |
| `GET/PUT/DELETE /api/plans/:id` | 읽기 · 저장(`{data, rev}`) · 삭제(소유자). 링크로 접근할 때는 `?s=<토큰>` |
| `PUT /api/plans/:id/sharing` | 링크 공유 범위 변경 `{access, rotate?}` (소유자) |
| `POST /api/plans/:id/invites` · `DELETE …/invites/:token` | 초대 링크 만들기 `{role, days}` · 삭제 (소유자) |
| `PUT/DELETE /api/plans/:id/members/:userId` | 구성원 역할 변경 · 내보내기. `members/me` 는 스스로 나가기 |
| `GET /api/invites/:token` · `POST …/accept` | 초대 미리보기(로그인 불필요) · 수락 |

남의 플랜북에 접근하면 존재 여부를 알려 주지 않고 404 를 돌려줍니다. 외부 이미지 주소는 저장하지 않고, 티켓 링크는 `https` 만 허용합니다.
