# 계획서 — 지역 드롭다운을 운영자웹 태그 관리와 동기화

작성일 2026-09-06. 대상 repo: `snail_beta_test_web`.

이 fix는 사실 새 설계가 아니다. `백엔드_요청서/운영자태그관리_백엔드요청서.md`
(2026-08-19 작성)의 "각 저장소에서 이어서 할 일 → 사장님 베타웹" 항목에 이미 명시돼 있었다.
백엔드(DB 이관+검증+삭제가드)와 운영자웹(태그 관리 화면)은 그때 실행됐는데
**베타웹 프론트 항목만 실행되지 않고 남아 있었다.** 이 계획서는 그 미완료 항목을 그대로
Task로 쪼갠 것 — 설계를 새로 하지 않고 원 문서의 결정을 따른다:

> - `src/lib/regions.ts` 의 하드코딩 `SHOP_REGIONS` 삭제 → `GET /api/v1/taxonomy` 의 regions 사용
> - `isKnownRegion()` 은 기존 자유입력 데이터 방어용이므로 **유지**(값이 목록에 없으면 빈 선택)

## 왜 (조사 결과)

운영자웹에서 지역 태그를 추가/삭제/비활성/이름변경해도 **베타웹에만 반영이 안 된다.**
베타웹만 지역 목록을 API가 아니라 소스 파일에서 읽기 때문이다.

| 소비자 | 지역 목록 출처 | 반영 |
|---|---|---|
| 앱 (`FilterModal`, `SnapWrite`) | `GET /api/v1/taxonomy` → `useTaxonomy()` | O |
| 운영자웹 (태그 관리) | `GET /api/v1/admin/taxonomy/chips` | O |
| **베타웹 (온보딩·샵정보수정)** | **`src/lib/regions.ts` 하드코딩 상수** | **X** |

- 하드코딩이 들어온 커밋: `92fa96e feat(shop): 지역 고정 드롭다운화` (2026-07-12)
- 지역 태그가 DB(`taxonomy_chips`)로 이관된 시점: 2026-08-19 (`20260819_1000_add_taxonomy_chips.py`)
- 즉 이관 때 베타웹만 같이 안 고쳐졌다. 백엔드는 처음부터 베타웹을 소비자로 상정했다 —
  `backend/app/api/v1/taxonomy.py` docstring: *"앱 필터 칩 / 사장님웹 드롭다운 공용 목록"*

### 지금 실제로 나는 증상 (2026-09-06 프로덕션 확인)

```
GET https://api.snail-nail.com/api/v1/taxonomy   → 200 (무인증)
regions: 건대, 보문, 성수, 신림, 압구정, 홍대, 성신여대, 망원, 광흥창
```

베타웹 하드코딩: `강남, 건대, 명동, 성수, 신림, 압구정, 이태원, 잠실, 홍대, 보문, 안암`

1. **새 지역이 안 보인다** — 성신여대·망원·광흥창을 사장님이 고를 수 없다.
2. **없어진 지역을 고르면 저장이 통째로 실패한다** — 강남·명동·이태원·잠실·안암을 고르면
   백엔드 `_validated_region`(`backend/app/services/shop_service.py:88`)이
   `422 INVALID_REGION "지원하지 않는 지역입니다: 강남"`으로 거절한다.
   샵정보수정 모달은 `updateMyShop`이 제일 먼저 나가므로 **영업시간·디자이너 수정까지 같이 날아간다.**
3. **저장된 지역이 빈칸으로 보인다** — `shop-edit-modal.tsx:139`의
   `value={isKnownRegion(region) ? region : ''}` 자체는 **의도된 동작**이다(원 설계 문서:
   "값이 목록에 없으면 빈 선택"). 문제는 `isKnownRegion`이 보는 목록이 하드코딩이라
   비교 기준 자체가 stale하다는 것 — 성신여대처럼 최근에 추가된 지역이 저장돼 있어도
   구버전 목록엔 없어서 빈 선택으로 오판된다. `isKnownRegion`의 동작은 그대로 두고
   **비교 대상 목록만 API 값으로 바꾼다.**

