# 디자인 목록 정리(2단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폴더 안 디자인 목록에 다중선택(삭제·폴더이동·공개·비공개), 폴더명 변경, 공개 디자인 상단 우선 정렬을 붙인다.

**Architecture:** 일괄 API가 없으므로 모든 배치 작업은 클라이언트가 요청을 N번 도는 `applyToMany()` 루프다(동시 3개, 부분 실패 시 롤백 없이 재시도). 이 루프는 3단계 현황판도 그대로 재사용하므로 2단계에서 먼저 만든다. 다중선택은 `FolderDesigns`의 새 `selectMode` 상태이고, `DesignCard`는 선택 체크박스를 받는다. 정렬은 순수 함수 `sortPublishedFirst`로 렌더 직전 적용한다.

**Tech Stack:** Next.js 15.1 App Router, React 19, TypeScript 5.7 strict, TanStack Query v5, Tailwind v4. 순수 함수 단위 테스트는 `node --test`(Node 24 네이티브 TS 스트리핑, 의존성 0).

## Global Constraints

이 문단의 규칙은 **모든 태스크에 암묵적으로 포함**된다. 값은 사령관 지시·스펙 §2에서 그대로 옮겼다.

- **브랜치는 `feature/designs-card-inline` 하나만.** 새 브랜치 생성 금지. `main`에 커밋 금지(자동 배포).
- **PR·푸시 금지.** `git push` / `gh pr create` / `gh pr merge` 를 어떤 이유로도 실행하지 않는다. 다 끝나도 보고만 한다.
- **`next.config.ts` 커밋 금지.** 미커밋 CORS 우회 변경이 들어 있다. `git add .` / `git commit -a` 금지 — 항상 파일 경로를 지정해 add 한다.
- **의존성 추가 금지.** `package.json`의 `dependencies`/`devDependencies`를 건드리지 않는다.
- **백엔드 계약 수정 금지.** `backend-context/` 와 `src/types/api.d.ts` 를 손대지 않는다.
- **이미지 자동 처리 UI 복원 금지.** `processDesign` 자동호출, 🖼 이미지 처리 블록, `image_processing_status` 폴링 등은 이미 제거됐다. 되살리지 않는다.
- **모든 일괄 작업은 `applyToMany()` 한 군데를 거친다.** 동시 실행 3개. 중간 실패해도 롤백하지 않고 "N개 완료, M개 실패" + 실패 목록 + 재시도를 띄운다.
- **검증:** 태스크마다 `pnpm typecheck` 와 `pnpm test` 통과. `pnpm build` 는 단계 경계에서만(WSL2 `/mnt/c` 빌드는 ~10분 걸린다. `EXIT 124`는 타임아웃이지 실패가 아니다 — 백그라운드로 돌리고 기다린다).
- **순수 함수 테스트는 `@/` 임포트를 타입 전용(`import type`)으로만.** 런타임 임포트는 상대경로 `./x.ts`. (네이티브 TS 스트리핑이 `@/` 별칭을 런타임에 해석하지 못한다. 타입은 지워지므로 안전하다.)

---

## File Structure

```
src/app/dashboard/designs/
├── _lib/
│   ├── apply.ts             applyToMany() — N번 루프 + 동시성 제한 + 부분실패   ← 신규 (3단계도 재사용)
│   ├── apply.test.ts                                                          ← 신규
│   ├── sort-designs.ts      sortPublishedFirst() — 공개 우선 안정 정렬          ← 신규
│   └── sort-designs.test.ts                                                   ← 신규
├── _components/
│   ├── bulk-action-bar.tsx  선택된 디자인에 삭제·이동·공개·비공개 실행 + 진행/실패 ← 신규
│   ├── folder-designs.tsx   선택 모드 상태 + 정렬 적용 + 액션바 연결            ← 수정
│   ├── design-card.tsx      선택 체크박스 prop                                 ← 수정
│   └── folder-grid.tsx      폴더명 변경 UI                                     ← 수정
```

---

### Task 1: `applyToMany` — N번 루프 + 동시성 제한 + 부분 실패

**Files:**
- Create: `src/app/dashboard/designs/_lib/apply.ts`
- Test: `src/app/dashboard/designs/_lib/apply.test.ts`

