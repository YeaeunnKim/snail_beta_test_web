# 디자인 카드 개편 (1단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `designs/page.tsx` 2,396줄을 책임별 파일로 쪼개고, 디자인 카드를 새 레이아웃 + 수정 ON/OFF 인라인 편집(가격 ±1,000원 / 소요시간 ±30분 / 태그칩 / 폴더) + 디자이너별 가격·시간 범위 표시로 바꾼다.

**Architecture:** 순수 로직은 `_lib/`(런타임 import 없음 → `node --test`로 유닛 테스트), UI는 `_components/`. 카드 인라인 편집은 `design-settings.tsx`가 이미 export하는 `Stepper`·`TagInput`을 재사용한다. 저장은 낙관적 갱신 + 실패 시 롤백이며, ± 스테퍼만 800ms 디바운스하고 나머지는 즉시 PATCH한다.

**Tech Stack:** Next.js 15.1.6 App Router, React 19, TypeScript 5.7 strict, TanStack Query v5, Tailwind v4, pnpm 11.5.0. 테스트는 Node 24 내장 `node --test`(TypeScript 네이티브 실행, 의존성 0).

## Global Constraints

- **의존성 추가 금지.** `package.json`의 `dependencies`/`devDependencies`를 건드리지 않는다. (사령관이 `scripts`에 `test` 한 줄 추가는 승인함 — Task 1)
- **백엔드 계약 수정 금지.** `backend-context/`, `src/types/api.d.ts` 절대 손대지 않는다.
- **커밋 허용** (사령관 승인). 작업 브랜치는 **`feature/designs-card-inline`** — `main`(`b47bbb9`)에서 파서 이미 만들어 뒀다. 여기에만 커밋한다. **로컬 커밋까지만이다.**
- **PR 생성 금지. 푸시 금지. 추가 브랜치 생성 금지.** `git push`, `gh pr create`, `gh pr merge`를 **어떤 이유로도 실행하지 마라.** 커밋 허가는 되돌리기 지점을 만들라는 뜻이지 원격에 올리라는 뜻이 아니다. PR과 푸시 시점은 사령관이 직접 정한다. 계획을 다 끝냈어도 "이제 PR 올릴까요?"를 실행으로 옮기지 말고 **보고만** 해라.
- **`next.config.ts`를 절대 커밋하지 마라.** 로컬 CORS 우회용 `rewrites()`가 들어간 미커밋 상태이고, 파일 안에 "커밋하지 말 것 — 배포 시엔 불필요"라고 명시돼 있다. `git add .`나 `git commit -a`를 쓰지 말고 이 계획에 적힌 경로만 `git add` 한다.
- **main 머지 시 Vercel 프로덕션 자동 배포가 걸려 있다**(`00a19dc`). 이 계획은 main에 직접 커밋하지 않으므로 해당 없지만, 실수로 main에 커밋하면 파일 쪼개기 중간 상태가 배포된다.
- **🚫 이미지 자동 처리(VM) UI를 절대 되살리지 마라.** `3a15ac9`에서 의도적으로 제거됐다. 등록/수정만 해도 정렬 VM(장당 70~85초, 단일 GPU)이 돌아 prod에서 계속 실패했기 때문이다. 아래는 **전부 지워진 상태가 정답**이며, 없다고 해서 만들지 마라:
  - `processDesign()` 자동 호출 (CreateForm onSubmit / BulkAddModal runCreate / DesignEditForm의 `if (photosDirty)` 블록)
  - 카드의 "🖼 이미지 처리" 블록 — 상태 배지, `처리 재시도`/`다시 처리` 버튼, `image_processing_error` 메시지, "처리 결과(검수)" 썸네일
  - `reprocess` 뮤테이션, `imageStatus`·`processedUrls` 변수, `useQuery` `refetchInterval`의 `image_processing_status` 폴링 분기, "· 이미지 처리 완료 후 공개를 권장해요" 문구
  - 카드 폴링은 이제 **`ai_analysis_status`만** 본다 (`page.tsx:1466-1470`). 이게 정상이다.
  - `services/designs.ts:108`의 `processDesign`은 호출부 없는 export로 남아 있다. **건드리지 마라** (정리 여부는 사령관이 별도 판단).
  - 이미지 처리는 "사진 다듬기(정렬)" 경로에서만 돈다. `sortDesigns`·`sort-jobs.ts`는 멀쩡하니 손대지 마라.
- **태스크별 검증은 `pnpm typecheck && pnpm test`.** 둘 다 통과해야 태스크가 끝난다.
- **`pnpm build`는 Task 4(파일 쪼개기 완료 시점)와 1단계 최종에만 돌린다.** 이 환경은 WSL2 + `/mnt/c`(Windows 파일시스템)라 build의 eslint 단계가 10분을 넘긴다. 태스크마다 돌리면 검증에만 1시간 반이 날아간다. 타입 오류는 `typecheck`가 이미 잡고, build 특유의 위험(번들링·라우팅)은 파일 이동이 끝나는 Task 4가 진짜 검증 지점이다.
- **`pnpm build`가 오래 걸린다고 실패로 오판하지 마라.** 컴파일은 35초~2.4분에 끝나고 그 뒤 "Linting and checking validity of types"에서 길게 돈다. 타임아웃으로 죽이면 `EXIT 124`가 뜨는데 이건 빌드 실패가 아니다. 반드시 백그라운드로 돌리고 끝까지 기다려라.
- `_lib/*.ts`는 **런타임 import를 가지지 않는다.** 타입은 반드시 `import type`으로만 가져온다 (`node --test`가 `@/` 별칭을 해석하지 못하므로, 타입 전용이어야 지워져서 실행된다).
- `_lib/*.test.ts`에서 대상 모듈을 가져올 때는 **상대경로 + `.ts` 확장자**를 쓴다 (`./designer-values.ts`). 확장자를 빼면 Node가 못 찾는다.
- 기존 코드의 네이밍·주석 밀도·컴포넌트 분리 방식을 따른다 (AGENTS.md §5).
- 파일 쪼개기(Task 2~4)는 **동작을 1도 바꾸지 않는 순수 이동**이다. 로직 수정은 Task 5부터.

---

### Task 1: `_lib` 순수 함수 + 테스트 인프라

파일 쪼개기 전에 테스트 하네스부터 세운다. 이후 태스크가 이 함수들을 쓴다.

