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

## 6. 이미 운영 중인 DB 를 새 기능으로 올릴 때

`migrations/` 의 파일을 번호 순서대로, 각각 **한 번만** 실행합니다. (새로 설치하는 경우는 `schema.sql` 에 모두 포함되어 있음)

```bash
npx wrangler d1 execute planbook --remote --file=migrations/002_sharing.sql   # 공유 범위 (이미 실행했다면 건너뜀)
npx wrangler d1 execute planbook --remote --file=migrations/003_accounts.sql  # 계정 연결 (로그인 수단 분리)
```

> **배포 순서**: 003 → Worker 코드 교체(Deploy) → 사이트(PR 병합). 새 로그인 방식은 사이트와 Worker 가 함께 바뀌어야 하므로 Worker 교체와 PR 병합은 가까운 시간에 하세요.
> 003 을 실행하면 진행 중이던 로그인 코드(60초짜리)가 모두 지워집니다. 그 순간 로그인하던 사람은 다시 시도해야 합니다.

## 계정 연결

- 한 계정에 여러 로그인 수단(Google, 카카오)을 연결할 수 있습니다. `users` 가 계정, `identities` 가 로그인 수단입니다.
- 로그인한 상태에서 **계정 → 연결**을 누르고 다른 서비스로 로그인하면 그 수단이 현재 계정에 붙습니다.
- 연결하려는 수단이 이미 **데이터가 있는 다른 계정**에 속해 있으면 "합치기" 확인을 거칩니다. 합치면 상대 계정의 플랜북·공유받은 플랜북·로그인 수단이 현재 계정으로 옮겨지고 상대 계정은 삭제됩니다(되돌릴 수 없음). 합친 뒤 플랜북이 50개를 넘으면 거절됩니다.
- 마지막 로그인 수단은 해제할 수 없습니다.
- **로그인 코드 검증**: 로그인을 시작할 때 브라우저가 만든 비밀의 해시(`cc`)를 보내고, 1회용 코드는 그 비밀(`cv`)을 가진 브라우저만 교환·연결에 쓸 수 있습니다. 남이 만든 로그인 코드를 내 브라우저에 심는 공격(로그인 CSRF)과 코드 가로채기를 막습니다.
- 계정 삭제(`DELETE /api/me`)는 계정, 플랜북, 공유·초대, 구성원 관계, 세션, 로그인 수단을 모두 지웁니다.

## 이용약관 · 개인정보처리방침

`terms.html`, `privacy.html` 은 초안입니다. 아래를 **직접 채우고**(노란색으로 표시된 칸), 필요하면 법률 검토를 받으세요.

- 운영자 이름, 이메일 (두 문서의 `[… 입력하세요]` 칸)
- Google 앱 게시 화면과 Kakao 앱 설정에 두 문서의 주소를 등록 (`https://<사이트 주소>/privacy.html`, `terms.html`)
- 서비스에서 수집·처리하는 내용이 달라지면(예: 이메일 수집, 새 외부 서비스) 방침도 함께 고치세요.

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
| `GET /auth/{google,kakao}/start?return=<사이트 URL>&cc=<검증값 해시>` | 소셜 로그인 시작 |
| `GET /auth/{google,kakao}/callback` | 제공자가 돌아오는 주소 → 사이트로 `#code=` 와 함께 이동 |
| `POST /auth/exchange` | 1회용 코드(60초) + 검증값(`cv`) → 세션 토큰(30일) |
| `POST /auth/logout` | 세션 삭제 |
| `GET /api/me` · `DELETE /api/me` | 내 계정·연결된 로그인 수단 · 계정 삭제 `{confirm:true}` |
| `POST /api/link/preview` · `POST /api/link` | 계정 연결 미리보기 · 연결/합치기 `{code, cv, merge?}` |
| `DELETE /api/identities/:id` | 로그인 수단 해제 (마지막 하나는 불가) |
| `GET /api/plans` · `POST /api/plans` | 내 플랜북 + 공유받은 플랜북 목록 · 새로 만들기 (최대 50개) |
| `GET/PUT/DELETE /api/plans/:id` | 읽기 · 저장(`{data, rev}`) · 삭제(소유자). 링크로 접근할 때는 `?s=<토큰>` |
| `PUT /api/plans/:id/sharing` | 링크 공유 범위 변경 `{access, rotate?}` (소유자) |
| `POST /api/plans/:id/invites` · `DELETE …/invites/:token` | 초대 링크 만들기 `{role, days}` · 삭제 (소유자) |
| `PUT/DELETE /api/plans/:id/members/:userId` | 구성원 역할 변경 · 내보내기. `members/me` 는 스스로 나가기 |
| `GET /api/invites/:token` · `POST …/accept` | 초대 미리보기(로그인 불필요) · 수락 |

남의 플랜북에 접근하면 존재 여부를 알려 주지 않고 404 를 돌려줍니다. 외부 이미지 주소는 저장하지 않고, 티켓 링크는 `https` 만 허용합니다.
