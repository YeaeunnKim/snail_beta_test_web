# 사장님 웹(베타) ↔ 백엔드 연동 갭 & 계약 정합성

> 백엔드가 사장님 웹용으로 제공하는 기능 중 프론트에서 **아직 안 쓰이거나 계약이 어긋난 것**의 목록.
> 웹 작업자가 "어디부터 붙이면 되는지 / 지금 무엇이 깨져 있는지"를 한눈에 보도록 정리.

- 갱신일: 2026-07-10 (이전판 2026-07-02 전면 재판정)
- 기준 계약: 백엔드 현행 `docs/openapi.json` — **116 paths**
- 프론트 계약: `src/types/api.d.ts` — **105 paths (STALE)**
- 판정 방법: FE `apiClient` 호출(services+app) + 실제 소비 코드 vs 백엔드 현행 계약 대조.

---

## 0. 헤드라인 — 지금 반드시 고칠 것

### 🔴 [BREAKING] 디자인 목록 응답 봉투 어긋남 → 디자인 페이지 런타임 파손
- 백엔드는 `GET /shops/me/designs`를 **`ListResponse` 봉투**(`{ data: DesignMe[], page: {next_cursor, has_next}, request_id }`)로 반환하도록 이미 이관됨.
- 프론트 `api.d.ts`는 이 응답을 **`DesignMe[]`(bare 배열)** 로 타이핑(구 스냅샷), 소비 코드도 배열 가정:
  ```ts
  // src/app/dashboard/designs/page.tsx
  const q = useQuery({ queryFn: () => designsApi.listDesigns({...}) });
  const designs = q.data ?? [];   // q.data === { data, page, request_id } (객체)
  designs.map(...)                // ⛔ TypeError: designs.map is not a function
  ```
- **영향**: 디자인 목록/폴더 화면이 렌더 시 크래시하거나 빈 목록·카운트 0으로 표시.
- **같은 이관을 받았으나 프론트 미반영**: `GET /shops/{shop_id}/reviews`(→`ListResponse_ReviewPublic_`), `GET /snails`(→`ListResponse_SnapPublic_`). 리뷰·스냅은 아직 UI가 없어 지금 당장 크래시는 없지만, 화면을 붙이기 전에 반드시 봉투로 소비해야 함.
- **원인**: 백엔드 봉투 표준화 2차 물결(디자인/리뷰/스냅) 이후 프론트가 타입을 재생성하지 않음.
  - 프론트 계약 스냅샷 시점엔 예약/알림/문의는 이미 `ListResponse`(정상 소비 중), 디자인/리뷰/스냅만 bare 배열이었음.
- **조치**:
  1. `pnpm generate:types:remote` (또는 백엔드 현행 `openapi.json`로) 타입 재생성.
  2. `designs` 목록 소비부를 `res.data` / `res.page`로 수정 (예약 화면의 `collectAll` 패턴과 동일하게).
  3. 리뷰·스냅 화면 신설 시에도 `ListResponse` 봉투 전제로 작성.

> 참고 — 봉투 표준화는 **전역이 아님**. 아래 3개는 백엔드가 여전히 **bare 배열**로 반환(프론트 배열 소비와 일치, 드리프트 없음):
> `GET /shops/me/designers`, `GET /shops/me/design-folders`, `GET /shops/me/designs/{id}/options`.

### 🟡 계약 스냅샷 낙후 (105 vs 116 paths)
- 프론트 계약에 없는 11개 경로 중 **오너 표면은 `GET /owners/me/dashboard/summary` 하나** (나머지 10개는 admin/import 5 + 고객앱 favorites·blocks 5 → 오너 웹 무관).
- 프론트가 부르는 **54개 호출은 전부 현행 계약에 존재**(메서드까지 일치) — 끊어진 엔드포인트 0건. 낙후는 "새 엔드포인트 미인지 + 위 봉투 이관 미반영"의 형태.

---

## 1. Tier A — 서비스는 준비됐으나 UI가 없음 (화면/액션 미배선)

> 2026-07-02판의 Tier 1~3 상당수가 **서비스 레이어에선 이미 해소**됨(`inquiries.ts` 신설, `changeVisibility`/옵션/휴무 서비스 존재). 남은 건 대부분 **UI 배선**.