**Interfaces:**
- Consumes: 없음(순수 유틸).
- Produces:
  ```ts
  export interface ApplyResult<T> {
    ok: T[];
    failed: { target: T; error: unknown }[];
  }
  export function applyToMany<T>(
    targets: T[],
    fn: (t: T) => Promise<void>,
    onProgress?: (done: number, total: number) => void,
    concurrency?: number, // 기본 3
  ): Promise<ApplyResult<T>>;
  ```
  성공/실패와 무관하게 항상 resolve한다(절대 reject하지 않는다). `ok`/`failed`의 원소 순서는 완료 순서라 입력 순서와 다를 수 있다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/app/dashboard/designs/_lib/apply.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyToMany } from './apply.ts';

test('전부 성공하면 ok에 모두, failed는 빈 배열', async () => {
  const seen: number[] = [];
  const r = await applyToMany([1, 2, 3], async (t) => {
    seen.push(t);
  });
  assert.equal(r.ok.length, 3);
  assert.equal(r.failed.length, 0);
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});

test('일부 실패하면 ok/failed로 갈리고 에러가 담긴다', async () => {
  const r = await applyToMany([1, 2, 3, 4], async (t) => {
    if (t % 2 === 0) throw new Error(`fail-${t}`);
  });
  assert.deepEqual([...r.ok].sort(), [1, 3]);
  assert.deepEqual(r.failed.map((f) => f.target).sort(), [2, 4]);
  assert.ok(r.failed.every((f) => f.error instanceof Error));
});

test('onProgress가 완료마다 total과 함께 호출된다', async () => {
  const calls: [number, number][] = [];
  await applyToMany([1, 2, 3], async () => {}, (done, total) => calls.push([done, total]));
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[calls.length - 1], [3, 3]);
  assert.deepEqual(calls.map((c) => c[0]), [1, 2, 3]);
});

test('동시 실행이 concurrency를 넘지 않는다', async () => {
  let active = 0;
  let peak = 0;
  const fn = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((res) => setTimeout(res, 10));
    active--;
  };
  await applyToMany([1, 2, 3, 4, 5, 6, 7, 8], fn, undefined, 3);
  assert.ok(peak <= 3, `peak=${peak} should be <= 3`);
  assert.ok(peak >= 2, `peak=${peak} should reach the limit`);
});