**Files:**
- Create: `src/app/dashboard/designs/_lib/design-helpers.ts`
- Create: `src/app/dashboard/designs/_lib/design-helpers.test.ts`
- Create: `src/app/dashboard/designs/_lib/designer-values.ts`
- Create: `src/app/dashboard/designs/_lib/designer-values.test.ts`
- Modify: `package.json` (scripts에 `test` 한 줄 추가)

**Interfaces:**
- Consumes: `Design` 타입 (`@/services` → `import type`만)
- Produces:
  - `formatWon(n: number): string`
  - `designImageUrls(d: Design): string[]`
  - `urlToObjectKey(url: string): string`
  - `MAX_DETAIL_PHOTOS = 5`, `MAX_EDIT_PHOTOS = 6`
  - `interface ValueRange { min: number; max: number; uniform: boolean }`
  - `priceRange(d: Design): ValueRange`
  - `durationRange(d: Design): ValueRange`

- [ ] **Step 1: `package.json`에 test 스크립트 추가**

`scripts` 안 `"typecheck"` 줄 바로 아래에 추가한다. **다른 줄은 건드리지 않는다.**

```json
    "test": "node --test \"src/**/*.test.ts\"",
```

- [ ] **Step 2: `designer-values.ts`의 실패 테스트를 먼저 쓴다**

Create `src/app/dashboard/designs/_lib/designer-values.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceRange, durationRange } from './designer-values.ts';
import type { Design } from '@/services';

/** 테스트용 최소 Design. 실제 스키마 필드가 많아 필요한 것만 채우고 캐스팅한다. */
function mk(base_price: number, duration_minutes: number, designers?: { base_price: number; duration_minutes: number }[]): Design {
  return {
    base_price,
    duration_minutes,
    designers: designers?.map((x, i) => ({ id: `d${i}`, name: `디자이너${i}`, ...x })),
  } as unknown as Design;
}

test('디자이너가 없으면 기본값 하나로 uniform', () => {
  const r = priceRange(mk(50000, 60));
  assert.deepEqual(r, { min: 50000, max: 50000, uniform: true });
});

test('디자이너가 전부 기본값과 같으면 uniform', () => {
  const r = priceRange(mk(50000, 60, [
    { base_price: 50000, duration_minutes: 60 },
    { base_price: 50000, duration_minutes: 60 },
  ]));
  assert.deepEqual(r, { min: 50000, max: 50000, uniform: true });
});

test('디자이너 가격이 다르면 범위가 되고 uniform=false', () => {
  const r = priceRange(mk(50000, 60, [
    { base_price: 70000, duration_minutes: 90 },
    { base_price: 50000, duration_minutes: 60 },
  ]));
  assert.deepEqual(r, { min: 50000, max: 70000, uniform: false });
});

test('디자이너가 전부 기본값과 다른 같은 값이어도 기본값이 범위에 포함된다', () => {
  // base 50000인데 디자이너 둘 다 70000 → 카드는 "50,000~70,000원"으로 정직하게 보여야 한다
  const r = priceRange(mk(50000, 60, [
    { base_price: 70000, duration_minutes: 90 },
    { base_price: 70000, duration_minutes: 90 },
  ]));
  assert.deepEqual(r, { min: 50000, max: 70000, uniform: false });
});

test('소요시간도 같은 규칙', () => {
  const r = durationRange(mk(50000, 60, [
    { base_price: 50000, duration_minutes: 90 },
    { base_price: 50000, duration_minutes: 60 },
  ]));
  assert.deepEqual(r, { min: 60, max: 90, uniform: false });
});
```

- [ ] **Step 3: 테스트가 실패하는 걸 확인한다**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './designer-values.ts'`

- [ ] **Step 4: `designer-values.ts` 구현**

Create `src/app/dashboard/designs/_lib/designer-values.ts`:

```ts
/**
 * 디자인의 디자이너별 가격·소요시간 범위 계산.
 *
 * 백엔드는 디자이너별 override를 "기본값과 다른 것만" 저장하므로,
 * design.designers[].base_price 는 그 디자이너의 실효 가격이다.
 * 기본값(design.base_price)도 범위에 포함시킨다 — 디자이너 전원이 기본값과
 * 다른 같은 값을 가진 경우에도 "기본과 다르다"는 사실이 카드에 드러나야 하기 때문.
 */
import type { Design } from '@/services';

export interface ValueRange {
  min: number;
  max: number;
  uniform: boolean; // true면 카드에 단일 값, false면 "min~max ▾"
}

function rangeOf(values: number[]): ValueRange {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, uniform: min === max };
}

export function priceRange(d: Design): ValueRange {
  return rangeOf([d.base_price, ...(d.designers ?? []).map((x) => x.base_price)]);
}

