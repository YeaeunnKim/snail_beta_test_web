# Vercel 배포 가이드 (베타 테스트 웹)

베타 테스트용 웹으로, 운영자(admin)·사장님(owner) 웹과 **분리된 별도 Vercel 프로젝트**로
배포한다. Next.js 15 App Router라 Vercel zero-config로 동작하며, 배포는 **Git 연동
(푸시-투-디플로이)** 방식으로 확립한다.

- GitHub: `YeaeunnKim/snail_beta_test_web`
- 프레임워크: Next.js (Vercel 자동 감지), 패키지 매니저: pnpm(lockfile 자동 감지)
- Node: `>=20` (package.json engines)
- 빌드 산출물: `.next/` 서버 번들(정적 export 아님) → Vercel serverless로 자동 처리

---

## 1. 배포 모델 (Git 연동)

Vercel 프로젝트를 GitHub 레포에 연결하면 아래가 **자동**으로 일어난다. 별도 CI 배포
스크립트나 GitHub secret이 필요 없다.

| 트리거 | 결과 | URL |
|---|---|---|
| `main`에 push/merge | **Production 배포** | 프로덕션 도메인 (예: `snailbetatestweb.vercel.app` 또는 커스텀) |
| PR 생성/갱신, 비-main 브랜치 push | **Preview 배포** | 배포마다 고유한 프리뷰 URL |

> 품질 게이트: `.github/workflows/ci.yml`가 PR·main push에서 `typecheck → lint → build`를
> 돌린다. main 머지 전 CI 통과를 required check으로 두는 것을 권장.

### 베타 테스트 특성상 고려사항
- **접근 제한**: 일반 공개가 아니라면 Vercel → Settings → **Deployment Protection**
  (Vercel Authentication / Password Protection)으로 테스터 외 접근을 막는 것을 권장.
- **백엔드 대상**: 프로덕션 데이터를 오염시키면 안 되면 `NEXT_PUBLIC_API_BASE_URL`을
  **스테이징/베타 백엔드**로 지정할 것. 프로덕션 API를 쓸 경우 테스트 계정만 사용.

---

## 2. Vercel 프로젝트 생성 (최초 1회)

1. Vercel → **Add New… → Project** → `YeaeunnKim/snail_beta_test_web` **Import**.
2. 설정(대부분 자동):
   - Framework Preset: **Next.js**
   - Root Directory: `./` (레포 루트)
   - Build / Install / Output Command: **기본값 그대로** (pnpm 자동 감지)
   - Production Branch: **`main`**
3. 아래 **§3 환경변수**를 넣고 **Deploy**.

> CLI 대안: `npm i -g vercel && vercel link && vercel --prod`
>
> 기존 Vercel 프로젝트가 다른 repo에 연결돼 있으면 Git 연결을 `YeaeunnKim/snail_beta_test_web`으로
> 교체한다. `vercel git connect`가 `Failed to connect ... Make sure ... you have access`로
> 실패하면, Vercel GitHub App이 이 private repo에 설치/허용되지 않은 상태다. Vercel 대시보드의
> Git 연결 화면에서 GitHub App 권한에 `YeaeunnKim/snail_beta_test_web`을 추가한 뒤 다시 Connect한다.

---

## 3. 환경변수 (Vercel → Settings → Environment Variables)

| 변수 | 값 | 스코프 | 비고 |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.snail-nail.com/api/v1` (또는 베타/스테이징 백엔드) | Production, Preview | **`/api/v1`까지 포함**한 전체 경로 |
| `NEXT_PUBLIC_APP_NAME` | (베타 앱 표기, 예: `스네일 베타`) | (선택) All | 헤더/타이틀 표기 |
| `NEXT_PUBLIC_API_DOCS_URL` | (선택) | All | 미사용 시 생략 |

> ⚠️ **개발 전용 변수는 프로덕션에 넣지 말 것**:
> `NEXT_PUBLIC_DEV_AUTOLOGIN`(기본 `0`), `NEXT_PUBLIC_DEV_OWNER_EMAIL`,
> `NEXT_PUBLIC_DEV_OWNER_PASSWORD`.
>
> ⚠️ `NEXT_PUBLIC_*`는 **빌드타임에 번들로 인라인**된다. 값 변경 시 Vercel **Redeploy** 필요.

---

## 4. CORS — 백엔드에 요청 [배포 전 필수]

브라우저에서 백엔드로 교차 출처 요청을 하므로, 백엔드 `CORS_ORIGINS`에 이 웹의 origin이
없으면 **모든 API 호출이 브라우저에서 차단**된다.

1. `CORS_ORIGINS`에 이 웹의 운영/프리뷰 도메인 추가
   (예: `https://snailbetatestweb.vercel.app`, `https://snail-beta-test-web.vercel.app`).
2. 스테이징 백엔드를 쓸 경우 해당 백엔드에 등록.
3. 등록 후 백엔드 리로드.

---

## 5. 배포 후 스모크 체크리스트

- [ ] `/login` 200, 페이지 렌더
- [ ] 미인증 상태 `/dashboard/*` → 로그인/게이트 리다이렉트
- [ ] `/register`, `/onboarding`, `/password-reset` 렌더
- [ ] (Deployment Protection 설정 시) 테스터 인증 없이는 접근 불가 확인
- [ ] CORS 등록 후: 테스트 계정 로그인 → `/dashboard` 진입, 주요 조회/동작

---

## 6. 함정 요약
- **CORS 미등록** = 로그인조차 안 됨. §4 먼저.
- **Deployment Protection**: 기본 Vercel URL로 스모크하려면 SSO 보호가 꺼져 있어야 한다.
  `all_except_custom_domains`가 켜져 있으면 `/login`도 앱 대신 Vercel SSO로 302된다.
  베타 접근 제한이 필요하면 스모크 후 Password Protection 등 테스터 친화적인 보호를 별도로 건다.
- **Vercel 팀 author 체크**: Hobby/team 프로젝트에서는 deployment commit author가 Vercel 팀에
  접근 가능한 계정으로 매칭돼야 한다. `Deployment Blocked`가 뜨면 `git config user.email`을
  Vercel 팀 소유자/멤버 이메일(현재 팀 소유자: `glamnowlab@gmail.com`)로 맞춘 뒤 커밋을 다시 작성한다.
- **API URL 규약**: `NEXT_PUBLIC_API_BASE_URL`에 `/api/v1`까지 포함(전체 경로).
- **`NEXT_PUBLIC_*` 빌드타임 인라인** → 값 변경 시 Redeploy.
- **`DEV_AUTOLOGIN=1` 프로덕션 금지**.
- 베타 테스트 웹이 공개되면 안 되면 **Deployment Protection** 필수.
