# 🧱 프론트엔드 기반(Foundation) 인계 문서

이 문서는 **환경 / 백엔드 연결 / 앱 구동·검증 기반**이 어디까지 구축되어 있고,
프론트/디자인팀이 **무엇을 이어받아 구현하면 되는지**를 정리한 인계 노트입니다.

> 요약: 화면을 그리는 일(UI·디자인)은 비워 두었고, 그 화면이 백엔드와 대화하는 데
> 필요한 배선(타입·API 클라이언트·인증·라우팅·가드)은 모두 깔아 두었습니다.

---

## 1. 이미 구축된 것 (기반)

| 영역 | 위치 | 내용 |
|---|---|---|
| 프로젝트 셋업 | `package.json`, `next.config.ts`, `postcss.config.mjs`, `src/styles/globals.css` | Next.js 15 / React 19 / Tailwind 4 / TS |
| OpenAPI 타입 | `src/types/api.d.ts` (자동 생성) | 백엔드 스펙 → TS 타입. `pnpm generate:types`로 재생성 |
| 타입 헬퍼 | `src/types/api-helpers.ts` | paths에서 요청/응답/파라미터 타입 추출 |
| 환경 설정 | `src/lib/config.ts`, `.env.local` | API base URL 등 환경 변수 일원화 |
| 에러 정규화 | `src/lib/api-error.ts` | 백엔드 에러 envelope → `ApiError` (code/fieldErrors/requestId) |
| 토큰 저장 | `src/lib/token.ts` | access/refresh 토큰 보관 + 가드용 presence 쿠키 |
| **API 클라이언트** | `src/lib/api-client.ts` | 타입-세이프 fetch. 인증 헤더·멱등키·401 자동 갱신·에러 정규화·커서 페이지네이션 |
| **서비스 레이어** | `src/services/*` | 리소스별 typed 함수 (아래 2번) |
| 인증 상태 | `src/stores/auth-store.ts`, `src/hooks/use-auth.ts` | Zustand 전역 인증 + `useAuth()` 훅 |
| 라우팅 골격 | `src/app/**` | (auth)/login·signup·password-reset, dashboard + 7개 하위 |
| 라우트 가드 | `src/middleware.ts` | 미인증→/login, 인증→/dashboard 리다이렉트 |
| 동작 레퍼런스 | `src/app/(auth)/login/page.tsx`, `src/app/dashboard/page.tsx` | **실제로 백엔드에 붙어 동작하는** 로그인 + /owners/me 표시 |

검증 완료: `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm build` ✅ · 미들웨어 리다이렉트 동작 확인 ✅

---

## 2. 서비스 레이어 (백엔드 연결 지점)

화면에서는 `fetch`를 직접 쓰지 말고 **서비스 함수만 호출**하면 됩니다. 인증·멱등키·토큰 갱신·에러 정규화는 클라이언트가 자동 처리합니다.

```ts
import { authApi, shopApi, reservationsApi } from '@/services';
import { isApiError } from '@/lib/api-error';

// 로그인 (토큰 저장까지 자동)
await authApi.login({ email, password });

// 내 샵 조회 (응답 타입은 스펙에서 자동 추론됨)
const shop = await shopApi.getMyShop();

// 예약 목록 (필터)
const { data, page } = await reservationsApi.listReservations({ status: 'pending', limit: 20 });

// 에러 처리
try {
  await reservationsApi.accept(id);
} catch (e) {
  if (isApiError(e)) {
    console.error(e.code, e.message, e.fieldErrors); // e.code로 분기
  }
}
```

제공 네임스페이스: `authApi`, `ownersApi`, `shopApi`, `designersApi`, `designsApi`, `reservationsApi`, `reviewsApi`, `notificationsApi`. (각 파일에 함수별 주석 있음)

도메인 타입은 `import type { Shop, Reservation, Design } from '@/services'`로 가져다 쓰면 됩니다.

---

## 3. 프론트/디자인팀이 이어받을 것

- 각 `dashboard/*/page.tsx`는 현재 **`<PageStub>` placeholder**입니다. 연결할 서비스 함수가 카드에 안내되어 있습니다.
- 디자인 시스템(색·타이포·컴포넌트)은 비어 있습니다. `globals.css`의 `@theme` 블록과 `src/components/ui/`를 채우세요.
- `login/page.tsx`의 **react-hook-form + zod + 서비스 호출 + ApiError 매핑** 패턴을 그대로 재사용하면 폼 화면을 빠르게 만들 수 있습니다.
- 이미지 업로드(presigned) 계약은 현재 스펙에 없습니다. 디자인/샵 이미지·사업자등록증은 "이미 업로드된 object key" 전제입니다. 업로드 방식은 백엔드와 별도 확정 필요.

골든 패스: `회원가입/로그인 → 사업자 인증 → 샵 생성/영업시간 → 디자이너 → 디자인 등록 → 옵션 → AI done 후 공개 → 예약 운영` (상세: `backend-context/owner_web.ai.txt`, `backend-context/api_cookbook.ai.txt`)

---

## 4. 실행 & 검증

```bash
pnpm install
pnpm generate:types   # 백엔드 스펙 변경 시 타입 재생성 (로컬 openapi.json 기준)
pnpm dev              # http://localhost:3000

pnpm typecheck && pnpm lint && pnpm build   # CI 전 확인
```

### 백엔드 연결 E2E 검증

1. 백엔드를 `http://localhost:8000`에 띄운다 (`backend-context/local_onboarding.md` 참고).
2. 사장님 계정을 한 번 가입한다(스펙 문서의 PowerShell 스니펫 또는 `/signup` 화면 완성 후).
3. `/login`에서 로그인 → `/dashboard`로 진입하고 **내 계정 정보(GET /owners/me)**가 표시되면 연결 성공.
4. CORS: 백엔드 기본 허용에 `localhost:3000`이 포함되어 있어 추가 설정 없이 동작합니다.

> 참고: 토큰은 현재 localStorage에 저장됩니다(클라이언트 방식). 보안 강화가 필요하면
> refresh_token을 httpOnly 쿠키 + route handler(BFF)로 옮기는 것을 권장합니다 (`token.ts` 주석 참고).