export function durationRange(d: Design): ValueRange {
  return rangeOf([d.duration_minutes, ...(d.designers ?? []).map((x) => x.duration_minutes)]);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS — 5 tests

- [ ] **Step 6: `design-helpers.ts`의 실패 테스트를 쓴다**

기존 `page.tsx`에서 옮겨올 순수 함수들이다. 원본은 `page.tsx:63`(formatWon), `:1368`(designImageUrls), `:1787`(urlToObjectKey). **구현하기 전에 원본을 읽고 동작을 그대로 보존한다.**

Create `src/app/dashboard/designs/_lib/design-helpers.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWon, designImageUrls, urlToObjectKey } from './design-helpers.ts';
import type { Design } from '@/services';

test('formatWon: 천단위 콤마 + 원', () => {
  assert.equal(formatWon(50000), '50,000원');
  assert.equal(formatWon(0), '0원');
});

test('designImageUrls: 대표 사진이 먼저 온다', () => {
  const d = {
    thumbnail_url: 'https://x/thumb.jpg',
    images: [
      { id: '1', original_url: 'https://x/a.jpg', sort_order: 1, is_thumbnail: false },
      { id: '2', original_url: 'https://x/thumb.jpg', sort_order: 0, is_thumbnail: true },
    ],
  } as unknown as Design;
  assert.equal(designImageUrls(d)[0], 'https://x/thumb.jpg');
});

test('designImageUrls: 사진이 없으면 빈 배열', () => {
  assert.deepEqual(designImageUrls({ images: [] } as unknown as Design), []);
});

test('urlToObjectKey: 첫 경로 세그먼트(버킷명)를 떼고 key만 남긴다', () => {
  assert.equal(urlToObjectKey('https://cdn.example.com/designs/abc123.jpg'), 'abc123.jpg');
  assert.equal(urlToObjectKey('https://cdn.example.com/bucket/designs/abc.jpg'), 'designs/abc.jpg');
});

test('urlToObjectKey: URL이 아니면 원본을 그대로 돌려준다', () => {
  assert.equal(urlToObjectKey('not-a-url'), 'not-a-url');
});
```

> 위 기대값은 원본(`page.tsx:1787-1793`)의 `new URL(url).pathname.replace(/^\/[^/]+\//, '')` 동작을 실제로 돌려서 확인한 것이다. 이 태스크는 리팩터링이므로 **원본 동작이 정답**이다 — 테스트를 원본에 맞추지, 원본을 테스트에 맞추지 않는다.

- [ ] **Step 7: 테스트 실패 확인**

Run: `pnpm test`
Expected: FAIL — `Cannot find module './design-helpers.ts'`

- [ ] **Step 8: `design-helpers.ts` 구현**

`page.tsx:61-63`, `:1368-1376`, `:1787-1793`의 코드를 **그대로 옮긴다.** 로직을 개선하지 않는다.

Create `src/app/dashboard/designs/_lib/design-helpers.ts`:

```ts
/** 디자인 카드·폼이 공유하는 순수 헬퍼. page.tsx에서 추출 — 동작 변경 없음. */
import type { Design } from '@/services';

export const MAX_DETAIL_PHOTOS = 5;
export const MAX_EDIT_PHOTOS = 6; // 수정 시 대표 1 + 상세 5

export const formatWon = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 확대 뷰에 넘길 사진 URL. 대표 사진이 먼저 오도록 정렬한다. */
export function designImageUrls(d: Design): string[] {
  const imgs = d.images ?? [];
  if (imgs.length > 0) {
    return [...imgs]
      .sort((a, b) => Number(b.is_thumbnail) - Number(a.is_thumbnail))
      .map((i) => i.original_url);
  }
  return d.thumbnail_url ? [d.thumbnail_url] : [];
}

/** 기존 사진 URL에서 object_key를 역추출(수정 폼이 재업로드 없이 기존 사진을 다루기 위함). */
export function urlToObjectKey(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/[^/]+\//, '');
  } catch {
    return url;
  }
}
```

- [ ] **Step 9: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS — 10 tests (designer-values 5 + design-helpers 5)

- [ ] **Step 10: 전체 검증 후 커밋**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 전부 통과. (이 시점엔 `page.tsx`가 아직 자기 사본을 쓰고 있어 중복이다 — Task 2~4에서 제거한다.)

```bash
git add package.json src/app/dashboard/designs/_lib/
git commit -m "test(designs): _lib 순수 함수 추출 + node --test 하네스 (의존성 0)"
```

---

### Task 2: 파일 쪼개기 ① — 사진·폴더 리프 컴포넌트

의존성이 가장 적은 리프부터 뺀다.

**Files:**
- Create: `src/app/dashboard/designs/_components/photo.tsx` — `PhotoItem`, `EditPhoto`, `PhotoTile`, `UploadTile`, `Lightbox`
- Create: `src/app/dashboard/designs/_components/folder-field.tsx` — `FolderField`
- Create: `src/app/dashboard/designs/_components/field.tsx` — `Field`
- Modify: `src/app/dashboard/designs/page.tsx` — 위 항목 삭제 후 import로 대체

**Interfaces:**
- Consumes: `design-helpers.ts`의 `designImageUrls`, `MAX_DETAIL_PHOTOS`
- Produces:
  - `photo.tsx`: `interface PhotoItem`, `interface EditPhoto`, `PhotoTile`, `UploadTile`, `Lightbox` (전부 export)
  - `folder-field.tsx`: `FolderField({ value, onChange }: { value: string; onChange: (v: string) => void })`
  - `field.tsx`: `Field` (원본 `page.tsx:2372-2396`의 시그니처 그대로)

- [ ] **Step 1: 원본 블록을 읽는다**

> ⚠️ 아래 줄번호는 `3a15ac9`(page.tsx 2,300줄) 기준 실측값이다. 다른 세션이 또 커밋했을 수 있으니, **옮기기 전에 반드시 `grep -n "^function \|^interface " src/app/dashboard/designs/page.tsx`로 경계를 재확인해라.** 줄번호가 다르면 줄번호가 아니라 **함수명**을 믿어라.

- `PhotoItem` — `page.tsx:40-47`
- `EditPhoto` — `page.tsx:50-56`
- `FolderField` — `page.tsx:1190-1299`
- `PhotoTile` — `page.tsx:1300-1331`
- `UploadTile` — `page.tsx:1332-1361`
- `Lightbox` — `page.tsx:1373-1453`
- `Field` — `page.tsx:2276-2300`

- [ ] **Step 2: `photo.tsx` 생성**

`'use client';`로 시작한다. `PhotoItem`·`EditPhoto`·`PhotoTile`·`UploadTile`·`Lightbox`를 원본 그대로 옮기고 전부 `export`를 붙인다. `designImageUrls`는 `../_lib/design-helpers`에서 import한다. **JSX·클래스명·로직을 한 글자도 바꾸지 않는다.**

- [ ] **Step 3: `folder-field.tsx` 생성**

`'use client';` + `FolderField`를 원본 그대로 옮기고 `export`.

- [ ] **Step 4: `field.tsx` 생성**

`Field`를 원본 그대로 옮기고 `export`.

- [ ] **Step 5: `page.tsx`에서 원본 삭제 후 import로 교체**

삭제한 블록 자리에 아무것도 남기지 않고, 상단 import에 추가:

```ts
import { PhotoTile, UploadTile, Lightbox } from './_components/photo';
import type { PhotoItem, EditPhoto } from './_components/photo';
import { FolderField } from './_components/folder-field';
import { Field } from './_components/field';
import { designImageUrls, urlToObjectKey, formatWon, MAX_DETAIL_PHOTOS, MAX_EDIT_PHOTOS } from './_lib/design-helpers';
```

`page.tsx`에 남아 있던 `formatWon`(63), `designImageUrls`(1362-1372), `urlToObjectKey`(1706-1717), `MAX_DETAIL_PHOTOS`/`MAX_EDIT_PHOTOS`(61-62) **원본 정의도 함께 삭제**한다 (Task 1에서 `_lib`으로 옮겼으므로 중복).

- [ ] **Step 6: 검증**

Run: `pnpm typecheck && pnpm test`
Expected: 둘 다 통과. (`build`는 이 태스크에서 돌리지 않는다 — Global Constraints 참고) 미사용 import 경고가 뜨면 정리한다.

- [ ] **Step 7: 앱이 그대로 도는지 눈으로 확인**

Run: `pnpm dev` → `http://localhost:3000/dashboard/designs`
Expected: 폴더 목록·디자인 카드·사진 확대(Lightbox)·새 디자인 폼이 **개편 전과 똑같이** 동작한다. 이 태스크는 순수 이동이라 보이는 변화가 0이어야 한다.

- [ ] **Step 8: 커밋**

```bash
git add src/app/dashboard/designs/
git commit -m "refactor(designs): 사진·폴더 리프 컴포넌트를 _components로 추출"
```

---

### Task 3: 파일 쪼개기 ② — 폼 컴포넌트

**Files:**
- Create: `src/app/dashboard/designs/_components/create-form.tsx` — `CreateForm` (`page.tsx:596-929`)
- Create: `src/app/dashboard/designs/_components/refine-form.tsx` — `REFINE_INSTAGRAM_URL`(930-938), `RefineForm`(939-1139), `RefineGuide`(1140-1168), `InstagramIcon`(1169-1189)
- Create: `src/app/dashboard/designs/_components/bulk-add.tsx` — `BulkDropzone`(1718-1760), `BulkAddModal`(1761-1979)
- Create: `src/app/dashboard/designs/_components/design-edit-form.tsx` — `DesignEditForm`(1980-2275)

> ⚠️ 줄번호는 `3a15ac9`(2,300줄) 기준. 옮기기 전에 `grep -n "^function " src/app/dashboard/designs/page.tsx`로 재확인하고, 어긋나면 **함수명을 믿어라.**
- Modify: `src/app/dashboard/designs/page.tsx`

**Interfaces:**
- Consumes: Task 2의 `photo.tsx`, `folder-field.tsx`, `field.tsx`; Task 1의 `_lib/design-helpers.ts`; 기존 `../design-settings`
- Produces: `CreateForm`, `RefineForm`, `BulkDropzone`, `BulkAddModal`, `DesignEditForm` — **원본 props 시그니처 그대로 유지**

- [ ] **Step 1: 각 원본 블록의 props 시그니처를 정확히 적어둔다**

옮기면서 시그니처가 바뀌면 호출부가 깨진다. 4개 파일 각각에 대해 원본의 `function X({...}: {...})` 부분을 그대로 베낀다.

- [ ] **Step 2: `create-form.tsx` 생성 후 `page.tsx`에서 삭제·import**

`'use client';` + 원본 그대로. 필요한 것만 import (`./photo`, `./folder-field`, `./field`, `../_lib/design-helpers`, `../design-settings`).

- [ ] **Step 3: `refine-form.tsx` 생성 후 `page.tsx`에서 삭제·import**

`RefineGuide`·`InstagramIcon`·`REFINE_INSTAGRAM_URL`은 `RefineForm`만 쓰므로 **export하지 않는다** (같은 파일 안 private).

- [ ] **Step 4: `bulk-add.tsx` 생성 후 `page.tsx`에서 삭제·import**

- [ ] **Step 5: `design-edit-form.tsx` 생성 후 `page.tsx`에서 삭제·import**

`DesignEditForm`은 옵션 diff 루프를 포함한다. **로직을 건드리지 않는다.** `3a15ac9`가 이 폼의 `if (photosDirty) processDesign(...)` 블록을 지웠다 — **없는 게 정상이니 되살리지 마라.**

- [ ] **Step 6: 검증**

Run: `pnpm typecheck && pnpm test`
Expected: 둘 다 통과. (`build`는 이 태스크에서 돌리지 않는다 — Global Constraints 참고)

- [ ] **Step 7: 앱 동작 확인**

Run: `pnpm dev`
Expected: `+ 새 디자인` 폼, `사진 다듬기` 폼, 폴더 안 대량 등록(드롭존/모달), 카드의 `수정` 폼 — **전부 개편 전과 동일**.

- [ ] **Step 8: 커밋**

```bash
git add src/app/dashboard/designs/
git commit -m "refactor(designs): 등록·다듬기·대량등록·수정 폼을 _components로 추출"
```

---

### Task 4: 파일 쪼개기 ③ — 폴더 그리드·목록·카드, `page.tsx`를 셸로

**Files:**
- Create: `src/app/dashboard/designs/_components/folder-grid.tsx` — `FolderGrid`(208-237), `FolderCard`(238-260), `EditableFolderCard`(261-356), `NewFolderCard`(357-438)
- Create: `src/app/dashboard/designs/_components/folder-designs.tsx` — `FolderView` 타입(65), `FolderDesigns`(439-595)
- Create: `src/app/dashboard/designs/_components/design-card.tsx` — `DesignCard`(1454-1705)
- Modify: `src/app/dashboard/designs/page.tsx` — `DesignsPage`(67-207) + `DEFAULT_FOLDERS`(59)만 남긴다

**Interfaces:**
- Consumes: Task 2~3의 모든 `_components`, Task 1의 `_lib`
- Produces:
  - `folder-grid.tsx`: `FolderGrid` (원본 props 그대로), 나머지는 private
  - `folder-designs.tsx`: `FolderDesigns`, `export type FolderView = { label: string; folderId?: string; unfiled?: boolean }`
  - `design-card.tsx`: `DesignCard({ design }: { design: Design })`

- [ ] **Step 1: `design-card.tsx` 생성 후 `page.tsx`에서 삭제·import**

`DesignCard`는 `DesignEditForm`(Task 3)과 `Lightbox`(Task 2)를 쓴다. 순환 import가 없는지 확인한다 (`design-edit-form.tsx`는 `design-card.tsx`를 import하지 않아야 한다).

- [ ] **Step 2: `folder-designs.tsx` 생성 후 `page.tsx`에서 삭제·import**

`FolderView`를 여기서 export하고 `page.tsx`가 import한다.

- [ ] **Step 3: `folder-grid.tsx` 생성 후 `page.tsx`에서 삭제·import**

- [ ] **Step 4: `page.tsx` 정리**

`DesignsPage`와 `DEFAULT_FOLDERS`만 남기고, 최상단 주석은 셸 역할에 맞게 줄인다. 미사용 import를 전부 제거한다.

- [ ] **Step 5: `page.tsx`가 200줄 이하인지 확인**

Run: `wc -l src/app/dashboard/designs/page.tsx`
Expected: 200 이하. 넘으면 아직 안 옮긴 게 있다는 뜻이니 찾아서 옮긴다.

- [ ] **Step 6: 검증**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
Expected: 전부 통과.

- [ ] **Step 7: 앱 전체 동작 확인**

Run: `pnpm dev`
Expected: 폴더 목록, 폴더 만들기/이달의아트 지정/삭제, 폴더 진입, 디자인 카드(사진확대·수정·삭제·폴더이동·공개전환·AI재분석), 새 디자인, 사진 다듬기, 대량 등록 — **전부 파일 쪼개기 전과 동일**. 여기까지 보이는 변화는 0이어야 한다.

- [ ] **Step 8: 커밋**

```bash
git add src/app/dashboard/designs/
git commit -m "refactor(designs): page.tsx 2396줄 → 셸(<200줄) + _components 11개로 분해"
```

---

### Task 5: 카드 레이아웃 변경

사진을 키우고, 우측에 제목 → 폴더 → 가격·시간 → 태그를 세로로 쌓는다. 앱 노출 란은 그대로.

**Files:**
- Modify: `src/app/dashboard/designs/_components/design-card.tsx`

**Interfaces:**
- Consumes: `_lib/design-helpers.ts`의 `formatWon`, `designImageUrls`
- Produces: 없음 (내부 JSX 변경만)

- [ ] **Step 1: 사진을 키우고 우측 열을 세로 배치로 바꾼다**

현재 `h-16 w-16`(64px) 썸네일 + 우측에 제목/가격/태그, 그리고 **카드 하단 별도 줄**에 폴더 select가 있다. 이걸 바꾼다:

- 썸네일: `h-16 w-16` → `h-28 w-28` (112px)
- 우측 열 순서: 제목 → **폴더** → 가격·시간 → 태그
- 폴더 줄(원본 `page.tsx:1638-1659` 위치의 블록)을 **우측 열 안 제목 바로 아래로 이동**
- 앱 노출·AI 실패 줄은 **위치·동작 그대로** (이미지 처리 줄은 `3a15ac9`에서 제거됐다 — 없는 게 정상이니 만들지 마라)

수정 OFF 상태 목표:

```
┌─────────┐ 프렌치A
│         │ 📁 7월의 아트
│  사진   │ 50,000원 · 60분
│  크게   │ #젤 #프렌치 #여름
└─────────┘
👁 앱 노출  [공개 중]
```

- [ ] **Step 2: 폴더를 OFF 상태에서 텍스트로 보여준다**

지금은 항상 `<select>`다. 이 태스크에서는 **`d.folder_name ?? '미분류'` 텍스트로 바꾼다.** select는 Task 6에서 수정 ON일 때만 되살린다.

```tsx
<p className="mt-0.5 truncate text-caption text-primary-50">
  📁 {d.folder_name ?? '미분류'}
</p>
```

> 폴더 select를 지우면 이동 기능이 잠깐 사라진다. Task 6에서 수정 ON으로 되살아난다. 두 태스크를 연달아 실행할 것.

- [ ] **Step 3: 가격·시간 줄은 기존 인트로가 표시를 유지한다**

원본 `page.tsx:1574-1584`의 인트로가 취소선 로직을 **그대로 보존**한다. 인트로가 편집은 이번 범위가 아니다 (기존 `수정` 폼에 남는다).

- [ ] **Step 4: 검증**

Run: `pnpm typecheck && pnpm test`
Expected: 둘 다 통과. (`build`는 이 태스크에서 돌리지 않는다 — Global Constraints 참고)

- [ ] **Step 5: 눈으로 확인**

Run: `pnpm dev` → `/dashboard/designs` → 폴더 진입
Expected: 사진이 커지고, 우측에 제목-폴더-가격/시간-태그 순으로 쌓인다. 모바일 셸(max-w-md)에서 넘치거나 깨지지 않는다. 제목이 길면 `truncate`된다.

- [ ] **Step 6: 커밋**

```bash
git add src/app/dashboard/designs/_components/design-card.tsx
git commit -m "feat(designs): 카드 레이아웃 — 사진 확대 + 제목·폴더·가격/시간·태그 세로 배치"
```

---

### Task 6: 수정 ON/OFF 토글 + 폴더 select 복귀

목록 전체에 걸리는 토글이다 (카드마다가 아니다).

**Files:**
- Modify: `src/app/dashboard/designs/_components/folder-designs.tsx` — 토글 상태 + 헤더 버튼
- Modify: `src/app/dashboard/designs/_components/design-card.tsx` — `editMode` prop 수신

**Interfaces:**
- Consumes: 없음
- Produces: `DesignCard({ design, editMode }: { design: Design; editMode: boolean })` — **prop이 하나 늘어난다.** `folder-designs.tsx`가 유일한 호출부다.

- [ ] **Step 1: `folder-designs.tsx`에 토글 상태 추가**

`FolderDesigns` 안에:

```tsx
const [editMode, setEditMode] = useState(false);
```

헤더(뒤로가기 버튼 줄)에 토글 버튼을 놓는다:

```tsx
<button
  type="button"
  onClick={() => setEditMode((v) => !v)}
  aria-pressed={editMode}
  className={
    editMode
      ? 'rounded-md bg-secondary px-3 py-1.5 text-caption font-semibold text-white'
      : 'rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:bg-neutral-50'
  }
>
  {editMode ? '수정 ON' : '수정 OFF'}
</button>
```

- [ ] **Step 2: `editMode`를 카드에 내린다**

```tsx
<DesignCard key={d.id} design={d} editMode={editMode} />
```

- [ ] **Step 3: `DesignCard`가 `editMode`를 받아 폴더를 분기한다**

Task 5에서 텍스트로 바꾼 폴더 줄을 분기로 만든다. select JSX·`move` 뮤테이션은 **원본(`page.tsx:1638-1659`)을 그대로 되살린다.**

```tsx
{editMode ? (
  <select
    value={d.folder_id ?? ''}
    onChange={(e) => move.mutate(e.target.value)}
    disabled={move.isPending}
    className="mt-0.5 rounded-md border border-neutral-300 bg-white px-2 py-1 text-caption outline-none focus:border-secondary disabled:opacity-50"
    aria-label="폴더 이동"
  >
    <option value="">미분류</option>
    {folders.map((f) => (
      <option key={f.id} value={f.id}>{f.name}</option>
    ))}
  </select>
) : (
  <p className="mt-0.5 truncate text-caption text-primary-50">📁 {d.folder_name ?? '미분류'}</p>
)}
```

- [ ] **Step 4: 검증**

Run: `pnpm typecheck && pnpm test`
Expected: 둘 다 통과. (`build`는 이 태스크에서 돌리지 않는다 — Global Constraints 참고)

- [ ] **Step 5: 동작 확인**

Run: `pnpm dev`
Expected: 기본은 `수정 OFF`, 폴더가 텍스트. 누르면 `수정 ON`이 되고 목록의 **모든 카드**가 동시에 폴더 select로 바뀐다. 폴더를 바꾸면 즉시 이동하고 목록이 갱신된다. 다시 OFF로 돌리면 텍스트로 돌아온다.

- [ ] **Step 6: 커밋**

```bash
git add src/app/dashboard/designs/_components/
git commit -m "feat(designs): 목록 전체 수정 ON/OFF 토글 + 수정 ON일 때만 폴더 변경"
```

---

### Task 7: 인라인 가격·소요시간 편집 (디바운스 저장)

**Files:**
- Create: `src/app/dashboard/designs/_lib/use-debounced-save.ts`
- Modify: `src/app/dashboard/designs/design-settings.tsx` — 소요시간 ± 단위를 30분으로
- Modify: `src/app/dashboard/designs/_components/design-card.tsx`

> **후속 정정 (2026-07-17):** 원래 이 태스크는 별도 상수 `CARD_DURATION_STEP = 30`을 신설했으나, 그러면 `DURATION_STEP`(폼의 기본 소요시간·디자이너별 소요시간이 쓰는 `Stepper` 기본 step)이 10으로 남아 같은 뜻의 상수가 둘이 된다. 이후 `DURATION_STEP`을 **10 → 30**으로 바꾸고 `CARD_DURATION_STEP`을 제거해 하나로 통일했다. 아래 본문은 최종 상태로 갱신돼 있다.

**Interfaces:**
- Consumes: `design-settings.tsx`의 `Stepper`, `PRICE_INPUT_STEP`(=1000), `DURATION_STEP`(=30), `clampDuration`, `clampPrice`
- Produces:
  - `use-debounced-save.ts`: `useDebouncedSave<T>(save: (v: T) => void, delayMs?: number): (v: T) => void`

> `use-debounced-save.ts`는 React 훅이라 `_lib`의 "런타임 import 금지" 규칙 예외다. `react`만 import하며 유닛 테스트는 없다 (테스트 러너에 React 환경이 없음). `_lib/*.test.ts` 글롭에 걸리지 않으므로 `pnpm test`에 영향 없다.

- [ ] **Step 1: 소요시간 ± 단위를 30분으로**

`design-settings.tsx`의 `DURATION_STEP`을 **10 → 30**으로 바꾼다. 이게 `Stepper`의 기본 step이라, step을 안 넘기는 폼의 "기본 소요시간"·"디자이너별 소요시간"과 카드 인라인 소요시간이 모두 30분 단위가 된다.

```ts
export const DURATION_STEP = 30; // 기본 소요시간 · 디자이너별 소요시간 +/- 단위(분). Stepper 기본 step이기도 하다
```

카드 인라인 소요시간 스테퍼(design-card.tsx)와 디자이너별 소요시간 스테퍼(designer-rows.tsx)도 이 `DURATION_STEP`을 명시적으로 쓴다. `clampDuration`은 여전히 30~600 범위만 보므로 직접 입력은 30의 배수가 아니어도 허용된다.

- [ ] **Step 2: 디바운스 훅 작성**

Create `src/app/dashboard/designs/_lib/use-debounced-save.ts`:

```ts
'use client';

/**
 * ± 스테퍼 연타를 한 번의 저장으로 합친다.
 * 마지막 값만 delayMs 후 1회 저장하고, 언마운트 시 대기 중인 저장을 버린다.
 */
import { useCallback, useEffect, useRef } from 'react';

export function useDebouncedSave<T>(save: (v: T) => void, delayMs = 800): (v: T) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);

  // 최신 save를 항상 참조 — 의존성 때문에 타이머가 재설정되는 걸 막는다
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return useCallback(
    (v: T) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => saveRef.current(v), delayMs);
    },
    [delayMs],
  );
}
```

- [ ] **Step 3: 카드에 낙관적 로컬 상태 + 저장 뮤테이션을 붙인다**

`DesignCard` 안에 추가한다. **핵심: 서버 폴링(`refetchInterval: 3000`)이 편집 중인 값을 덮어쓰면 안 된다.** 그래서 로컬 draft가 있으면 그걸 우선 보여준다.

```tsx
// 인라인 편집 중인 값(낙관적). null이면 서버 값을 그대로 쓴다.
const [draftPrice, setDraftPrice] = useState<number | null>(null);
const [draftDuration, setDraftDuration] = useState<number | null>(null);
const [saveErr, setSaveErr] = useState<string | null>(null);

const patch = useMutation({
  mutationFn: (body: { base_price?: number; duration_minutes?: number }) =>
    designsApi.updateDesign(d.id, body),
  onSuccess: () => {
    setSaveErr(null);
    setDraftPrice(null);
    setDraftDuration(null);
    qc.invalidateQueries({ queryKey: ['design', d.id] });
    qc.invalidateQueries({ queryKey: ['designs'] });
  },
  onError: (e) => {
    // 롤백 — draft를 버리고 서버 값으로 되돌린다
    setDraftPrice(null);
    setDraftDuration(null);
    setSaveErr(toUserMessage(e));
  },
});

const savePrice = useDebouncedSave<number>((v) => patch.mutate({ base_price: v }));
const saveDuration = useDebouncedSave<number>((v) => patch.mutate({ duration_minutes: v }));

const shownPrice = draftPrice ?? d.base_price;
const shownDuration = draftDuration ?? d.duration_minutes;
```

- [ ] **Step 4: 수정 ON일 때 스테퍼를 렌더한다**

가격·시간 줄을 분기한다. `Stepper`는 클램프를 하지 않으므로 **호출부에서 반드시 clamp한다.**

```tsx
{editMode ? (
  <div className="mt-1 flex flex-col gap-1.5">
    <Stepper
      value={shownPrice}
      step={PRICE_INPUT_STEP}
      suffix="원"
      ariaLabel="가격"
      onChange={(v) => {
        const next = clampPrice(v);
        setDraftPrice(next);
        savePrice(next);
      }}
    />
    <Stepper
      value={shownDuration}
      step={DURATION_STEP}
      suffix="분"
      ariaLabel="소요시간"
      onChange={(v) => {
        const next = clampDuration(v);
        setDraftDuration(next);
        saveDuration(next);
      }}
    />
    {saveErr && <span className="text-caption text-danger">{saveErr}</span>}
  </div>
) : (
  /* Task 5의 기존 가격·시간 표시(인트로가 취소선 포함)를 그대로 둔다 */
)}
```

- [ ] **Step 5: 검증**

Run: `pnpm typecheck && pnpm test`
Expected: 둘 다 통과. (`build`는 이 태스크에서 돌리지 않는다 — Global Constraints 참고)

- [ ] **Step 6: 동작 확인 — 특히 연타와 클램프**

Run: `pnpm dev`
Expected:
- 수정 ON → 가격·시간이 ± 스테퍼로 바뀐다
- `+`를 5번 빠르게 누르면 화면은 즉시 5,000원 오르고, **저장 요청은 손 뗀 뒤 1번만** 나간다 (DevTools Network에서 PATCH 1건 확인)
- 소요시간 `−`를 계속 눌러도 30분 밑으로 안 내려간다 (`clampDuration`의 `DURATION_MIN = 30`)
- 가격 `−`를 계속 눌러도 0원 밑으로 안 내려간다 (`clampPrice`)
- 저장 실패 시 값이 원래대로 돌아오고 빨간 메시지가 뜬다 (오프라인으로 만들어 확인)

- [ ] **Step 7: 커밋**

```bash
git add src/app/dashboard/designs/
git commit -m "feat(designs): 카드 인라인 가격(±1000)·소요시간(±30) 편집 + 800ms 디바운스 저장"
```

---

### Task 8: 인라인 태그 편집

**Files:**
- Modify: `src/app/dashboard/designs/_components/design-card.tsx`

**Interfaces:**
- Consumes: `design-settings.tsx`의 `TagInput` (칩 `×` + Enter 등록 + `MAX_OWNER_TAGS` 상한이 이미 구현되어 있다 — 새로 만들지 않는다)
- Produces: 없음

- [ ] **Step 1: 태그 draft 상태 + 저장을 추가한다**

태그는 연타 대상이 아니므로 **디바운스 없이 즉시 저장**한다.

```tsx
const [draftTags, setDraftTags] = useState<string[] | null>(null);

const patchTags = useMutation({
  mutationFn: (owner_tags: string[]) => designsApi.updateDesign(d.id, { owner_tags }),
  onSuccess: () => {
    setSaveErr(null);
    setDraftTags(null);
    qc.invalidateQueries({ queryKey: ['design', d.id] });
    qc.invalidateQueries({ queryKey: ['designs'] });
  },
  onError: (e) => {
    setDraftTags(null); // 롤백
    setSaveErr(toUserMessage(e));
  },
});

const shownTags = draftTags ?? d.owner_tags;
```

- [ ] **Step 2: 수정 ON일 때 `TagInput`을 렌더한다**

```tsx
{editMode ? (
  <div className="mt-2">
    <TagInput
      tags={shownTags}
      onChange={(next) => {
        setDraftTags(next);
        patchTags.mutate(next);
      }}
    />
  </div>
) : (
  /* Task 5의 기존 #태그 칩 표시를 그대로 둔다 */
)}
```

- [ ] **Step 3: 검증**

Run: `pnpm typecheck && pnpm test`
Expected: 둘 다 통과. (`build`는 이 태스크에서 돌리지 않는다 — Global Constraints 참고)

- [ ] **Step 4: 동작 확인**

Run: `pnpm dev`
Expected:
- 수정 ON → 태그가 입력 가능한 칩 박스로 바뀐다
- 칩의 `×`를 누르면 즉시 사라지고 저장된다
- 단어 입력 후 Enter → 즉시 추가·저장된다
- 10개가 차면 입력칸이 사라진다 (`MAX_OWNER_TAGS`)
- 수정 OFF → 다시 읽기 전용 `#태그` 칩

- [ ] **Step 5: 커밋**

```bash
git add src/app/dashboard/designs/_components/design-card.tsx
git commit -m "feat(designs): 카드 인라인 태그 편집 (TagInput 재사용, 즉시 저장)"
```

---

### Task 9: 디자이너별 가격·소요시간 범위 표시 + 펼침 편집

**Files:**
- Create: `src/app/dashboard/designs/_components/designer-rows.tsx`
- Modify: `src/app/dashboard/designs/_components/design-card.tsx`

**Interfaces:**
- Consumes: Task 1의 `priceRange`, `durationRange`, `ValueRange`; `design-settings.tsx`의 `Stepper`, `PRICE_STEP`(=5000, 디자이너별 가격용), `DURATION_STEP`, `clampPrice`, `clampDuration`; `_lib/design-helpers.ts`의 `formatWon`
- Produces: `DesignerRows({ design, editMode }: { design: Design; editMode: boolean })`

- [ ] **Step 1: 카드에 범위 표시를 붙인다**

`design-card.tsx`의 가격·시간 줄(수정 OFF 분기)에서:

```tsx
const pr = priceRange(d);
const dr = durationRange(d);
const [showDesigners, setShowDesigners] = useState(false);
const hasVariance = !pr.uniform || !dr.uniform;
```

범위가 있으면 `50,000~70,000원 ▾`로, 없으면 기존 단일 표시로.

```tsx
{pr.uniform ? (
  /* 기존 인트로가 취소선 포함 단일 표시 유지 */
) : (
  <button type="button" onClick={() => setShowDesigners((v) => !v)} className="text-body-sm text-primary-50">
    {formatWon(pr.min)}~{formatWon(pr.max)} {showDesigners ? '▴' : '▾'}
  </button>
)}
{' · '}
{dr.uniform ? `${d.duration_minutes}분` : `${dr.min}~${dr.max}분`}
```

> **인트로가 주의:** 인트로가 취소선은 `pr.uniform`일 때만 보여준다. 범위일 때 취소선까지 겹치면 읽을 수 없다. 범위 표시가 우선이다.

- [ ] **Step 2: `designer-rows.tsx` 작성**

`designers.length < 2`면 아무것도 렌더하지 않는다 (기존 `multiDesigner` 규칙과 동일).

```tsx
'use client';

/**
 * 디자인 카드의 디자이너별 가격·소요시간 줄.
 * 백엔드 계약상 designer_prices/designer_durations는 "기본값과 다른 것만" 보내되
 * designer_ids 전체 목록을 항상 함께 보내야 한다.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { designsApi } from '@/services';
import type { Design } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import { Stepper, PRICE_STEP, DURATION_STEP, clampPrice, clampDuration } from '../design-settings';
import { formatWon } from '../_lib/design-helpers';

export function DesignerRows({ design: d, editMode }: { design: Design; editMode: boolean }) {
  const qc = useQueryClient();
  const designers = d.designers ?? [];
  const [err, setErr] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (rows: { id: string; base_price: number; duration_minutes: number }[]) =>
      designsApi.updateDesign(d.id, {
        designer_ids: rows.map((r) => r.id),
        // 기본값과 다른 것만 전송 — 기존 저장 규칙과 동일
        designer_prices: rows.filter((r) => r.base_price !== d.base_price)
          .map((r) => ({ designer_id: r.id, base_price: r.base_price })),
        designer_durations: rows.filter((r) => r.duration_minutes !== d.duration_minutes)
          .map((r) => ({ designer_id: r.id, duration_minutes: r.duration_minutes })),
      }),
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e) => setErr(toUserMessage(e)),
  });

  if (designers.length < 2) return null;

  const rows = designers.map((x) => ({ id: x.id, base_price: x.base_price, duration_minutes: x.duration_minutes }));
  const patchRow = (id: string, next: Partial<{ base_price: number; duration_minutes: number }>) =>
    save.mutate(rows.map((r) => (r.id === id ? { ...r, ...next } : r)));

  return (
    <div className="mt-2 space-y-1.5 rounded-md bg-neutral-50 p-2">
      <div className="flex items-center justify-between text-caption text-primary-50">
        <span>기본</span>
        <span className="tabular-nums">{formatWon(d.base_price)} · {d.duration_minutes}분</span>
      </div>
      {designers.map((x) => {
        const custom = x.base_price !== d.base_price || x.duration_minutes !== d.duration_minutes;
        return (
          <div key={x.id} className="flex items-center justify-between gap-2 text-caption">
            <span className="truncate">{x.name}</span>
            {editMode ? (
              <div className="flex shrink-0 items-center gap-1">
                <Stepper
                  value={x.base_price}
                  step={PRICE_STEP}
                  suffix="원"
                  ariaLabel={`${x.name} 가격`}
                  onChange={(v) => patchRow(x.id, { base_price: clampPrice(v) })}
                />
                <Stepper
                  value={x.duration_minutes}
                  step={DURATION_STEP}
                  suffix="분"
                  ariaLabel={`${x.name} 소요시간`}
                  onChange={(v) => patchRow(x.id, { duration_minutes: clampDuration(v) })}
                />
                {custom && (
                  <button
                    type="button"
                    onClick={() => patchRow(x.id, { base_price: d.base_price, duration_minutes: d.duration_minutes })}
                    className="rounded-md bg-neutral-200 px-2 py-1 text-caption font-semibold text-primary"
                  >
                    기본으로
                  </button>
                )}
              </div>
            ) : (
              <span className="shrink-0 tabular-nums text-primary-50">
                {formatWon(x.base_price)} · {x.duration_minutes}분 {custom ? '따로' : '기본'}
              </span>
            )}
          </div>
        );
      })}
      {err && <p className="text-caption text-danger">{err}</p>}
    </div>
  );
}
```

- [ ] **Step 3: 카드에서 펼침 상태일 때 렌더한다**

```tsx
{(showDesigners || (editMode && hasVariance)) && <DesignerRows design={d} editMode={editMode} />}
```

- [ ] **Step 4: 검증**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
Expected: 전부 통과.

- [ ] **Step 5: 동작 확인**

Run: `pnpm dev`
Expected:
- 디자이너가 1명이거나 전부 같은 값 → 카드는 예전처럼 `50,000원 · 60분` 단일 표시, 펼침 없음
- 디자이너별로 다르면 → `50,000~70,000원 ▾ · 60~90분`
- `▾` 누르면 기본/디자이너별 줄이 펼쳐지고 `따로`/`기본` 표시가 맞다
- 수정 ON + 펼침 → 줄마다 ± 스테퍼, 값을 바꾸면 저장되고 범위가 갱신된다
- `기본으로` 누르면 그 디자이너가 기본값으로 돌아가고, 전원이 기본이 되면 범위 표시가 단일 표시로 바뀐다

> **디자이너 2명 이상인 테스트 데이터가 필요하다.** 없으면 `.claude/skills/verify/` 하네스로 `/api/v1` 응답에 `designers` 배열을 주입해 확인한다. 단 이 하네스는 아직 한 번도 실행된 적 없는 이식본이라(SKILL.md 경고) 셀렉터 대조가 먼저 필요할 수 있다.

- [ ] **Step 6: 커밋**

```bash
git add src/app/dashboard/designs/_components/
git commit -m "feat(designs): 카드에 디자이너별 가격·소요시간 범위 표시 + 펼침 편집"
```

---

## 1단계 완료 조건

- [ ] `pnpm typecheck && pnpm lint && pnpm build && pnpm test` 전부 통과
- [ ] `page.tsx` 200줄 이하, `_components/` 11개 파일, `_lib/` 5개 파일(순수함수 2 + 훅 1 + 테스트 2)
- [ ] 수정 OFF에서 카드가 사진 크게 + 제목·폴더·가격/시간·태그 세로 배치
- [ ] 수정 ON에서 가격(±1,000)·시간(±30)·태그(×/Enter)·폴더(select)가 카드에서 바로 편집됨
- [ ] 디자이너별로 값이 다른 디자인이 범위로 표시되고 펼쳐서 편집됨
- [ ] 기존 기능(사진확대·상세수정폼·삭제·공개전환·AI재분석·새디자인·사진다듬기·대량등록)이 전부 그대로 동작
- [ ] 이미지 자동 처리 UI가 되살아나지 않았다 (`grep -rn "processDesign\|image_processing\|reprocess" src/app/dashboard/designs/` 결과 0건)

## 다음 단계 (별도 계획)

- **2단계 — 목록**: 다중선택(삭제·폴더이동·공개·비공개), 폴더명 변경, 공개 우선 정렬
- **3단계 — 일괄**: `_lib/standards.ts`(최빈 그룹·커버리지 집계), `_lib/apply.ts`(`applyToMany`), 미리보기 다이얼로그, 폴더·미분류·샵 현황판

각 단계는 이 계획이 끝난 뒤 별도 plan 문서로 작성한다.
