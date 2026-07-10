# Snail Beta Test Web 아키텍처

> ⚠️ 일부 낡음: 이 문서는 원본 `snail_owner_web`에서 온 설명을 포함할 수 있습니다. 현재 실제 라우트/구조의 SSOT는 루트 `AGENTS.md`입니다.

## 프로젝트 정체

이 저장소는 네일 예약 플랫폼 사장님 웹(`snail_owner_web`)을 복사해 만든 베타 테스트용 모바일 웹 fork입니다. 제품명과 백엔드 계약의 큰 표면은 원본 사장님 웹과 공유하지만, 라우트와 화면 구성은 현재 코드 기준으로 갈라져 있습니다.

## Next.js App Router 실제 구조

현재 `src/app/` 라우트는 아래 구조입니다.

```text
src/app/
├── page.tsx
├── layout.tsx
├── (auth)/
│   ├── layout.tsx
│   ├── login/page.tsx
│   ├── register/page.tsx
│   └── password-reset/page.tsx
├── (gate)/
│   ├── layout.tsx
│   ├── business-verification/page.tsx
│   └── pending/page.tsx
├── dashboard/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── designs/page.tsx
│   ├── notifications/page.tsx
│   ├── schedule/page.tsx
│   └── shop/page.tsx
└── onboarding/page.tsx
```

현재 존재하지 않는 구 원본 라우트:

- `dashboard/reservations`
- `dashboard/reviews`
- `dashboard/designers`
- `dashboard/shop/hours`
- `dashboard/shop/images`

예약 운영 기능은 `dashboard/schedule/`, 알림/예약성 목록 기능은 `dashboard/notifications/`에 흡수되어 있습니다. 사업자 인증/대기 화면은 `(gate)/`, 베타 온보딩은 `onboarding/`에 있습니다.

## 소스 디렉터리

```text
src/
├── app/             # Next.js App Router
├── components/
│   └── ui/          # 공통 UI 컴포넌트
├── hooks/           # 화면/도메인 훅
├── lib/             # API 클라이언트, 토큰, 유틸리티
├── services/        # 백엔드 API 서비스 래퍼
├── stores/          # Zustand 스토어
├── styles/          # 전역 스타일
└── types/           # TypeScript 타입, api.d.ts 자동 생성물
```

`components/features/design/` 같은 기능별 컴포넌트 폴더는 현재 실재하지 않습니다. 새 구조를 추가할 때는 기존 코드 관례와 work-order 범위를 우선합니다.

## 인증과 게이트 흐름

```text
로그인/가입
  -> GET /owners/me
  -> verification_status 또는 베타 자동승인 상태에 따라 분기
  -> (gate)/business-verification 또는 (gate)/pending 또는 dashboard
```

베타 환경에는 `BETA_AUTO_APPROVE_OWNERS` 자동승인 플로우가 있습니다. 가입 즉시 승인되는 경로가 있으므로 원본 사장님 웹의 사업자 인증 전제만으로 흐름을 단정하지 않습니다.

## API 클라이언트

주요 역할:

1. 인증 헤더: `Authorization: Bearer <token>`
2. 변이 멱등성: `POST/PUT/PATCH/DELETE` 요청에 `Idempotency-Key`
3. 토큰 갱신: 401 응답 시 refresh 후 재시도
4. 에러 정규화: 서버 에러를 프론트에서 다루는 형태로 변환
5. 타입 안전성: OpenAPI에서 생성한 `src/types/api.d.ts` 사용

## 백엔드 계약

계약은 아래 순서로 확인합니다.

1. `backend-context/owner_web.ai.txt`
2. `backend-context/api_cookbook.ai.txt`
3. `backend-context/openapi.json`

`src/types/api.d.ts`는 `openapi-typescript` 자동 생성물입니다. 손수정하지 않습니다.

```bash
pnpm run generate:types
```

현재 backend-context와 generated type이 stale일 수 있습니다. 계약 드리프트와 알려진 갭은 `docs/OWNER_WEB_GAPS.md`를 확인합니다.

## 주요 페이지별 API 표면

| 페이지 | 핵심 API/도메인 | 비고 |
|---|---|---|
| 로그인 | `POST /auth/owner/login` | |
| 회원가입/온보딩 | owner signup, shop setup, designer/design setup | 베타 플로우 포함 |
| 사업자 인증 | `POST /owners/me/business-verification` | `(gate)/business-verification` |
| 샵 정보 | `GET/POST/PATCH /shops/me` | `dashboard/shop` |
| 스케줄/예약 | reservation list/actions | `dashboard/schedule` |
| 디자인 목록/관리 | `GET/POST/PATCH /shops/me/designs*` | envelope 드리프트 주의 |
| 알림/운영 목록 | notifications/inquiries/reservation-related data | `dashboard/notifications` |

## 알려진 주의점

- `GET /shops/me/designs` 응답이 envelope로 바뀌어, stale `api.d.ts`와 배열 전제 소비가 만나면 `designs.map is not a function` 크래시가 날 수 있습니다.
- `src/app/dashboard/designs/page.tsx`는 약 1,218줄 대형 파일입니다. 부분 수정 시 주변 상태와 인라인 컴포넌트 결합을 확인해야 합니다.
- backend-context 동기화는 backend repo의 `tools/sync_contract.ps1` 흐름으로 별도 처리됩니다.

## 검증

```bash
pnpm typecheck
pnpm lint
pnpm build
```

자동 테스트와 CI는 현재 없습니다.
