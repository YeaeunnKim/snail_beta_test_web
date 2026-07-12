# AGENTS.md — Agent Guide SSOT

이 파일이 에이전트 가이드 SSOT. `CLAUDE.md`·`.cursorrules`·`.gemini/AGENTS.md`·`.github/copilot-instructions.md`는 이 파일을 가리킨다. 이 repo는 `snail_owner_web`의 베타 fork다.

## 0. 프로젝트

- 정체: 네일 예약 플랫폼 사장님 웹의 베타 테스트(모바일 웹) 변형.
- 원본: `snail_owner_web`; 현재 repo: `snail_beta_test_web`.
- 스택: Next.js 15.1.6 App Router, React 19, TypeScript 5.7 strict, pnpm 11.5.0, Tailwind v4.
- 상태/데이터: Zustand, TanStack Query, React Hook Form + Zod, openapi-typescript.
- 작업 원칙: work-order의 `ALLOWED-FILES`에 있는 파일만 수정한다. 의존성 추가, git 커밋/브랜치/푸시는 금지.

## 1. 실행·검증

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm build
```

- 완료 검증은 `pnpm typecheck && pnpm lint && pnpm build`.
- CI: `.github/workflows/ci.yml` (main PR/push) — `pnpm install --frozen-lockfile → typecheck → lint`. `build`는 초기 제외(TODO).
- 자동 유닛 테스트 러너는 없다.
- 브라우저 런타임 검증이 필요하면 `.claude/skills/verify/`의 approved-owner 세션 주입 Playwright 하네스를 우선 확인한다(owner 웹에서 이식한 코드 정독본 — 첫 구동 시 셀렉터 대조 필요).
- `package.json`의 의존성/스크립트는 work-order가 명시하지 않으면 바꾸지 않는다.

## 1.1 배포 규칙

- Production 배포는 `main` merge 후 `pnpm deploy:main`만 사용한다.
- 작업자 로컬 트리, feature 브랜치, 미커밋 변경을 `vercel --prod`로 직접 배포하지 않는다.
- `scripts/deploy-main.ps1`은 원격 GitHub `main`을 임시 clone하고 고정 Vercel org/project id로 배포한다.
- 배포 전 점검은 `powershell -ExecutionPolicy Bypass -File scripts/deploy-main.ps1 -DryRun`.
- 배포 후 `pnpm verify:deploy-target`로 production URL, 번들 API base, 백엔드 health, CORS를 확인한다.
- canonical production URL은 `https://snailbetatestweb.vercel.app`, API base는 `https://api.snail-nail.com/api/v1`이다.
- `https://snail-beta-test-web.vercel.app`는 현재 프로젝트 alias가 아니므로 사용하지 않는다.

## 2. 백엔드 계약

API 계약은 아래 순서로 읽는다.

1. `backend-context/owner_web.ai.txt`
2. `backend-context/api_cookbook.ai.txt`
3. `backend-context/openapi.json`

- `src/types/api.d.ts`는 `openapi-typescript` 자동 생성물이다. 손수정 금지.
- 백엔드 계약 배포/동기화는 backend repo의 `tools/sync_contract.ps1`가 담당한다.
- 현재 `backend-context/`는 stale/불완전할 수 있다. 별도 지시 없이는 이 디렉터리를 수정하지 않는다.
- 계약 드리프트와 기능 갭은 `docs/OWNER_WEB_GAPS.md`를 먼저 확인한다.

## 3. 실제 라우트/구조

`src/app/` 실제 라우트:

```text
src/app/
├── (auth)/
│   ├── login/
│   ├── register/
│   └── password-reset/
├── (gate)/
│   ├── business-verification/
│   └── pending/
├── dashboard/
│   ├── designs/
│   ├── notifications/
│   ├── schedule/
│   └── shop/
└── onboarding/
```

- `(dashboard)/reservations`, `(dashboard)/reviews`는 없다.
- 예약 운영 기능은 `dashboard/schedule/`, 알림/예약성 목록 기능은 `dashboard/notifications/` 쪽에 흡수되어 있다.
- 사업자 인증/대기 게이트는 `(gate)/`, 베타 온보딩은 `onboarding/`에 있다.

주요 소스 구조:

```text
src/
├── app/
├── components/ui/
├── hooks/
├── lib/
├── services/
├── stores/
├── styles/
└── types/
```

## 4. 함정

- `GET /shops/me/designs` 응답이 `ListResponse` envelope로 바뀌었지만 `src/types/api.d.ts`가 stale이면 `designs.map is not a function` 크래시가 날 수 있다. 자세한 내용은 `docs/OWNER_WEB_GAPS.md`.
- 베타에는 `BETA_AUTO_APPROVE_OWNERS` 자동승인 플로우가 있다. 가입 즉시 승인되는 경로를 기존 사업자 인증 전제로 덮어쓰지 않는다.
- `src/app/dashboard/designs/page.tsx`는 약 1,218줄의 대형 파일이고 인라인 컴포넌트가 많다. 편집 시 blast-radius가 크므로 작은 단위로 확인한다.
- `backend-context/`와 `src/types/api.d.ts` 계약 수정은 사령관 지시 없이는 하지 않는다.

## 5. 코드 스타일

- 기존 코드의 네이밍, 주석 밀도, 컴포넌트 분리 방식을 따른다.
- TypeScript strict를 전제로 타입을 명시한다.
- Tailwind v4와 기존 `components/ui` 관례를 우선한다.
- 클라이언트 상태는 기존 Zustand/TanStack Query 패턴을 따른다.
- 폼은 React Hook Form + Zod 패턴을 따른다.
- 비즈니스 로직 주석은 필요할 때 한국어로 짧게 남긴다.