## 무엇을 하나

베타웹을 앱과 같은 방식으로 바꾼다. **프론트만 고치면 된다** —
`/api/v1/taxonomy`는 무인증 공개 엔드포인트이고 `src/types/api.d.ts:4838`에
`TaxonomyResponse { colors, moods, seasons, regions }` 타입이 이미 생성돼 있다.
백엔드·운영자웹·앱은 손대지 않는다.

### 범위 밖 (명시)

- 색상/무드/시즌 — 베타웹에서는 디자인 태그가 자유입력이라 같은 문제가 없다.
- `snail-web` — 지역 선택 UI 자체가 없다.
- `src/types/api.d.ts`, `backend-context/` — 자동생성물/계약 스냅샷. 손대지 않는다.

---

## Task 1 — 서비스 레이어에 taxonomy 추가 — 완료

- [x] `src/services/taxonomy.ts` 신규 생성. 기존 서비스 파일(`shop.ts`)의 주석 밀도·형식을 따른다.

  ```ts
  /** 통제어휘(색상/무드/시즌/지역). 운영자웹 태그 관리가 SSOT다. */
  import { apiClient } from '@/lib/api-client';

  /** 필터/드롭다운 공용 목록. 활성 칩만 sort_order 순으로 온다. */
  export async function getTaxonomy() {
    return apiClient.get('/api/v1/taxonomy');
  }
  ```

- [x] `src/services/index.ts` 배럴에 `export * as taxonomyApi from './taxonomy';` 추가.
      기존 배럴의 나열 순서 관례를 따른다.
- [x] `pnpm typecheck && pnpm lint` 초록 확인 후 커밋.

## Task 2 — `useRegions` 훅

- [ ] `src/hooks/use-regions.ts` 신규 생성. `src/hooks/use-my-shop.ts`의 형식을 그대로 따른다
      (`'use client'`, 파일 상단 한국어 주석, `*_KEY` 상수 export).

  ```ts
  'use client';

  /**
   * 샵 지역 선택지 훅.
   * 운영자웹 태그 관리(taxonomy_chips)가 SSOT라 목록을 API에서 받는다.
   * 하드코딩하면 운영자가 지역을 바꿔도 이 화면만 안 따라온다.
   */
  import { useQuery } from '@tanstack/react-query';
  import { taxonomyApi } from '@/services';

  export const TAXONOMY_KEY = ['taxonomy'] as const;

  export function useRegions() {
    return useQuery({
      queryKey: TAXONOMY_KEY,
      queryFn: () => taxonomyApi.getTaxonomy(),
      select: (t) => t.regions,
    });
  }
  ```

- [ ] **`staleTime`을 오버라이드하지 않는다.** `src/lib/query-client.ts`의 전역 기본값이 30초이고,
      백엔드 스냅샷 캐시 TTL이 60초(`CACHE_TTL_SECONDS`)이며 운영자 변이 시
      `invalidate_cache()`가 돈다. 전역 기본값이면 최악 90초 안에 따라온다 — 충분하다.
- [ ] `pnpm typecheck && pnpm lint` 초록 확인 후 커밋.

## Task 3 — 온보딩 지역 드롭다운 (`src/app/onboarding/page.tsx`)

- [ ] `import { SHOP_REGIONS } from '@/lib/regions';` 제거, `useRegions()` 사용.
- [ ] `SHOP_REGIONS.map` (약 363행) → API에서 받은 목록으로 교체.
- [ ] **이 select는 React Hook Form `register('region')`으로 묶여 있다. `disabled` 속성을 걸지 마라** —
      RHF v7에서 disabled 필드가 제출값에서 빠지는 함정이 있다.
      로딩/에러는 placeholder `<option>` 문구로만 표현한다:
      로딩 중 `지역 불러오는 중…`, 실패 시 `지역을 불러오지 못했어요`.
