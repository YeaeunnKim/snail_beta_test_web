# 사장님 웹 ↔ 백엔드 연동 갭 정리

> 백엔드가 사장님 웹용으로 만들어둔 기능 중, 프론트에서 **아직 안 쓰이거나 부분만 연동된 것**의 목록입니다.
> 웹 작업자가 "어디부터 붙이면 되는지"를 한눈에 보도록 정리했습니다.

- 작성일: 2026-07-02
- 기준 계약: `backend-context/openapi.json` (105 paths / owner-authed 54개)
- 판정 방법: 스펙의 오너 표면(`/shops/me/*`, `/owners/me/*`, `/auth/owner/*`, 리뷰 답글) vs `src/services/*` 서비스 함수 vs `src/app` 실제 호출을 대조.

## 요약

- **완성도 높은 영역**: 예약 운영(7개 상태전이 + `owner_reply`), 온보딩(가입→사업자 인증→샵→영업시간→디자이너→디자인 생성), 대시보드 요약.
- **갭은 크게 4단계**: ① 서비스·화면 자체 없음 → ② 화면이 스텁(선언만) → ③ 화면은 있으나 액션 누락 → ④ 미활용 공개/읽기(기회).

---

## Tier 1 — 서비스·화면 자체가 없음 (완전 미연동)

### 📮 문의(Inquiries)
오너 엔드포인트 중 유일하게 **서비스 함수조차 없는** 기능.

| 메서드 | 엔드포인트 | 용도 |
|---|---|---|
| GET | `/shops/me/inquiries` | 내 샵에 들어온 문의 목록 |
| POST | `/shops/me/inquiries/{inquiry_id}/reply` | 문의 답변 |
| (고객) POST | `/shops/{shop_id}/inquiries` | 고객이 샵에 문의 생성 |

- **영향**: 고객이 문의를 남길 수 있으나 **사장님이 확인·답변할 경로가 전혀 없음**.
- **필요 작업**: `src/services/inquiries.ts` 신설 + 문의함 화면.
- 관련 스키마: `ShopInquiryPublic`, `ShopInquiryListResponse`, `ShopInquiryReply`, `InquiryStatus`.

---

## Tier 2 — 화면이 `PageStub`(선언만, 미연동)

서비스 레이어는 이미 있으므로 **화면만 붙이면 되는** 상태.

| 화면 | 파일 | 준비된 서비스 함수 | 엔드포인트 |
|---|---|---|---|
| 🔔 알림 | `src/app/dashboard/notifications/page.tsx` | `notificationsApi.listOwnerNotifications / markOwnerNotificationRead / markAllOwnerNotificationsRead / listShopNotifications / markShopNotificationRead` | `/owners/me/notifications*`, `/shops/me/notifications*` |
| ⭐ 리뷰 | `src/app/dashboard/reviews/page.tsx` | `reviewsApi.listReviewsForShop / createReply` | `GET /shops/{shop_id}/reviews`, `POST /reviews/{review_id}/replies` |
| 🔑 비밀번호 재설정 | `src/app/(auth)/password-reset/page.tsx` | `authApi.requestPasswordReset / confirmPasswordReset` | `/auth/password-reset`, `/auth/password-reset/confirm` |

---

## Tier 3 — 화면은 있으나 특정 액션이 빠짐 (부분 연동)

서비스 함수는 존재하지만 어떤 UI에서도 호출하지 않음.

| 기능 | 안 붙은 서비스 함수 | 엔드포인트 | 영향 |
|---|---|---|---|
| **디자인 공개 전환** | `designsApi.changeVisibility` | `POST /shops/me/designs/{id}/visibility` | ⚠️ 디자인을 만들어도 **고객에게 공개 전환 불가** — 공개 플로우가 끊김 |
| **디자인 옵션(가격/추가시술)** | `designsApi.listOptions / createOption / updateOption / deleteOption` | `/shops/me/designs/{id}/options*` | ⚠️ 옵션 관리 불가 → 예약의 옵션·금액(`selected_option_ids`, `total_price`) 기반이 비어있음 |
| **디자인 수정** | `designsApi.updateDesign` | `PATCH /shops/me/designs/{id}` | 생성·삭제만 가능, 수정 불가 |
| **디자이너 휴무** | `designersApi.addTimeOff / deleteTimeOff` | `/shops/me/designers/{id}/time-off*` | ⚠️ 휴무 등록/삭제 불가 → 예약 가능시간 계산에 반영 안 됨 |
| **디자이너 수정/삭제** | `designersApi.updateDesigner / deleteDesigner` | `PATCH·DELETE /shops/me/designers/{id}` | 생성·스케줄 설정만, 수정·삭제 불가 |
| **샵 이미지** | `shopApi.addImage / deleteImage` | `POST·DELETE /shops/me/images` | 샵 대표사진 등록/삭제 불가 |
| **폴더 이름변경/삭제** | `designsApi.updateFolder / deleteFolder` | `PATCH·DELETE /shops/me/design-folders/{id}` | 폴더 생성·목록만 연동 |
| **사장님 정보 수정** | `ownersApi.updateMe` | `PATCH /owners/me` | 프로필(대표자명·연락처) 수정 화면 없음 |

---

## Tier 4 — 미활용 공개/읽기 (선택 · 기회)

오너 인증으로 접근 가능하나 아직 안 쓰는 조회 API. 필수는 아니지만 UX 개선 여지.

| 엔드포인트 | 활용 아이디어 |
|---|---|
| `GET /taxonomy` | 디자인 태그·지역 등 필터 **통제어휘**를 서버에서 받아 하드코딩 제거 |
| `GET /shops/{shop_id}` · `/shops/{shop_id}/designs` · `/shops/{shop_id}/designers` | "고객에게 보이는 내 샵" 공개 미리보기 |
| `GET /designs/{id}` · `/designs/{id}/reviews` · `/designs/{id}/availability` · `/designs/{id}/related` | 디자인 공개 상세 미리보기 / 예약 가능시간 확인 |

---

## 우선순위 제안

1. **공개 플로우 완성** — 디자인 공개 전환 + 옵션 (Tier 3 상단). 디자인 등록의 목적지가 여기라 최우선.
2. **고객 소통** — 문의(Tier 1) · 알림 · 리뷰(Tier 2).
3. **나머지 수정/삭제 액션** — 디자이너·이미지·폴더·프로필 (Tier 3 하단).

## 재생성 방법

계약이 갱신되면 `pnpm generate:types` 후, 이 문서의 대조를 다시 수행해 갱신하세요.
(오너 표면 = `/shops/me/*`, `/owners/me/*`, `/auth/owner/*`, `POST /reviews/{id}/replies`)
