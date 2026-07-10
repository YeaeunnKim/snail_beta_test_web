# Snail Beta Test Web — 사장님 베타 테스트 웹

네일 예약 플랫폼 **Snail**의 사장님(샵 오너) 관리 웹을 베타 테스트용 모바일 웹으로 변형한 fork입니다.

- 원본: `snail_owner_web`
- 현재 repo: `snail_beta_test_web`
- 실제 clone URL: `https://github.com/YeaeunnKim/snail_beta_test_web.git`

## 핵심 기능

- 계정 관리: 회원가입, 로그인, 비밀번호 재설정
- 베타 온보딩: 가입 후 샵/영업시간/디자이너/디자인 입력
- 사업자 인증 게이트: 인증 제출 및 대기 상태 확인
- 샵 관리: 샵 정보, 영업시간 등
- 스케줄/예약 운영: 예약성 목록과 상태 관리
- 디자인 관리: 디자인 등록, AI 분석 상태, 폴더/공개 상태 관련 UI
- 알림/운영 목록: 예약/문의/알림성 데이터를 운영 화면에서 확인

## 기술 스택

| 항목 | 선택 |
|---|---|
| 프레임워크 | **Next.js 15.1.6** (App Router) |
| 언어 | **TypeScript 5.7 strict** |
| 런타임 UI | **React 19** |
| 스타일링 | **Tailwind CSS 4** |
| 상태/서버 상태 | **Zustand**, **TanStack Query** |
| 폼 | **React Hook Form** + **Zod** |
| 타입 생성 | **openapi-typescript** |
| 패키지 매니저 | **pnpm 11.5.0** |

## 개발 환경

| 항목 | 최소 요구 |
|---|---|
| Node.js | 20.0 이상 |
| pnpm | 9.0 이상 |
| 브라우저 | Chrome/Safari 최신 |

## 시작하기

```bash
# 1. 레포 클론
git clone https://github.com/YeaeunnKim/snail_beta_test_web.git
cd snail_beta_test_web

# 2. 의존성 설치
pnpm install

# 3. 환경 변수 설정
cp .env.example .env.local
# .env.local에서 API URL 등 수정

# 4. OpenAPI 타입 생성 (선택)
pnpm run generate:types

# 5. 개발 서버 실행
pnpm dev
# → http://localhost:3000
```

## 검증

```bash
pnpm typecheck
pnpm lint
pnpm build
```

자동 테스트와 CI는 현재 없습니다.

## 백엔드 API 참조

API 계약은 로컬 `backend-context/`를 기준으로 아래 순서로 확인합니다.

1. `backend-context/owner_web.ai.txt`
2. `backend-context/api_cookbook.ai.txt`
3. `backend-context/openapi.json`

`src/types/api.d.ts`는 `openapi-typescript` 자동 생성물입니다. 직접 수정하지 마세요.

## 환경 변수

| 키 | 설명 | 기본값 |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | 백엔드 API 주소 | `http://localhost:8000/api/v1` |
| `NEXT_PUBLIC_APP_NAME` | 앱 이름 | `스네일 사장님` |
| `NEXT_PUBLIC_GITHUB_PAGES_URL` | API 문서 URL | (옵션) |

## 실제 페이지 구조

```text
src/app/
├── (auth)/
│   ├── login/page.tsx
│   ├── register/page.tsx
│   └── password-reset/page.tsx
├── (gate)/
│   ├── business-verification/page.tsx
│   └── pending/page.tsx
├── dashboard/
│   ├── designs/page.tsx
│   ├── notifications/page.tsx
│   ├── schedule/page.tsx
│   └── shop/page.tsx
└── onboarding/page.tsx
```

`dashboard/reservations`와 `dashboard/reviews` 라우트는 현재 존재하지 않습니다. 라우트/구조와 에이전트 작업 규칙은 [AGENTS.md](AGENTS.md)를 기준으로 합니다.

## 관련 레포

| 레포 | 설명 |
|---|---|
| [snail_backend_specification](https://github.com/poi82999/snail_backend_specification) | 백엔드 명세서 + API 코드 |
| [snail_ios](https://github.com/poi82999/snail_ios) | 유저 iOS 앱 |