test('빈 targets는 즉시 빈 결과', async () => {
  const r = await applyToMany([], async () => {});
  assert.deepEqual(r, { ok: [], failed: [] });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test "src/app/dashboard/designs/_lib/apply.test.ts"`
Expected: FAIL — `Cannot find module './apply.ts'` (또는 `applyToMany is not a function`).

- [ ] **Step 3: 최소 구현**

`src/app/dashboard/designs/_lib/apply.ts`:
```ts
/**
 * 일괄 작업 공용 루프. owner 쪽엔 배치 API가 없어 모든 일괄 작업은 요청을 N번 돈다.
 * 동시 실행을 제한하고(모바일 웹 + 백엔드 부하), 진행률을 보고하며,
 * 중간 실패해도 롤백하지 않고 성공/실패로 갈라 돌려준다(PATCH는 트랜잭션이 아니다).
 * 백엔드에 일괄 엔드포인트가 생기면 이 함수 하나만 갈아끼운다.
 */
export interface ApplyResult<T> {
  ok: T[];
  failed: { target: T; error: unknown }[];
}

export async function applyToMany<T>(
  targets: T[],
  fn: (t: T) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
  concurrency = 3,
): Promise<ApplyResult<T>> {
  const total = targets.length;
  const result: ApplyResult<T> = { ok: [], failed: [] };
  let done = 0;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < total) {
      const i = next++;
      const t = targets[i];
      try {
        await fn(t);
        result.ok.push(t);
      } catch (error) {
        result.failed.push({ target: t, error });
      }
      done++;
      onProgress?.(done, total);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);
  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test "src/app/dashboard/designs/_lib/apply.test.ts"`
Expected: PASS — 5 tests.

- [ ] **Step 5: 타입체크**

Run: `pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/app/dashboard/designs/_lib/apply.ts src/app/dashboard/designs/_lib/apply.test.ts
git commit -m "feat(designs): 일괄 작업 공용 루프 applyToMany"
```

---

### Task 2: `sortPublishedFirst` — 공개 우선 안정 정렬

**Files:**
- Create: `src/app/dashboard/designs/_lib/sort-designs.ts`
- Test: `src/app/dashboard/designs/_lib/sort-designs.test.ts`

**Interfaces:**
- Consumes: `type { Design } from '@/services'`(타입 전용).
- Produces:
  ```ts
  export function sortPublishedFirst(designs: Design[]): Design[];
  ```
  `visibility === 'active'` 를 앞으로, 나머지는 뒤로. 각 무리 안의 상대 순서는 원본 그대로(안정). 입력 배열을 변형하지 않고 새 배열을 반환한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/app/dashboard/designs/_lib/sort-designs.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortPublishedFirst } from './sort-designs.ts';
import type { Design } from '@/services';

function mk(id: string, visibility: 'active' | 'hidden'): Design {
  return { id, visibility } as unknown as Design;
}

test('공개(active)가 앞, 비공개가 뒤로 간다', () => {
  const input = [mk('a', 'hidden'), mk('b', 'active'), mk('c', 'hidden'), mk('d', 'active')];
  const out = sortPublishedFirst(input);
  assert.deepEqual(out.map((d) => d.id), ['b', 'd', 'a', 'c']);
});

test('각 무리 안의 원래 순서를 유지한다(안정 정렬)', () => {
  const input = [mk('a', 'active'), mk('b', 'active'), mk('c', 'active')];
  const out = sortPublishedFirst(input);
  assert.deepEqual(out.map((d) => d.id), ['a', 'b', 'c']);
});

test('원본 배열을 변형하지 않는다', () => {
  const input = [mk('a', 'hidden'), mk('b', 'active')];
  sortPublishedFirst(input);
  assert.deepEqual(input.map((d) => d.id), ['a', 'b']);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test "src/app/dashboard/designs/_lib/sort-designs.test.ts"`
Expected: FAIL — `Cannot find module './sort-designs.ts'`.

- [ ] **Step 3: 최소 구현**

`src/app/dashboard/designs/_lib/sort-designs.ts`:
```ts
/**
 * 공개(visibility === 'active') 디자인을 목록 상단으로 올린다.
 * 두 무리 각각의 상대 순서는 원본 그대로 유지한다(filter는 순서를 보존하므로 안정적이다).
 */
import type { Design } from '@/services';

export function sortPublishedFirst(designs: Design[]): Design[] {
  return [
    ...designs.filter((d) => d.visibility === 'active'),
    ...designs.filter((d) => d.visibility !== 'active'),
  ];
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test "src/app/dashboard/designs/_lib/sort-designs.test.ts"`
Expected: PASS — 3 tests.

- [ ] **Step 5: 커밋**

```bash
git add src/app/dashboard/designs/_lib/sort-designs.ts src/app/dashboard/designs/_lib/sort-designs.test.ts
git commit -m "feat(designs): 공개 우선 정렬 sortPublishedFirst"
```

---

### Task 3: 폴더명 변경 UI

**Files:**
- Modify: `src/app/dashboard/designs/_components/folder-grid.tsx` (`EditableFolderCard`)

**Interfaces:**
- Consumes: `designsApi.updateFolder(folderId, { name })` — 계약(`DesignFolderUpdate.name`)에 이미 있고 서비스 함수도 있다. 새 API 불필요.
- Produces: 없음(폴더 카드 내부 UI만).

**배경:** `EditableFolderCard`는 지금 `featured_month`(이달의 아트 진행월)만 편집한다. 폴더 이름을 바꾸는 입력을 같은 편집 영역에 추가한다. `update` 뮤테이션은 이미 `{ featured_month }`를 보내는데, `{ name?, featured_month? }`를 함께 보내도록 넓힌다.

- [ ] **Step 1: 이름 상태와 뮤테이션 바디 확장**

`EditableFolderCard` 안에서 `const [month, setMonth] = useState(...)` 아래에 이름 상태를 추가한다:
```tsx
  const [name, setName] = useState(folder.name);
```
`update` 뮤테이션의 `mutationFn` 시그니처를 넓힌다(기존 `body: { featured_month: string | null }` → 아래로 교체):
```tsx
  const update = useMutation({
    mutationFn: (body: { name?: string; featured_month?: string | null }) =>
      designsApi.updateFolder(folder.id, body),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ['design-folders'] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e) => setError(toUserMessage(e)),
  });
```

- [ ] **Step 2: 편집 영역에 이름 입력칸 추가, 저장 시 이름+진행월 함께 전송**

`editing` 분기(`<div className="mt-2 flex flex-col gap-1.5">`) 안에서 `<input type="month" ... />` **위에** 이름 입력칸을 넣는다:
```tsx
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="폴더 이름"
            maxLength={60}
            className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-body-sm outline-none focus:border-secondary"
          />
```
저장 버튼의 `onClick`을 이름·진행월을 함께 보내도록 바꾼다(빈 이름은 저장 안 함):
```tsx
            <button
              onClick={() => {
                const trimmed = name.trim();
                if (!trimmed) {
                  setError('폴더 이름을 입력해 주세요.');
                  return;
                }
                update.mutate({ name: trimmed, featured_month: month || null });
              }}
              disabled={update.isPending}
              className="flex-1 rounded-md bg-secondary py-1 text-caption font-semibold text-white disabled:opacity-50"
            >
              저장
            </button>
```
취소 버튼의 `onClick`이 `month`를 되돌리는데, `name`도 함께 되돌린다:
```tsx
              onClick={() => {
                setEditing(false);
                setMonth(folder.featured_month ?? '');
                setName(folder.name);
                setError(null);
              }}
```

- [ ] **Step 3: 진입 버튼 문구를 "폴더 편집"으로**

편집 아닐 때 `setEditing(true)`를 호출하는 버튼(현재 문구 `{folder.featured_month ? '진행월 변경' : '이달의 아트 지정'}`)을 이름도 바꿀 수 있음이 드러나게 고친다:
```tsx
          <button
            onClick={() => setEditing(true)}
            className="text-left text-caption text-primary-50 underline hover:text-secondary"
          >
            폴더 편집
          </button>
```

- [ ] **Step 4: 타입체크**

Run: `pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 5: 화면 확인**

Run: 개발 서버가 이미 떠 있으면 재사용, 아니면 `pnpm dev`. 폴더 카드의 "폴더 편집"을 눌러 이름을 바꾸고 저장 → 폴더 목록에 새 이름이 반영되는지 확인. 빈 이름 저장 시 에러 문구가 뜨는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/app/dashboard/designs/_components/folder-grid.tsx
git commit -m "feat(designs): 폴더 이름 변경 UI"
```

---

### Task 4: 디자인 카드 선택 체크박스

**Files:**
- Modify: `src/app/dashboard/designs/_components/design-card.tsx` (`DesignCard`)

**Interfaces:**
- Consumes: 없음.
- Produces: `DesignCard`에 선택 모드 props 3개 추가.
  ```ts
  // DesignCard props (기존 design, editMode에 추가)
  selectMode?: boolean;      // true면 카드가 선택 대상으로 동작(인라인 편집·액션 버튼 숨김)
  selected?: boolean;        // 체크 여부
  onToggleSelect?: () => void;
  ```
  `selectMode`와 `editMode`는 상호 배타다(부모가 동시에 켜지 않는다). Task 5에서 `FolderDesigns`가 이 props를 채운다.

**배경:** 선택 모드에서는 카드가 "지울/옮길 대상"을 고르는 용도라 인라인 편집·개별 액션(수정/삭제/공개 버튼, 앱 노출 줄)을 노출하지 않는다. 카드 전체를 누르면 선택이 토글되고 좌상단에 체크 표시가 뜬다.

- [ ] **Step 1: props 시그니처 확장**

`DesignCard` 선언을 아래로 바꾼다:
```tsx
export function DesignCard({
  design,
  editMode,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  design: Design;
  editMode: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
```

- [ ] **Step 2: 선택 모드 카드 렌더를 최상단에서 분기**

`return (` 바로 위에, 선택 모드일 때 쓰는 간이 카드를 먼저 반환한다(기존 `d`, `pr`, `dr`, `formatWon`, `designImageUrls`는 이미 위에서 계산돼 있으므로 그대로 쓴다):
```tsx
  if (selectMode) {
    return (
      <li>
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={selected}
          className={`flex w-full items-center gap-3 rounded-lg border p-4 text-left transition ${
            selected ? 'border-secondary bg-secondary/5' : 'border-neutral-200 bg-white hover:bg-neutral-50'
          }`}
        >
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-caption font-bold ${
              selected ? 'border-secondary bg-secondary text-white' : 'border-neutral-300 bg-white text-transparent'
            }`}
            aria-hidden
          >
            ✓
          </span>
          <span className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-neutral-200">
            {d.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.thumbnail_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="block h-full w-full bg-neutral-100" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{d.title}</span>
            <span className="block truncate text-caption text-primary-50">
              📁 {d.folder_name ?? '미분류'} · {d.visibility === 'active' ? '공개 중' : '비공개'}
            </span>
          </span>
        </button>
      </li>
    );
  }
