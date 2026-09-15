# CODEMAP — snail_beta_test_web

AI 에이전트/신규 세션의 코드 탐색 진입점이다. **전체 검색 전에 이 문서를 먼저 읽는다.**
기능 작업으로 파일을 추가·이동하면 여기 반영하는 것이 DoD다 — `pnpm check:codemap`이 강제한다.

경로는 모두 `src/` 기준 상대경로다 (예: `services/shop.ts` = `src/services/shop.ts`).

정체·컨벤션·금지사항은 [AGENTS.md](../AGENTS.md). 이 문서는 «어디에 있나»만 답한다.

> 이 저장소는 `snail_owner_web`의 **베타 테스트용 모바일 웹 fork**다. 두 저장소는 이미
> 크게 갈라져 있다(공통 경로 61개 중 43개 상이, 2026-09-15 실측). 같은 이름의 파일이라도
> **내용이 다를 수 있으니 복사해 오지 말고 각각 확인**한다.

---

## 1. 라우트 → 코드

Next.js App Router. `(auth)`·`(gate)`는 URL에 나타나지 않는 그룹이다.
접근 제어는 `middleware.ts` + `components/auth-gate.tsx`.

| 화면 | 라우트 파일 | 주요 서비스·훅 |
|---|---|---|
| 로그인 | `app/(auth)/login/page.tsx` | `services/auth.ts`, `hooks/use-auth.ts` |
| 회원가입 | `app/(auth)/register/page.tsx` | `services/auth.ts`, `services/owners.ts` |
| 비밀번호 재설정 | `app/(auth)/password-reset/page.tsx` | `services/auth.ts` |
| 인증 화면 공통 껍데기 | `app/(auth)/layout.tsx` | — |
| 사업자 인증 제출·재제출 | `app/(gate)/business-verification/page.tsx` | `services/owners.ts`, `services/uploads.ts` |
| 심사 대기 안내 | `app/(gate)/pending/page.tsx` | `hooks/use-auth.ts` |
| 게이트 공통 껍데기 | `app/(gate)/layout.tsx` | — |
| 대시보드 홈(요약) | `app/dashboard/page.tsx` | `hooks/use-dashboard-summary.ts` |
| 대시보드 공통 껍데기(모바일 내비) | `app/dashboard/layout.tsx` | `hooks/use-auth.ts`, `hooks/use-my-shop.ts` |
| 샵 관리 | `app/dashboard/shop/page.tsx` | `services/shop.ts`, `hooks/use-my-shop.ts`, `hooks/use-set-shop-visibility.ts`, `hooks/use-regions.ts` |
| **디자인·옵션 관리** | `app/dashboard/designs/page.tsx` | `services/designs.ts`, `services/shop-option-categories.ts` |
| 일정 | `app/dashboard/schedule/page.tsx` | `services/reservations.ts`, `services/designers.ts` |
| 채팅 목록 | `app/dashboard/chat/page.tsx` | `services/chat.ts` |
| 채팅방 | `app/dashboard/chat/[roomId]/page.tsx` | `services/chat.ts` |
| 1:1 문의 | `app/dashboard/inquiries/page.tsx` | `services/inquiries.ts` |
| 알림함 | `app/dashboard/notifications/page.tsx` | `services/notifications.ts` |
| 최초 온보딩(샵 개설) | `app/onboarding/page.tsx` | `services/shop.ts`, `services/uploads.ts`, `services/taxonomy.ts` |
| 루트 진입 | `app/page.tsx` | — |
| 루트 레이아웃 | `app/layout.tsx` | `components/query-provider.tsx`, `components/auth-bootstrap.tsx`, `components/analytics-provider.tsx` |

> `app/dashboard/designs/page.tsx`는 이 저장소에서 가장 큰 화면이다. 옵션 기본 템플릿,
> 커스텀 카테고리 on/off, 단독/중복 선택이 전부 여기 있다. 옵션의 `kind`가 비어 있으면
> **커스텀 카테고리 소속**이라는 뜻이다(`kind ?? custom_category_id`로 묶는다).

## 2. 데이터 계층 — `services/`

백엔드 호출은 전부 여기를 지난다. 타입은 `types/api.d.ts`(생성물)를 쓴다.