- [ ] 지역은 `(선택)` 항목이다. **목록을 못 받아도 온보딩 제출 자체는 막히면 안 된다.**
- [ ] `pnpm typecheck && pnpm lint` 초록 확인 후 커밋.

## Task 4 — 샵정보수정 모달 (`src/components/shop-edit-modal.tsx`)

원 설계 결정을 그대로 따른다: **`isKnownRegion`의 "목록에 없으면 빈 선택" 동작은 유지**한다.
바꾸는 건 그 목록의 출처뿐이다 — 하드코딩 상수 대신 API 값을 본다.

- [ ] `import { SHOP_REGIONS, isKnownRegion } from '@/lib/regions';` 제거, `useRegions()` 사용.
- [ ] `isKnownRegion` 함수 자체를 인라인으로 대체한다(별도 파일로 옮기지 않는다 — 한 곳에서만 쓰는
      한 줄짜리 판정이라 `lib/regions.ts` 삭제와 함께 굳이 새 유틸 파일을 만들 이유가 없다):

  ```tsx
  const regionsQuery = useRegions();
  const regions = regionsQuery.data ?? [];
  const isKnownRegion = regions.includes(region);
  // ...
  <select ... value={isKnownRegion ? region : ''} onChange={(e) => setRegion(e.target.value)}>
  ```

  `value={isKnownRegion(region) ? region : ''}` (139행) 의 렌더 결과는 이 변경 전후로 동일해야
  한다 — 바뀌는 건 "무엇과 비교하는가"뿐, "없으면 빈칸"이라는 동작 자체는 그대로다.
- [ ] 이 select는 RHF가 아니라 `useState` 제어 컴포넌트다. 여기서는 로딩 중 `disabled` 걸어도 된다.
- [ ] `pnpm typecheck && pnpm lint` 초록 확인 후 커밋.

## Task 5 — 하드코딩 상수 제거

- [ ] `rg "SHOP_REGIONS|from '@/lib/regions'"` 로 `lib/regions.ts` 참조가 0인지 확인한다.
      (`isKnownRegion`이라는 이름의 인라인 상수/변수 자체는 Task 4에서 남아 있어도 된다 —
      찾는 건 "하드코딩 목록을 보는 곳"이지 이름이 아니다.)
- [ ] `src/lib/regions.ts` 삭제.
- [ ] **폴백 상수를 남기지 마라.** 남기면 똑같은 드리프트가 다시 생긴다.
      API 실패 시엔 폴백이 아니라 안내 문구를 띄운다(Task 3·4에서 이미 처리).
- [ ] `pnpm typecheck && pnpm lint && pnpm build` 전부 초록 확인 후 커밋.

---

## 끝났을 때 참이어야 하는 것

- 위 Task 5개 체크박스가 전부 `[x]`
- `pnpm typecheck && pnpm lint && pnpm build` 전부 초록
- `src/lib/regions.ts`가 없고, `SHOP_REGIONS` 참조가 코드에 0건
- 샵정보수정 모달에서 저장된 지역이 API 목록에 없으면 여전히 빈 선택으로 표시된다
  (원 설계 동작 유지 — 비교 대상만 API로 바뀜)
- 지역 문자열("강남", "홍대" 등)이 `src/` 어디에도 하드코딩돼 있지 않다
  (placeholder 예시 문구는 예외)
- `src/types/api.d.ts`와 `backend-context/`에 변경이 없다
- 온보딩과 샵정보수정 두 화면 모두 `GET /api/v1/taxonomy`의 `regions`를 그대로 렌더한다

## 런타임 확인 (선택)

`.claude/skills/verify/`의 Playwright 하네스로 `/api/v1/taxonomy` 응답을 주입해
드롭다운 렌더·로딩·에러 분기를 실측할 수 있다. 단 이 하네스는 미실행 이식본이라
첫 구동 시 셀렉터 대조가 필요하다(`SKILL.md` 참조). 하네스가 안 뜨면 Task를 막지 말고
`pnpm dev` + 실제 프로덕션 API로 육안 확인한 뒤 결과를 여기 적는다.
