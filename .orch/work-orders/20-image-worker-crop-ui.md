# Work Order 20: 정렬(크롭+가격) → 자동처리 트리거 → 검수/공개 UI (Seam B · beta_web)

> 사령관(Opus) 발행. 실행관은 `AGENTS.md` 계약을 우선 적용하고 아래 범위 안에서만 작업한다.

**executor: codex**

## 목표
사장님이 디자인 이미지를 **크롭**하고 **가격**을 넣어 등록하면, 백엔드에 자동 이미지 처리를 트리거하고, 처리 상태를 폴링해 보여주며, 처리 결과(`processed_url`)를 **검수**한 뒤 **기존 "앱 공개" 버튼**으로 노출한다. 이는 기존 "새 디자인 등록"의 확장이며 **등록·공개 UI는 최대한 재사용**한다. 신규는 (1) 크롭 스텝, (2) 처리 트리거 호출, (3) 처리상태 표시 + processed_url 미리보기뿐이다.

**우선순위:** 배선(트리거·폴링·검수·공개 재사용)이 최우선. 크롭은 **외부 라이브러리 없이** canvas로 기능하는 수준이면 충분(폴리시는 후속).

## 수정 허용 파일 (이 목록 밖은 읽기 전용)
- `src/app/dashboard/designs/page.tsx`
- `src/services/designs.ts`
- `src/components/**`  (신규 크롭 컴포넌트용)

<!-- ALLOWED-FILES-START
src/app/dashboard/designs/page.tsx
src/services/designs.ts
src/components/**
ALLOWED-FILES-END -->

## 먼저 읽을 것 (ground truth — 이 패턴들을 재사용)
- `src/app/dashboard/designs/page.tsx` — 전부 여기 있음: `CreateForm`(L481~), `BulkDropzone`/`BulkAddModal`(L1676~1934, 여러 장 → 각자 디자인), `DesignEditForm`(L1938~), `DesignCard`(L1118~1365), **공개 버튼 `publish` mutation(L1172~1180) + "👁 앱 노출" 블록(L1299~1338)**, AI상태 폴링 `refetchInterval`(L1126~1134), 사진 업로드 `startUpload`(L513~526).
- `src/services/designs.ts` — `designsApi.{createDesign,updateDesign,getDesign,changeVisibility,reanalyze,...}`. 새 호출은 여기에 추가.
- `src/services/uploads.ts` — `uploadsApi.uploadFile(file,'design')` (multipart 직접 fetch, 타입 클라이언트 안 씀). **신규 `processDesign` 호출은 이 파일의 직접-fetch 스타일을 미러링**(auth/Idempotency-Key 헤더 수동).
- `src/lib/config.ts` — `config.apiOrigin`(L9~18).
- `src/lib/api-client.ts` — 타입드 클라이언트(생성 타입 기반). **주의:** 신규 백엔드 엔드포인트/필드는 아직 openapi 타입에 없다(Seam C에서 재생성 예정) → 타입드 `apiClient`로 `/process`를 부르면 tsc 실패한다.

## 작업 단계

### 1) 처리 트리거 API (타입 의존 회피)
- `src/services/designs.ts`에 `processDesign(designId: string): Promise<void>` 추가. 타입드 `apiClient` 대신 **`uploads.ts` 스타일의 직접 fetch**로 `POST {config.apiOrigin}/api/v1/shops/me/designs/{designId}/process`(Authorization Bearer + Idempotency-Key 헤더). 이유: 이 경로는 아직 생성 타입에 없음 → 타입드 클라이언트 쓰면 컴파일 실패. `// TODO(types): Seam C(openapi 재생성) 후 designsApi 타입드 호출로 이관` 주석.

### 2) 크롭 스텝 (외부 의존성 0)
- `src/components/`에 신규 `ImageCropper` 컴포넌트: 이미지 위에 드래그로 사각 크롭 박스를 잡고, 확정 시 `<canvas>`로 크롭해 `Blob`(image/png 또는 원본 type) 반환. 외부 라이브러리 금지 — 브라우저 Canvas/포인터 이벤트만. 접근성/폴리시는 최소로, **정확한 크롭 blob 산출이 핵심**.
- 등록 흐름 통합: `BulkAddModal`(권장 — "여러 장 자동처리" 배치 성격에 맞음) 또는 `CreateForm`의 사진 픽 직후에 크롭 스텝을 삽입. 크롭된 Blob을 `File`로 감싸 **기존 `uploadsApi.uploadFile(file,'design')`** 로 업로드(원본 크롭이 `original_url`이 됨) → 반환된 object_key로 **기존 `designsApi.createDesign`**(가격=기존 base_price 필드 재사용)으로 DRAFT 생성.

### 3) 자동처리 트리거 배선
- 위 createDesign 성공 직후 `processDesign(created.id)` 호출(배치면 각 생성 건마다). 실패해도 등록 자체는 유지(트리거 실패는 토스트/재시도 버튼으로).

### 4) 처리상태 표시 + 결과 검수 + 공개 재사용
- `DesignCard`에서 `image_processing_status`를 표시(뱃지: 대기/처리중/완료/실패). **주의:** 이 필드는 아직 생성 타입에 없음 → `getDesign`/디자인 객체에서 읽을 때 좁은 캐스트 사용: `(d as { image_processing_status?: string }).image_processing_status`. `// TODO(types): Seam C 후 캐스트 제거` 주석. 캐스트는 **이 2~3곳에만**, 광범위 `as any` 금지.
- 처리중(`pending`/`in_progress`)이면 기존 AI상태 폴링(`refetchInterval` L1126~1134)과 동일 패턴으로 `getDesign`을 폴링해 뱃지 갱신. 기존 AI 폴링 조건에 image 상태도 포함시키거나 병행.
- 완료 시 `DesignImagePublic.processed_url`(현재 UI 미사용)을 **검수 미리보기**로 노출 — 원본(original_url) 대비 처리결과를 볼 수 있게. (원본 옆에 processed 미리보기, 또는 토글.)
- 공개: **기존 `publish` mutation + "앱에 공개" 버튼을 그대로 사용**(신규 공개 로직 만들지 말 것). 처리 미완료면 "처리 완료 후 공개 권장" 소프트 힌트만(강제 차단 금지 — AI 분리 철학과 일관).

## 절대 하지 말 것
- **의존성 추가 금지**(package.json/pnpm-lock 건드리지 말 것 — 크롭은 canvas 자체구현). verify가 의존성 변경을 실패로 본다.
- 공개/가시성 mutation을 새로 만들지 말 것 — 기존 `changeVisibility`/`publish` 재사용.
- 타입드 `apiClient`로 아직 없는 경로/필드 호출 금지(컴파일 실패). 신규 경로=직접 fetch, 신규 필드=좁은 캐스트.
- git 커밋/브랜치/푸시 금지. ALLOWED-FILES 밖 수정 금지.

## 완료 조건
- [ ] `pnpm tsc --noEmit`(또는 `pnpm build`) 에러 0. (신규 경로/필드는 위 회피책으로 컴파일 통과)
- [ ] 크롭 → 업로드 → createDesign → processDesign 트리거 → 상태 폴링 → processed_url 검수 → 기존 공개 버튼, 전 구간이 배선됨.
- [ ] 기존 등록/편집/공개 흐름 회귀 없음(재사용 지점 유지).
- [ ] 보고: (1) 수정/생성 파일 목록 (2) 한 일 요약 (3) 남은 캐스트/TODO(types) 위치·우려.