| 기능 | 준비된 서비스 함수 | 엔드포인트 | 영향 |
|---|---|---|---|
| **디자인 공개 전환** | `designsApi.changeVisibility` | `POST /shops/me/designs/{id}/visibility` | ⚠️ 디자인을 만들어도 **고객 공개 전환 UI 없음** — 공개 플로우 여전히 끊김 |
| **디자인 옵션(가격/추가시술)** | `listOptions/createOption/updateOption/deleteOption` | `/shops/me/designs/{id}/options*` | ⚠️ 옵션 관리 UI 없음 → 예약 옵션·금액(`selected_option_ids`, `total_price`) 기반 비어있음 |
| **알림 인박스** | `listOwnerNotifications/markOwnerNotificationRead/markAllOwnerNotificationsRead/listShopNotifications/markShopNotificationRead` | `/owners/me/notifications*`, `/shops/me/notifications*` | 알림함 화면 없음 (좌측 네비의 "알림"은 실제로는 **예약 관리 화면**으로 재사용됨) |
| **리뷰 확인·답글** | `listReviewsForShop / createReply` | `GET /shops/{id}/reviews`, `POST /reviews/{id}/replies` | 리뷰 화면 자체가 없음 (구판의 스텁 페이지도 이 포크엔 부재) + 위 봉투 이관 대상 |
| **문의 답변** | `inquiriesApi.reply` | `POST /shops/me/inquiries/{id}/reply` | 문의 목록(`listMyShopInquiries`)은 대시보드 요약에서 읽지만 **답변 액션 미배선** |
| **디자인 수정** | `designsApi.updateDesign` | `PATCH /shops/me/designs/{id}` | (배선됨 — 유지) |
| **디자이너 수정/삭제** | `updateDesigner / deleteDesigner` | `PATCH·DELETE /shops/me/designers/{id}` | 생성·스케줄만, 수정·삭제 UI 없음 |
| **디자이너 휴무** | `addTimeOff / deleteTimeOff` | `/shops/me/designers/{id}/time-off*` | (스케줄 화면에 배선됨 — 유지) |
| **샵 이미지** | `addImage / deleteImage` | `POST·DELETE /shops/me/images` | 샵 대표사진 등록/삭제 UI 없음 |
| **폴더 이름변경/삭제** | `updateFolder / deleteFolder` | `PATCH·DELETE /shops/me/design-folders/{id}` | 생성·목록만, 이름변경/삭제 UI 없음 |
| **사장님 정보 수정** | `ownersApi.updateMe` | `PATCH /owners/me` | 프로필(대표자명·연락처) 수정 화면 없음 |

## 2. Tier B — 활용하면 좋은 백엔드 기능 (미인지/미활용)

| 엔드포인트 | 상태 | 활용 아이디어 |
|---|---|---|
| `GET /owners/me/dashboard/summary` | **프론트 계약에 없음(낙후)** — 현재 `use-dashboard-summary.ts`가 `listReservations`를 **5회+** 호출해 클라이언트에서 요약 재계산 | 타입 재생성 후 이 단일 엔드포인트로 교체 → 호출 수·지연 대폭 감소 |
| `GET /snails` | 서비스 있음, 미배선 (+봉투 이관 대상) | 스냅/피드 활용 시 |
| `GET /taxonomy` | 미활용 | 태그·지역 통제어휘 서버 수신 → 하드코딩 제거 |
| `GET /shops/{id}` · `/shops/{id}/designs` · `/designs/{id}` 등 | 미활용 | "고객에게 보이는 내 샵" 공개 미리보기 |

---

## 3. 정상 확인된 영역 (드리프트 없음)

- **인증/온보딩**: 베타 인스타 핸들 가입/로그인 흐름 백엔드 E2E 통과 (아래 §4).
- **예약 운영**: 7개 상태전이 + `owner_reply`, `ListResponse` 봉투(`data`/`page`) 정상 소비.
- **알림 페이지(=예약 관리)**, **문의 목록 읽기**, **스케줄**, **온보딩(가입→인증→샵→영업시간→디자이너→디자인 생성)**.

## 4. 베타 인증 흐름 — 백엔드 E2E 검증 결과 (PASS)

실제 앱+DB(Postgres/Redis)에 프론트와 동일한 페이로드로 태워 검증:

| 단계 | 결과 |
|---|---|
| `POST /auth/owner/signup` (인스타 핸들→`handle@beta.snail.app`, placeholder phone, 약관 "1.0") | **201, `verification_status=approved`** |
| `POST /auth/owner/login` | **200, access_token 발급** |
| `GET /owners/me` | **approved**, 이메일 = 베타 매핑값 |
| 같은 핸들 재가입 | **409 EMAIL_TAKEN** (결정적 이메일 매핑) |
| 틀린 비밀번호 | **401** |

- 스키마 완전 일치: FE signup 6필드 = 백엔드 `OwnerSignupRequest` required. 비번 정책 동일(`^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$`).
- **베타 흐름 유의점**: `BETA_AUTO_APPROVE_OWNERS=True`(기본)면 가입 즉시 approved →
  `resolveAuthedHome`가 `/dashboard`로 라우팅. 즉 `register/page.tsx` 주석("신규 가입자는 pending")과
  실제 동작이 어긋나며, `(gate)`의 사업자인증·승인대기 페이지는 **신규 베타 가입자에겐 사실상 도달 불가**.
  베타 종료 후 플래그를 끄면 이 게이트가 다시 살아나므로 그때 흐름 재점검 필요.

---

## 우선순위

1. **🔴 타입 재생성 + 디자인 목록 봉투 소비 수정** (지금 크래시) — 재생성 시 리뷰/스냅/대시보드요약 계약도 함께 최신화.
2. **공개 플로우 완성** — 디자인 공개 전환 + 옵션 UI (여전히 최상위 미배선).
3. **고객 소통** — 알림 인박스 · 리뷰 화면·답글 · 문의 답변.
4. **대시보드 요약 엔드포인트로 교체** (성능).
5. **나머지 수정/삭제 액션** — 디자이너·이미지·폴더·프로필.

## 재생성 방법
```bash
pnpm generate:types:remote   # https://poi82999.github.io/snail_backend_specification/openapi.json
# (Pages 계약이 최신인지 확인 후. 아니면 백엔드 현행 openapi.json로 generate:types)
pnpm typecheck               # 봉투 어긋난 소비부가 여기서 타입 에러로 드러남
```
