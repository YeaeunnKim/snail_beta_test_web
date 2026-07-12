# Vercel 배포 가이드 (베타 테스트 웹)

베타 테스트용 웹으로, 운영자(admin)·사장님(owner) 웹과 **분리된 별도 Vercel 프로젝트**로
배포한다. Next.js 15 App Router라 Vercel zero-config로 동작한다. 이 프로젝트는 현재
GitHub App 권한 제약 때문에 production 배포를 **고정 Vercel 프로젝트로 향하는 안전 CLI 스크립트**
로 수행한다.

- GitHub: `YeaeunnKim/snail_beta_test_web`
- 프레임워크: Next.js (Vercel 자동 감지), 패키지 매니저: pnpm(lockfile 자동 감지)
- Node: `>=20` (package.json engines)
- 빌드 산출물: `.next/` 서버 번들(정적 export 아님) → Vercel serverless로 자동 처리

---

## 1. 배포 모델 (고정 main 배포 스크립트)

Production 배포는 작업자 로컬 트리나 현재 브랜치를 직접 올리지 않는다. `scripts/deploy-main.ps1`이
GitHub 원격 `main`을 임시 폴더에 shallow clone하고, Vercel org/project id를 고정한 뒤
`snail8/snail_beta_test_web`으로 배포한다.

| 트리거 | 결과 | URL |
|---|---|---|
| `main`에 merge 후 `pnpm deploy:main` | **Production 배포** | `https://snailbetatestweb.vercel.app` |
| `pnpm deploy:main -- -Preview` | **Preview 배포** | 배포마다 고유한 프리뷰 URL |
| `powershell -ExecutionPolicy Bypass -File scripts/deploy-main.ps1 -DryRun` | **배포 전 점검** | 배포 없음 |

> 품질 게이트: `.github/workflows/ci.yml`가 PR·main push에서 `typecheck → lint → build`를
> 돌린다. main 머지 전 CI 통과를 required check으로 두는 것을 권장.

### Production 배포 규칙
- **Production 배포는 `main` merge 후 `pnpm deploy:main`만 사용한다.**
- 작업자 개인 PC에서 `vercel --prod`를 직접 치지 않는다. 반드시 `scripts/deploy-main.ps1`을 통해
  원격 `main`의 깨끗한 소스만 고정 Vercel 프로젝트로 배포한다.
- 배포 후 `pnpm verify:deploy-target`를 실행해 production URL, JS 번들의 API base, 백엔드 health,
  CORS preflight를 확인한다.
- `NEXT_PUBLIC_*` 값은 빌드타임에 번들로 박히므로 Vercel env를 수정하면 반드시 Git 배포 또는
  `pnpm deploy:main`으로 새 번들을 만든다.

### 베타 테스트 특성상 고려사항
- **접근 제한**: 일반 공개가 아니라면 Vercel → Settings → **Deployment Protection**
  (Vercel Authentication / Password Protection)으로 테스터 외 접근을 막는 것을 권장.
- **백엔드 대상**: 프로덕션 데이터를 오염시키면 안 되면 `NEXT_PUBLIC_API_BASE_URL`을
  **스테이징/베타 백엔드**로 지정할 것. 프로덕션 API를 쓸 경우 테스트 계정만 사용.

---

## 2. Vercel 프로젝트 생성 (최초 1회)

1. Vercel → **Add New… → Project** → `YeaeunnKim/snail_beta_test_web` **Import** 또는 빈 프로젝트 생성 후
   `snail8/snail_beta_test_web` 프로젝트 id(`prj_zOnsvz7NMAHL7mSvCKwKk8NDMGLi`)를 확정한다.
2. 설정:
   - Framework Preset: **Next.js**
   - Root Directory: `./` (레포 루트)
   - Build / Install / Output Command: **기본값 그대로** (pnpm 자동 감지)
   - Production Branch: **`main`** (Git 연결이 가능할 때만 의미 있음)
3. 아래 **§3 환경변수**를 넣고 **Deploy**.

> CLI 배포는 `vercel --prod` 직접 실행이 아니라 `pnpm deploy:main`만 사용한다.
>
> Git 연결이 가능해지면 production branch를 `main`으로 고정해도 된다. 그 전까지 production은
> `scripts/deploy-main.ps1`의 고정 org/project id 경로가 단일 배포 경로다.

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
   (운영 canonical: `https://snailbetatestweb.vercel.app`).
   `https://snail-beta-test-web.vercel.app`는 현재 `snail8/snail_beta_test_web` 프로젝트의
   alias가 아니며, 예전 배포 번들이 폐기된 Cloud Run API를 가리키므로 사용하지 않는다.
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
- 배포 후 `pnpm verify:deploy-target`가 실패하면 alias/env/API drift로 보고 production URL을 안내하지 않는다.
- 베타 테스트 웹이 공개되면 안 되면 **Deployment Protection** 필수.