```

- [ ] **Step 3: 타입체크**

Run: `pnpm typecheck`
Expected: 에러 없음(새 props는 옵셔널이라 기존 `FolderDesigns` 호출부는 그대로 통과).

- [ ] **Step 4: 커밋**

```bash
git add src/app/dashboard/designs/_components/design-card.tsx
git commit -m "feat(designs): 디자인 카드 선택 모드 렌더"
```

---

### Task 5: 다중선택 모드 + 일괄 액션바

**Files:**
- Create: `src/app/dashboard/designs/_components/bulk-action-bar.tsx`
- Modify: `src/app/dashboard/designs/_components/folder-designs.tsx`

**Interfaces:**
- Consumes: `applyToMany`(Task 1), `sortPublishedFirst`(Task 2), `DesignCard`의 선택 props(Task 4), `designsApi.deleteDesign` / `changeVisibility` / `updateDesign`.
- Produces:
  ```ts
  // bulk-action-bar.tsx
  export function BulkActionBar(props: {
    selectedIds: string[];
    folders: { id: string; name: string }[];
    onDone: () => void;        // 성공 후 목록·폴더 캐시 무효화
    onClearSelection: () => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: `BulkActionBar` 작성**

`src/app/dashboard/designs/_components/bulk-action-bar.tsx`:
```tsx
'use client';

/**
 * 선택된 디자인들에 삭제·폴더이동·공개·비공개를 일괄 적용한다.
 * 일괄 API가 없어 applyToMany로 요청을 N번 돈다(동시 3개). 중간 실패는 롤백하지 않고
 * "N개 완료, M개 실패" + 재시도(실패한 것만 다시)를 띄운다.
 */
import { useState } from 'react';
import { designsApi } from '@/services';
import { applyToMany, type ApplyResult } from '../_lib/apply';

type Job = { label: string; fn: (id: string) => Promise<void> };

export function BulkActionBar({
  selectedIds,
  folders,
  onDone,
  onClearSelection,
}: {
  selectedIds: string[];
  folders: { id: string; name: string }[];
  onDone: () => void;
  onClearSelection: () => void;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ApplyResult<string> | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);

  const run = async (job: Job, ids: string[]) => {
    setResult(null);
    setProgress({ done: 0, total: ids.length });
    const r = await applyToMany(ids, job.fn, (done, total) => setProgress({ done, total }));
    setProgress(null);
    setResult(r);
    onDone();
    if (r.failed.length === 0) onClearSelection();
  };

  const del: Job = { label: '삭제', fn: (id) => designsApi.deleteDesign(id) };
  const publish: Job = { label: '공개', fn: (id) => designsApi.changeVisibility(id, { visibility: 'active' }) };
  const hide: Job = { label: '비공개', fn: (id) => designsApi.changeVisibility(id, { visibility: 'hidden' }) };
  const moveTo = (folderId: string): Job => ({
    label: '폴더이동',
    fn: (id) => designsApi.updateDesign(id, { folder_id: folderId || null }),
  });

  const busy = progress !== null;
  const count = selectedIds.length;

  return (
    <div className="sticky bottom-0 z-10 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-sm font-semibold text-primary">{count}개 선택됨</span>
        <button onClick={onClearSelection} className="text-caption text-primary-50 underline">
          선택 해제
        </button>
      </div>

      {busy ? (
        <p className="mt-2 text-caption text-primary-50">
          처리 중… {progress!.done}/{progress!.total}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            onClick={() => setMoveOpen((v) => !v)}
            disabled={count === 0}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary hover:bg-neutral-50 disabled:opacity-50"
          >
            폴더이동
          </button>
          <button
            onClick={() => run(publish, selectedIds)}
            disabled={count === 0}
            className="rounded-md bg-secondary px-3 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
          >
            공개
          </button>
          <button
            onClick={() => run(hide, selectedIds)}
            disabled={count === 0}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:bg-neutral-50 disabled:opacity-50"
          >
            비공개
          </button>
          <button
            onClick={() => {
              if (window.confirm(`선택한 ${count}개 디자인을 삭제할까요? 되돌릴 수 없어요.`)) run(del, selectedIds);
            }}
            disabled={count === 0}
            className="rounded-md bg-danger-bg px-3 py-1.5 text-caption font-semibold text-danger disabled:opacity-50"
          >
            삭제
          </button>
        </div>
      )}

      {moveOpen && !busy && (
        <div className="mt-2 flex flex-wrap gap-1.5 rounded-md bg-neutral-50 p-2">
          <button
            onClick={() => {
              setMoveOpen(false);
              run(moveTo(''), selectedIds);
            }}
            className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-caption text-primary"
          >
            미분류로
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setMoveOpen(false);
                run(moveTo(f.id), selectedIds);
              }}
              className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-caption text-primary"
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      {result && result.failed.length > 0 && (
        <div className="mt-2 rounded-md bg-danger-bg p-2">
          <p className="text-caption font-semibold text-danger">
            {result.ok.length}개 완료, {result.failed.length}개 실패
          </p>
          <button
            onClick={() => run(del.label === '삭제' ? del : del, result.failed.map((f) => f.target))}
            className="mt-1 rounded-md border border-danger/40 px-2.5 py-1 text-caption font-semibold text-danger"
          >
            실패한 것만 재시도
          </button>
        </div>
      )}
      {result && result.failed.length === 0 && result.ok.length > 0 && (
        <p className="mt-2 text-caption text-success">{result.ok.length}개 완료</p>
      )}
    </div>
  );
}
```

**주의:** 재시도 버튼은 "마지막에 실행한 작업"을 다시 돌려야 한다. 위 초안은 항상 `del`을 재시도해 잘못됐다 — 다음 스텝에서 고친다.

- [ ] **Step 2: 마지막 작업을 기억해 정확히 재시도하도록 고친다**

`const [result, setResult] = useState...` 아래에 마지막 작업 보관 상태를 추가한다:
```tsx
  const [lastJob, setLastJob] = useState<Job | null>(null);
```
`run`이 작업을 기억하게 한다(첫 줄에 추가):
```tsx
  const run = async (job: Job, ids: string[]) => {
    setLastJob(job);
    setResult(null);
    ...
```
실패 재시도 버튼의 `onClick`을 `lastJob` 기준으로 바꾼다:
```tsx
          <button
            onClick={() => lastJob && run(lastJob, result.failed.map((f) => f.target))}
            className="mt-1 rounded-md border border-danger/40 px-2.5 py-1 text-caption font-semibold text-danger"
          >
            실패한 것만 재시도
          </button>
```

- [ ] **Step 3: `FolderDesigns`에 선택 모드 상태 추가**

`src/app/dashboard/designs/_components/folder-designs.tsx` 상단 import에 추가:
```tsx
import { sortPublishedFirst } from '../_lib/sort-designs';
import { BulkActionBar } from './bulk-action-bar';
```
`const [editMode, setEditMode] = useState(false);` 아래에:
```tsx
  // 선택 모드 — "얘랑 얘 지워/옮겨"처럼 가끔 하는 정리. 수정 모드와 상호 배타(하나 켜면 다른 건 끈다).
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const clearSelection = () => setSelected(new Set());
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
```

- [ ] **Step 4: 헤더에 "선택" 버튼 추가, 수정/선택 상호 배타 처리**

`designs` 계산 아래(정렬 적용)와 폴더 목록을 준비한다. `const designs = q.data ?? [];`를 아래로 바꾼다:
```tsx
  const designs = sortPublishedFirst(q.data ?? []);
```
폴더 이동 선택지로 쓸 폴더 목록 쿼리를 추가한다(`designersQuery` 근처):
```tsx
  const foldersQuery = useQuery({ queryKey: ['design-folders'], queryFn: () => designsApi.listFolders() });
```
헤더에서 "수정 OFF/ON" 버튼 옆에 "선택" 버튼을 추가한다. 기존 수정 버튼 `onClick`을 선택 모드를 끄도록, 새 선택 버튼은 수정 모드를 끄도록 한다:
```tsx
        <button
          type="button"
          onClick={() => {
            setEditMode((v) => !v);
            setSelectMode(false);
            clearSelection();
          }}
          aria-pressed={editMode}
          className={
            editMode
              ? 'rounded-md bg-secondary px-3 py-1.5 text-caption font-semibold text-white'
              : 'rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:bg-neutral-50'
          }
        >
          {editMode ? '수정 ON' : '수정 OFF'}
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectMode((v) => !v);
            setEditMode(false);
            clearSelection();
          }}
          aria-pressed={selectMode}
          className={
            selectMode
              ? 'rounded-md bg-secondary px-3 py-1.5 text-caption font-semibold text-white'
              : 'rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:bg-neutral-50'
          }
        >
          선택
        </button>
```

- [ ] **Step 5: 선택 모드일 때 전체선택/해제 줄 + 카드에 선택 props 전달 + 액션바**

목록 렌더(`<ul className="grid grid-cols-1 gap-3">`) **위에** 전체선택 줄을 넣는다:
```tsx
      {selectMode && designs.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={() =>
              setSelected((prev) =>
                prev.size === designs.length ? new Set() : new Set(designs.map((d) => d.id)),
              )
            }
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary hover:bg-neutral-50"
          >
            {selected.size === designs.length ? '전체 해제' : '전체 선택'}
          </button>
          <span className="text-caption text-primary-50">{selected.size}개 선택됨</span>
        </div>
      )}
```
`designs.map`에서 카드에 선택 props를 넘긴다:
```tsx
          {designs.map((d) => (
            <DesignCard
              key={d.id}
              design={d}
              editMode={editMode}
              selectMode={selectMode}
              selected={selected.has(d.id)}
              onToggleSelect={() => toggleSelect(d.id)}
            />
          ))}
```
목록 컨테이너(`<div className="space-y-4">`) 맨 끝, 닫는 태그 직전에 액션바를 조건부로 붙인다:
```tsx
      {selectMode && selected.size > 0 && (
        <BulkActionBar
          selectedIds={[...selected]}
          folders={foldersQuery.data ?? []}
          onDone={refetchLists}
          onClearSelection={clearSelection}
        />
      )}
```

- [ ] **Step 6: 타입체크 · 테스트**

Run: `pnpm typecheck && pnpm test`
Expected: 타입 에러 없음, 기존/신규 테스트 전부 PASS.

- [ ] **Step 7: 화면 확인**

개발 서버에서: 폴더 진입 → "선택" → 카드 2개 체크 → 액션바에서 "비공개" → 진행률 후 반영 확인. "폴더이동" → 폴더 하나 선택 → 이동 확인. "삭제" → confirm → 삭제 확인. 공개 디자인이 목록 상단에 오는지 확인. "수정"을 누르면 선택이 풀리는지 확인.

- [ ] **Step 8: 커밋**

```bash
git add src/app/dashboard/designs/_components/bulk-action-bar.tsx src/app/dashboard/designs/_components/folder-designs.tsx
git commit -m "feat(designs): 다중선택 일괄 삭제·이동·공개·비공개 + 공개 우선 정렬 적용"
```

---

## 단계 경계 검증 (2단계 완료)

- [ ] `pnpm typecheck` — 에러 없음
- [ ] `pnpm test` — 전부 PASS
- [ ] `pnpm build` — 백그라운드로 실행하고 완료까지 대기(~10분). `EXIT 124`는 타임아웃(실패 아님)이니 재실행/대기. 성공(`Compiled successfully`) 확인.

---

## Self-Review (스펙 대조)

**스펙 커버리지 (§8 2단계):**
- 다중선택 모드(전체선택/해제) → Task 5 Step 5.
- 선택 → 삭제/폴더이동/공개/비공개 → Task 5 `BulkActionBar`.
- 폴더명 변경(`DesignFolderUpdate.name`) → Task 3.
- 공개 디자인 상단 우선 정렬 → Task 2 + Task 5 Step 4.
- 일괄 = `applyToMany` N번 루프, 동시 3, 부분실패 재시도(§6) → Task 1 + `BulkActionBar`.
- 폴더 단위 공개/비공개는 별도 버튼 없이 다중선택으로 충족(§9) → Task 5.

**타입 일관성:** `ApplyResult<T>`/`applyToMany`(Task 1) ↔ `BulkActionBar`(Task 5) 시그니처 일치. `sortPublishedFirst`(Task 2) ↔ `FolderDesigns`(Task 5) 일치. `DesignCard` 선택 props(Task 4) ↔ `FolderDesigns` 호출부(Task 5) 일치.