| 파일 | 담당 |
|---|---|
| `services/index.ts` | 배럴 |
| `services/types.ts` | 생성 타입 → 화면용 별칭 |
| `services/auth.ts` | 로그인·토큰 갱신·비밀번호 재설정 |
| `services/owners.ts` | 사장님 계정·사업자 인증 |
| `services/shop.ts` | 내 샵 조회·수정·영업시간·노출 |
| `services/shop-option-categories.ts` | **사장님이 만든 커스텀 옵션 카테고리** |
| `services/designs.ts` | 디자인 CRUD·폴더·옵션 |
| `services/designers.ts` | 디자이너 CRUD·근무 스케줄 |
| `services/reservations.ts` | 예약 목록·수락/거절·상태 전이 |
| `services/reviews.ts` | 리뷰 조회·답글 |
| `services/inquiries.ts` | 1:1 문의 |
| `services/chat.ts` | 채팅 목록·메시지 |
| `services/snails.ts` | 스냅(커뮤니티) 조회 |
| `services/taxonomy.ts` | 지역·색·무드 등 분류 사전 |
| `services/notifications.ts` | 알림함 |
| `services/uploads.ts` | 업로드 object_key 발급 |

## 3. 훅 — `hooks/`

| 파일 | 담당 |
|---|---|
| `hooks/use-auth.ts` | 로그인 상태·로그아웃·현재 사장님 |
| `hooks/use-my-shop.ts` | 내 샵 조회 캐시 |
| `hooks/use-dashboard-summary.ts` | 대시보드 홈 요약 |
| `hooks/use-regions.ts` | 지역 분류 조회 |
| `hooks/use-set-shop-visibility.ts` | 샵 노출 on/off |
| `hooks/use-lock-body-scroll.ts` | 모달 열릴 때 배경 스크롤 잠금(모바일 웹 전용) |

## 4. 컴포넌트

| 경로 | 책임 |
|---|---|
| `components/ui/page-stub.tsx` | 미구현 화면 자리표시 |
| `components/ImageCropper.tsx` | 이미지 크롭(모바일 업로드) |
| `components/business-hours-field.tsx`, `components/time-select.tsx` | 영업시간 입력 |
| `components/shop-edit-modal.tsx` | 샵 정보 수정 모달 |
| `components/day-timeline.tsx` | 일정 일 뷰 |
| `components/reservation-detail.tsx`, `components/reservation-design.tsx` | 예약 상세·붙은 디자인/옵션 |
| `components/auth-gate.tsx`, `components/auth-bootstrap.tsx` | 접근 제어·토큰 복원 |
| `components/query-provider.tsx`, `components/analytics-provider.tsx` | React Query·계측 프로바이더 |

## 5. 공용 모듈 — `lib/`

⚠️ 상당수가 `snail_owner_web`과 **같은 이름의 복제본**이고 일부는 이미 갈라졌다.

| 파일 | 비고 |
|---|---|
| `lib/legal.ts` | **약관·환불 문구.** owner와 내용이 **다르다**. 백엔드 `legal/*.draft.md`가 원문 |
| `lib/payment-policy.ts` | 예약금 상한·예약 가능 기간. 백엔드 `reservation_policy.py`와 일치해야 한다 |
| `lib/api-client.ts`, `lib/api-error.ts`, `lib/token.ts` | HTTP 클라이언트·에러 정규화·토큰 저장 |
| `lib/error-messages.ts` | 에러코드 → 한국어 문구 |
| `lib/config.ts` | `NEXT_PUBLIC_*` 읽기 |
| `lib/query-client.ts` | React Query 설정 |
| `lib/auth-routing.ts` | 로그인 후 목적지 판정 |
| `lib/analytics.ts` | 베타 계측 |
| `lib/beta-account.ts`, `lib/beta-schedule.ts` | 베타 전용 계정·일정 규칙 |
| `lib/business-hours.ts`, `lib/weekday.ts`, `lib/calendar.ts`, `lib/date.ts`, `lib/schedule.ts`, `lib/timeline.ts` | 영업시간·날짜·일정 계산 |
| `lib/reservation-format.ts`, `lib/reservation-status.ts` | 예약 표시 문구·상태 라벨 |
| `lib/fonts.ts` | 폰트 로딩 |

## 6. 백엔드 계약

`backend-context/`는 `backend specification`이 배포하는 **생성물**이다. 직접 고치지 마라.

```powershell
cd 'C:\projects\backend specification'
powershell -File tools\sync_contract.ps1        # 배포
cd C:\projects\snail_beta_test_web
pnpm generate:types                             # types/api.d.ts 재생성
```

`pnpm generate:types`를 쓰지 않고 `openapi-typescript`를 직접 부르면
`--default-non-nullable false`가 빠져 **기본값 있는 필드가 전부 필수로 생성된다**(가짜 타입 에러).

## 7. 검증

```bash
pnpm typecheck && pnpm lint && pnpm build
pnpm check:codemap   # 이 문서의 신선도
```
