# 디자인 일괄 기준(3단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폴더·미분류·샵 전체 단위로 가격·소요시간·태그·추가옵션을 한 번에 맞추는 현황판을 붙인다.

**Architecture:** 스펙의 두 개념을 그대로 구현한다. (1) **값 하나짜리**(가격/소요시간/옵션 delta)는 폴더에 기준을 저장하지 않고 폴더 안 디자인들의 현재 값을 세서 최빈 무리를 기준으로 친 뒤, 미리보기에서 "값이 같던 무리"만 기본 선택해 골라 적용한다(`groupByValue` + `ApplyPreview`). (2) **목록짜리**(태그/옵션 유무)는 커버리지 현황판에서 추가/제거한다(교환법칙이 성립해 충돌이 없다). 실제 적용은 전부 2단계의 `applyToMany` N번 루프를 재사용한다. 진입점은 ⚙ 버튼 — 폴더 안 목록의 ⚙는 그 폴더/미분류, 폴더 목록 화면의 ⚙는 샵 전체(전 디자인을 `collectAll`로 모아서).

**Tech Stack:** Next.js 15.1 App Router, React 19, TypeScript 5.7 strict, TanStack Query v5, Tailwind v4. 집계는 순수 함수(`_lib/standards.ts`) + `node --test`.

**전제:** 2단계(`docs/superpowers/plans/2026-07-17-designs-phase2-list.md`)가 완료돼 `_lib/apply.ts`의 `applyToMany`/`ApplyResult`가 존재한다. 3단계는 이걸 재사용한다.

## Global Constraints

이 문단의 규칙은 **모든 태스크에 암묵적으로 포함**된다.

- **브랜치는 `feature/designs-card-inline` 하나만.** 새 브랜치 생성 금지. `main`에 커밋 금지(자동 배포).
- **PR·푸시 금지.** `git push` / `gh pr create` / `gh pr merge` 실행 금지. 다 끝나도 보고만 한다.
- **`next.config.ts` 커밋 금지.** `git add .` / `git commit -a` 금지 — 항상 파일 경로를 지정해 add.
- **의존성 추가 금지.** `package.json`의 `dependencies`/`devDependencies` 불변.
- **백엔드 계약 수정 금지.** `backend-context/`, `src/types/api.d.ts` 불변. (`src/services/types.ts`는 계약 파일이 아니라 로컬 재노출 파일이므로 타입 alias 추가는 허용된다.)
- **이미지 자동 처리 UI 복원 금지.**
- **모든 일괄 작업은 `applyToMany()`를 거친다.** 동시 3개. 중간 실패 시 롤백 없이 "N개 완료, M개 실패" + 재시도.
- **`MAX_OWNER_TAGS = 10` 준수.** 태그 전체적용 시 상한을 넘기는 디자인은 건너뛰고 건너뛴 수를 알린다.
- **폴더에 기준값을 저장하지 않는다.** localStorage·새 백엔드 필드 없이, 매번 디자인들의 현재 값에서 계산한다.
- **검증:** 태스크마다 `pnpm typecheck` + `pnpm test`. `pnpm build`는 단계 경계에서만(WSL2 빌드 ~10분, `EXIT 124`=타임아웃, 백그라운드 실행).
- **순수 함수 테스트는 `@/` 임포트를 `import type`으로만.** 런타임 임포트는 상대경로 `./x.ts`.

---

## File Structure

```
src/app/dashboard/designs/
├── _lib/
│   ├── standards.ts          groupByValue · tagCoverage · optionCoverage (순수)      ← 신규
│   └── standards.test.ts                                                            ← 신규
├── _components/
│   ├── apply-preview.tsx     값 하나짜리 미리보기 다이얼로그 (그룹 선택 후 적용)       ← 신규
│   ├── standards-panel.tsx   현황판 — 가격/시간/태그/옵션. 폴더·미분류·샵 공용         ← 신규
│   ├── folder-designs.tsx    폴더 안 목록 헤더에 ⚙(폴더/미분류 현황판)               ← 수정
│   └── folder-grid.tsx       폴더 목록 헤더에 ⚙(샵 전체 현황판, collectAll)         ← 수정
└── ../../../services/types.ts  DesignOptionKind 재노출 추가                          ← 수정
```

---

### Task 1: `groupByValue` — 최빈 무리 계산

**Files:**
- Create: `src/app/dashboard/designs/_lib/standards.ts`
- Test: `src/app/dashboard/designs/_lib/standards.test.ts`

**Interfaces:**
- Consumes: `type { Design } from '@/services'`(타입 전용).
- Produces:
  ```ts
  export interface ValueGroup<T> { value: T; designs: Design[] }
  export interface GroupResult<T> { base: ValueGroup<T> | null; groups: ValueGroup<T>[] }
  export function groupByValue<T extends string | number>(
    designs: Design[],
    pick: (d: Design) => T,
  ): GroupResult<T>;
  ```
  `groups`는 개수 내림차순. 최빈이 유일하면 `base = groups[0]`, 동점(예: 6:6)이면 `base = null`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/app/dashboard/designs/_lib/standards.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByValue } from './standards.ts';
import type { Design } from '@/services';

function mkPrice(id: string, base_price: number): Design {
  return { id, base_price } as unknown as Design;
}

test('최빈 무리가 유일하면 base가 그 무리', () => {
  const designs = [
    mkPrice('a', 50000), mkPrice('b', 50000), mkPrice('c', 50000),
    mkPrice('d', 70000), mkPrice('e', 45000),
  ];
  const r = groupByValue(designs, (d) => d.base_price);
  assert.equal(r.base?.value, 50000);
  assert.equal(r.base?.designs.length, 3);
  // 개수 내림차순
  assert.deepEqual(r.groups.map((g) => g.value), [50000, 70000, 45000]);
});

test('개수 동점이면 base는 null', () => {
  const designs = [
    mkPrice('a', 50000), mkPrice('b', 50000),
    mkPrice('c', 70000), mkPrice('d', 70000),
  ];
  const r = groupByValue(designs, (d) => d.base_price);
  assert.equal(r.base, null);
  assert.equal(r.groups.length, 2);
});

test('전부 같은 값이면 base 하나, groups 하나', () => {
  const designs = [mkPrice('a', 50000), mkPrice('b', 50000)];
  const r = groupByValue(designs, (d) => d.base_price);
  assert.equal(r.base?.value, 50000);
  assert.equal(r.groups.length, 1);
});

test('빈 목록이면 base=null, groups=[]', () => {
  const r = groupByValue([] as Design[], (d) => d.base_price);
  assert.deepEqual(r, { base: null, groups: [] });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test "src/app/dashboard/designs/_lib/standards.test.ts"`
Expected: FAIL — `Cannot find module './standards.ts'`.

- [ ] **Step 3: 최소 구현**

`src/app/dashboard/designs/_lib/standards.ts`:
```ts
/**
 * 폴더·샵 단위 "기준" 집계. 폴더에 기준값을 저장하지 않고, 폴더 안 디자인들의
 * 현재 값을 세서 최빈 무리를 기준으로 친다. 저장할 상태가 없어 어느 기기에서 열든 같은 결과다.
 */
import type { Design } from '@/services';

export interface ValueGroup<T> {
  value: T;
  designs: Design[];
}
export interface GroupResult<T> {
  base: ValueGroup<T> | null; // 최빈이 유일할 때만. 동점이면 null.
  groups: ValueGroup<T>[]; // 개수 내림차순
}

export function groupByValue<T extends string | number>(
  designs: Design[],
  pick: (d: Design) => T,
): GroupResult<T> {
  const map = new Map<T, Design[]>();
  for (const d of designs) {
    const v = pick(d);
    const arr = map.get(v);
    if (arr) arr.push(d);
    else map.set(v, [d]);
  }
  const groups = [...map.entries()]
    .map(([value, ds]) => ({ value, designs: ds }))
    .sort((a, b) => b.designs.length - a.designs.length);

  const base =
    groups.length > 0 && (groups.length === 1 || groups[0].designs.length > groups[1].designs.length)
      ? groups[0]
      : null;

  return { base, groups };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test "src/app/dashboard/designs/_lib/standards.test.ts"`
Expected: PASS — 4 tests.

- [ ] **Step 5: 커밋**

```bash
git add src/app/dashboard/designs/_lib/standards.ts src/app/dashboard/designs/_lib/standards.test.ts
git commit -m "feat(designs): 최빈 무리 집계 groupByValue"
```

---

### Task 2: `tagCoverage` · `optionCoverage` — 현황 집계

**Files:**
- Modify: `src/app/dashboard/designs/_lib/standards.ts`
- Modify: `src/app/dashboard/designs/_lib/standards.test.ts`

**Interfaces:**
- Consumes: `type { Design } from '@/services'`, `type { DesignOptionKind } from '@/services'`(타입 전용 — Task 5에서 재노출을 추가하지만, 타입 임포트는 스트리핑되므로 이 태스크에서 먼저 써도 런타임 영향이 없다. 단, `pnpm typecheck`가 통과하려면 재노출이 있어야 하니 **이 태스크 Step 1에서 재노출을 먼저 추가한다**).
- Produces:
  ```ts
  export interface TagCoverage { tag: string; count: number; total: number }
  export function tagCoverage(designs: Design[]): TagCoverage[]; // 개수 내림차순, 동수는 tag 오름차순

  export type DeltaValue = number | 'mixed';
  export interface OptionCoverage {
    kind: DesignOptionKind; name: string;
    count: number; total: number;
    priceDelta: DeltaValue; durationDelta: DeltaValue;
  }
  export function optionCoverage(designs: Design[]): OptionCoverage[]; // 개수 내림차순, 동수는 name 오름차순
  ```

- [ ] **Step 1: `DesignOptionKind` 재노출 추가**

`src/services/types.ts`의 `export type DesignOption = Schemas['DesignOptionPublic'];` 근처에 추가한다:
```ts
export type DesignOptionKind = Schemas['DesignOptionKind'];
```

- [ ] **Step 2: 실패하는 테스트를 추가한다**

`src/app/dashboard/designs/_lib/standards.test.ts` 상단 import를 확장하고 테스트를 추가한다:
```ts
import { groupByValue, tagCoverage, optionCoverage } from './standards.ts';
```
파일 하단에 추가:
```ts
function mkTags(id: string, owner_tags: string[]): Design {
  return { id, owner_tags } as unknown as Design;
}

test('tagCoverage: 태그별 개수와 total, 개수 내림차순', () => {
  const designs = [
    mkTags('a', ['젤', '프렌치']),
    mkTags('b', ['젤']),
    mkTags('c', ['젤', '여름']),
  ];
  const cov = tagCoverage(designs);
  assert.deepEqual(cov[0], { tag: '젤', count: 3, total: 3 });
  // 동수(프렌치 1, 여름 1)는 tag 오름차순
  assert.deepEqual(cov.slice(1).map((c) => c.tag), ['여름', '프렌치']);
  assert.ok(cov.every((c) => c.total === 3));
});

function mkOpts(
  id: string,
  options: { kind: string; name: string; price_delta: number; duration_delta_min: number }[],
): Design {
  return { id, options } as unknown as Design;
}

test('optionCoverage: (kind,name)별 개수 + delta 일치/mixed', () => {
  const designs = [
    mkOpts('a', [{ kind: 'extend', name: '연장', price_delta: 50000, duration_delta_min: 30 }]),
    mkOpts('b', [{ kind: 'extend', name: '연장', price_delta: 50000, duration_delta_min: 30 }]),
    mkOpts('c', [{ kind: 'extend', name: '연장', price_delta: 45000, duration_delta_min: 30 }]),
    mkOpts('d', []),
  ];
  const cov = optionCoverage(designs);
  const ext = cov.find((c) => c.name === '연장')!;
  assert.equal(ext.count, 3);
  assert.equal(ext.total, 4);
  assert.equal(ext.priceDelta, 'mixed'); // 50000·50000·45000
  assert.equal(ext.durationDelta, 30); // 전부 30
});

test('optionCoverage: 옵션 없는 목록은 빈 배열', () => {
  const cov = optionCoverage([mkOpts('a', []), mkOpts('b', [])]);
  assert.deepEqual(cov, []);
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `node --test "src/app/dashboard/designs/_lib/standards.test.ts"`
Expected: FAIL — `tagCoverage is not a function`.

- [ ] **Step 4: 구현 추가**

`src/app/dashboard/designs/_lib/standards.ts` 하단에 추가(상단 import에 `DesignOptionKind` 타입 추가):
```ts
import type { Design, DesignOptionKind } from '@/services';
```
(기존 `import type { Design } from '@/services';`를 위 줄로 교체.)

```ts
export interface TagCoverage {
  tag: string;
  count: number;
  total: number;
}

export function tagCoverage(designs: Design[]): TagCoverage[] {
  const total = designs.length;
  const counts = new Map<string, number>();
  for (const d of designs) {
    for (const tag of d.owner_tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count, total }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export type DeltaValue = number | 'mixed';

export interface OptionCoverage {
  kind: DesignOptionKind;
  name: string;
  count: number;
  total: number;
  priceDelta: DeltaValue;
  durationDelta: DeltaValue;
}

const OPT_SEP = ' '; // (kind,name) 합성 키 구분자 — 태그·이름에 안 나오는 문자

export function optionCoverage(designs: Design[]): OptionCoverage[] {
  const total = designs.length;
  const acc = new Map<
    string,
    { kind: DesignOptionKind; name: string; count: number; prices: Set<number>; durations: Set<number> }
  >();
  for (const d of designs) {
    // 한 디자인에 같은 (kind,name)이 여러 개여도 디자인 개수는 1로 센다.
    const seen = new Set<string>();
    for (const o of d.options ?? []) {
      const key = `${o.kind}${OPT_SEP}${o.name}`;
      let row = acc.get(key);
      if (!row) {
        row = { kind: o.kind, name: o.name, count: 0, prices: new Set(), durations: new Set() };
        acc.set(key, row);
      }
      row.prices.add(o.price_delta);
      row.durations.add(o.duration_delta_min);
      if (!seen.has(key)) {
        seen.add(key);
        row.count += 1;
      }
    }
  }
  const oneOrMixed = (s: Set<number>): DeltaValue => (s.size === 1 ? [...s][0] : 'mixed');
  return [...acc.values()]
    .map((r) => ({
      kind: r.kind,
      name: r.name,
      count: r.count,
      total,
      priceDelta: oneOrMixed(r.prices),
      durationDelta: oneOrMixed(r.durations),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test "src/app/dashboard/designs/_lib/standards.test.ts"`
Expected: PASS — 7 tests(Task 1의 4개 포함).

- [ ] **Step 6: 타입체크**

Run: `pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 7: 커밋**

```bash
git add src/app/dashboard/designs/_lib/standards.ts src/app/dashboard/designs/_lib/standards.test.ts src/services/types.ts
git commit -m "feat(designs): 태그·옵션 커버리지 집계 tagCoverage/optionCoverage"
```

---

### Task 3: `ApplyPreview` + `StandardsPanel` 뼈대 + 가격/소요시간 일괄

**Files:**
- Create: `src/app/dashboard/designs/_components/apply-preview.tsx`
- Create: `src/app/dashboard/designs/_components/standards-panel.tsx`

**Interfaces:**
- Consumes: `groupByValue`/`GroupResult`(Task 1), `applyToMany`/`ApplyResult`(2단계 `_lib/apply.ts`), `Stepper`/`PRICE_INPUT_STEP`/`DURATION_STEP`/`clampPrice`/`clampDuration`(design-settings), `formatWon`(design-helpers), `designsApi.updateDesign`.
- Produces:
  ```ts
  // apply-preview.tsx
  export interface PreviewCfg {
    title: string;
    unit: string;                       // '원' | '분'
    step: number;
    clamp: (n: number) => number;
    format: (n: number) => string;
    groupResult: GroupResult<number>;
    apply: (targets: Design[], value: number) => void; // 부모의 runBulk에 연결
  }
  export function ApplyPreview(props: { cfg: PreviewCfg; onClose: () => void }): JSX.Element;

  // standards-panel.tsx
  export function StandardsPanel(props: {
    scopeLabel: string;                 // "7월의 아트" | "미분류" | "샵 전체"
    designs: Design[];
    onClose: () => void;
    onDone: () => void;                 // 일괄 작업 후 쿼리 무효화
  }): JSX.Element;
  ```

- [ ] **Step 1: `ApplyPreview` 작성**

`src/app/dashboard/designs/_components/apply-preview.tsx`:
```tsx
'use client';

/**
 * 값 하나짜리(가격·소요시간·옵션 delta) 일괄 변경 미리보기.
 * groupByValue 결과를 받아 "값이 같던 무리"만 기본 체크하고, 따로 수정된 무리는 체크 해제로 둔다.
 * 동점이라 base가 없으면 전부 해제로 시작한다 — 사장님이 직접 고른다.
 */
import { useState } from 'react';
import type { Design } from '@/services';
import { Stepper } from '../design-settings';
import type { GroupResult } from '../_lib/standards';

export interface PreviewCfg {
  title: string;
  unit: string;
  step: number;
  clamp: (n: number) => number;
  format: (n: number) => string;
  groupResult: GroupResult<number>;
  apply: (targets: Design[], value: number) => void;
}

export function ApplyPreview({ cfg, onClose }: { cfg: PreviewCfg; onClose: () => void }) {
  const { base, groups } = cfg.groupResult;
  const [value, setValue] = useState<number>(base?.value ?? groups[0]?.value ?? 0);
  const [checked, setChecked] = useState<Set<number>>(() => (base ? new Set([base.value]) : new Set()));

  const toggle = (v: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  const total = groups.reduce((s, g) => s + g.designs.length, 0);
  const selected = groups.filter((g) => checked.has(g.value)).flatMap((g) => g.designs);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-heading-sm font-bold">{cfg.title}</h3>
          <button onClick={onClose} className="px-1 text-primary-50" aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="mt-3">
          <label className="text-caption text-primary-50">새 값</label>
          <Stepper value={value} step={cfg.step} suffix={cfg.unit} onChange={(v) => setValue(cfg.clamp(v))} />
        </div>

        <p className="mt-4 text-caption text-primary-50">적용 대상 {total}개 중</p>
        {!base && (
          <p className="mt-1 text-caption text-danger">기준이 갈려요 — 적용할 무리를 직접 고르세요.</p>
        )}

        <ul className="mt-2 space-y-1.5">
          {groups.map((g) => {
            const isBase = base?.value === g.value;
            return (
              <li key={g.value}>
                <label
                  className={`flex items-center gap-2 rounded-md border p-2 text-body-sm ${
                    isBase ? 'border-neutral-200' : 'border-warning/40 bg-warning-bg/40'
                  }`}
                >
                  <input type="checkbox" checked={checked.has(g.value)} onChange={() => toggle(g.value)} />
                  <span className="flex-1">
                    {isBase ? '값이 같던 ' : '따로 수정된 '}
                    {g.designs.length}개 · {cfg.format(g.value)}
                    {!isBase && ' ⚠'}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <button
          onClick={() => {
            cfg.apply(selected, value);
            onClose();
          }}
          disabled={selected.length === 0}
          className="mt-4 w-full rounded-lg bg-secondary py-2.5 font-semibold text-white disabled:opacity-50"
        >
          {selected.length}개에 적용
        </button>
      </div>
    </div>
  );
}
```

**주의:** `warning`/`warning-bg` 색이 Tailwind 설정에 없으면 `border-neutral-300 bg-neutral-50`로 대체한다(구현자가 `tailwind`/전역 css에서 확인). 존재 여부는 `grep -r "warning-bg\|--warning" src` 로 확인.

- [ ] **Step 2: `StandardsPanel` 뼈대 + runBulk + 가격/소요시간 섹션**

`src/app/dashboard/designs/_components/standards-panel.tsx`:
```tsx
'use client';

/**
 * 폴더·미분류·샵 전체 공용 현황판. 값 하나짜리(가격·소요시간)는 ApplyPreview로 골라 적용하고,
 * 목록짜리(태그·옵션)는 현황에서 추가/제거한다. 모든 실제 적용은 applyToMany N번 루프를 거친다.
 */
import { useState } from 'react';
import type { Design } from '@/services';
import { designsApi } from '@/services';
import { applyToMany, type ApplyResult } from '../_lib/apply';
import { groupByValue } from '../_lib/standards';
import { formatWon } from '../_lib/design-helpers';
import { PRICE_INPUT_STEP, DURATION_STEP, clampPrice, clampDuration } from '../design-settings';
import { ApplyPreview, type PreviewCfg } from './apply-preview';

export function StandardsPanel({
  scopeLabel,
  designs,
  onClose,
  onDone,
}: {
  scopeLabel: string;
  designs: Design[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ApplyResult<Design> | null>(null);
  const [lastFn, setLastFn] = useState<((d: Design) => Promise<void>) | null>(null);
  const [preview, setPreview] = useState<PreviewCfg | null>(null);

  // 모든 일괄 작업의 단일 통로. 진행률·결과를 한 곳에서 보여주고, 실패 시 같은 fn으로 재시도한다.
  const runBulk = async (targets: Design[], fn: (d: Design) => Promise<void>) => {
    if (targets.length === 0) return;
    setLastFn(() => fn);
    setResult(null);
    setProgress({ done: 0, total: targets.length });
    const r = await applyToMany(targets, fn, (done, total) => setProgress({ done, total }));
    setProgress(null);
    setResult(r);
    onDone();
  };

  const openPrice = () =>
    setPreview({
      title: `「${scopeLabel}」 가격 일괄 변경`,
      unit: '원',
      step: PRICE_INPUT_STEP,
      clamp: clampPrice,
      format: formatWon,
      groupResult: groupByValue(designs, (d) => d.base_price),
      apply: (targets, value) => runBulk(targets, (d) => designsApi.updateDesign(d.id, { base_price: value })),
    });

  const openDuration = () =>
    setPreview({
      title: `「${scopeLabel}」 소요시간 일괄 변경`,
      unit: '분',
      step: DURATION_STEP,
      clamp: clampDuration,
      format: (n) => `${n}분`,
      groupResult: groupByValue(designs, (d) => d.duration_minutes),
      apply: (targets, value) =>
        runBulk(targets, (d) => designsApi.updateDesign(d.id, { duration_minutes: value })),
    });

  const busy = progress !== null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-heading-md font-bold">「{scopeLabel}」 현황판</h2>
          <button onClick={onClose} className="px-1 text-primary-50" aria-label="닫기">
            ✕
          </button>
        </div>
        <p className="mt-1 text-caption text-primary-50">디자인 {designs.length}개</p>

        {/* 값 하나짜리 — 가격·소요시간 */}
        <section className="mt-4 space-y-2">
          <h3 className="text-body-sm font-semibold text-primary">기본 값 맞추기</h3>
          <div className="flex gap-2">
            <button
              onClick={openPrice}
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-caption font-semibold text-primary hover:bg-neutral-50"
            >
              가격 일괄 변경
            </button>
            <button
              onClick={openDuration}
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-caption font-semibold text-primary hover:bg-neutral-50"
            >
              소요시간 일괄 변경
            </button>
          </div>
        </section>

        {/* 태그 현황판 — Task 4에서 채운다 */}
        {/* 옵션 현황판 — Task 5에서 채운다 */}

        {/* 공용 진행/결과 푸터 */}
        {busy && (
          <p className="mt-4 text-caption text-primary-50">처리 중… {progress!.done}/{progress!.total}</p>
        )}
        {result && result.failed.length > 0 && (
          <div className="mt-4 rounded-md bg-danger-bg p-2">
            <p className="text-caption font-semibold text-danger">
              {result.ok.length}개 완료, {result.failed.length}개 실패
            </p>
            <button
              onClick={() => lastFn && runBulk(result.failed.map((f) => f.target), lastFn)}
              className="mt-1 rounded-md border border-danger/40 px-2.5 py-1 text-caption font-semibold text-danger"
            >
              실패한 것만 재시도
            </button>
          </div>
        )}
        {result && result.failed.length === 0 && result.ok.length > 0 && (
          <p className="mt-4 text-caption text-success">{result.ok.length}개 완료</p>
        )}

        {preview && <ApplyPreview cfg={preview} onClose={() => setPreview(null)} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 타입체크**

Run: `pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/app/dashboard/designs/_components/apply-preview.tsx src/app/dashboard/designs/_components/standards-panel.tsx
git commit -m "feat(designs): 현황판 뼈대 + 가격·소요시간 일괄 미리보기 적용"
```

---

### Task 4: 태그 현황판

**Files:**
- Modify: `src/app/dashboard/designs/_components/standards-panel.tsx`

**Interfaces:**
- Consumes: `tagCoverage`/`TagCoverage`(Task 2), `MAX_OWNER_TAGS`(design-settings), `runBulk`(Task 3), `designsApi.updateDesign`.
- Produces: 없음(패널 내부 섹션).

**규칙:** 태그 추가/제거는 디자인마다 `owner_tags` 배열 **전체**를 다시 보낸다(부분 추가 API 없음). 전체적용 시 이미 그 태그가 있거나 `MAX_OWNER_TAGS`에 도달한 디자인은 건너뛴다.

- [ ] **Step 1: import 확장 + 헬퍼**

`standards-panel.tsx` import에 추가:
```tsx
import { tagCoverage } from '../_lib/standards';
import { MAX_OWNER_TAGS } from '../design-settings';
```
`StandardsPanel` 본문 `const busy = ...` 위에 태그 상태와 동작을 추가한다:
```tsx
  const [newTag, setNewTag] = useState('');
  const tags = tagCoverage(designs);

  // 전체적용: 그 태그가 없고 상한 미만인 디자인에만 추가한다. 건너뛴 수를 알린다.
  const addTagToAll = (tag: string) => {
    const t = tag.trim();
    if (!t) return;
    const targets = designs.filter((d) => !d.owner_tags.includes(t) && d.owner_tags.length < MAX_OWNER_TAGS);
    const skipped = designs.filter((d) => !d.owner_tags.includes(t) && d.owner_tags.length >= MAX_OWNER_TAGS).length;
    if (skipped > 0) {
      // 상한 초과분은 건너뜀 — 조용히 넘기지 않고 알린다.
      window.alert(`${skipped}개는 태그가 꽉 차서(최대 ${MAX_OWNER_TAGS}개) 건너뜁니다.`);
    }
    runBulk(targets, (d) => designsApi.updateDesign(d.id, { owner_tags: [...d.owner_tags, t] }));
  };

  const removeTagFromAll = (tag: string) => {
    const targets = designs.filter((d) => d.owner_tags.includes(tag));
    runBulk(targets, (d) =>
      designsApi.updateDesign(d.id, { owner_tags: d.owner_tags.filter((x) => x !== tag) }),
    );
  };
```

- [ ] **Step 2: 태그 현황판 섹션 렌더**

`{/* 태그 현황판 — Task 4에서 채운다 */}` 주석을 아래로 교체한다:
```tsx
        <section className="mt-5 space-y-2">
          <h3 className="text-body-sm font-semibold text-primary">태그 현황 (디자인 {designs.length}개)</h3>
          <ul className="space-y-1">
            {tags.map((t) => {
              const all = t.count === t.total;
              return (
                <li key={t.tag} className="flex items-center gap-2 text-body-sm">
                  <span className="flex-1 truncate">
                    #{t.tag}{' '}
                    <span className="tabular-nums text-primary-50">
                      {t.count}/{t.total} {all ? '전체' : '일부 ⚠'}
                    </span>
                  </span>
                  {!all && (
                    <button
                      onClick={() => addTagToAll(t.tag)}
                      disabled={busy}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-caption text-primary hover:bg-neutral-50 disabled:opacity-50"
                    >
                      전체적용
                    </button>
                  )}
                  <button
                    onClick={() => removeTagFromAll(t.tag)}
                    disabled={busy}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-caption text-danger/80 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    빼기
                  </button>
                </li>
              );
            })}
            {tags.length === 0 && <li className="text-caption text-primary-50">아직 태그가 없어요.</li>}
          </ul>
          <div className="flex items-center gap-2">
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTag.trim()) {
                  addTagToAll(newTag);
                  setNewTag('');
                }
              }}
              placeholder="새 태그"
              className="flex-1 rounded-md border border-neutral-300 px-2.5 py-1.5 text-body-sm outline-none focus:border-secondary"
            />
            <button
              onClick={() => {
                if (newTag.trim()) {
                  addTagToAll(newTag);
                  setNewTag('');
                }
              }}
              disabled={busy || !newTag.trim()}
              className="rounded-md bg-secondary px-3 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
            >
              전체 추가
            </button>
          </div>
          <p className="text-caption text-primary-50">※ 각 디자인의 다른 태그는 그대로 유지돼요.</p>
        </section>
```

- [ ] **Step 3: 타입체크**

Run: `pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/app/dashboard/designs/_components/standards-panel.tsx
git commit -m "feat(designs): 현황판 태그 추가/제거"
```

---

### Task 5: 추가옵션 현황판

**Files:**
- Modify: `src/app/dashboard/designs/_components/standards-panel.tsx`

**Interfaces:**
- Consumes: `optionCoverage`/`OptionCoverage`(Task 2), `groupByValue`(Task 1), `ApplyPreview`(Task 3), `DesignOption`/`DesignOptionKind`(services), `designsApi.createOption`/`deleteOption`/`updateOption`.
- Produces: 없음(패널 내부 섹션).

**규칙:** 옵션 추가는 디자인마다 `POST /options` 1회, 제거는 `DELETE /options/{id}` 1회(옵션 id는 각 디자인의 `options`에서 `kind+name`으로 찾는다). 옵션의 값(가격/시간)은 다시 "값 하나짜리" — `[가격 맞추기]`/`[시간 맞추기]`가 `ApplyPreview`를 연다.

- [ ] **Step 1: import·타입·헬퍼 추가**

`standards-panel.tsx` import 확장:
```tsx
import type { Design, DesignOption, DesignOptionKind } from '@/services';
import { optionCoverage } from '../_lib/standards';
```
(기존 `import type { Design } from '@/services';`와 통합.)

`StandardsPanel` 본문에 옵션 매칭 헬퍼와 상태를 추가한다(태그 상태 근처):
```tsx
  const options = optionCoverage(designs);
  const KIND_LABEL: Record<DesignOptionKind, string> = { extend: '연장', removal: '제거', care: '케어' };

  const matchOption = (d: Design, kind: DesignOptionKind, name: string): DesignOption | undefined =>
    (d.options ?? []).find((o) => o.kind === kind && o.name === name);

  // 새 옵션 입력 폼 상태
  const [optKind, setOptKind] = useState<DesignOptionKind>('extend');
  const [optName, setOptName] = useState('');
  const [optPrice, setOptPrice] = useState(0);
  const [optDur, setOptDur] = useState(0);

  const addOptionToAll = (
    kind: DesignOptionKind,
    name: string,
    price_delta: number,
    duration_delta_min: number,
  ) => {
    const n = name.trim();
    if (!n) return;
    const targets = designs.filter((d) => !matchOption(d, kind, n));
    runBulk(targets, (d) => designsApi.createOption(d.id, { kind, name: n, price_delta, duration_delta_min }));
  };

  const removeOptionFromAll = (kind: DesignOptionKind, name: string) => {
    const targets = designs.filter((d) => matchOption(d, kind, name));
    runBulk(targets, async (d) => {
      const opt = matchOption(d, kind, name);
      if (opt) await designsApi.deleteOption(d.id, opt.id);
    });
  };

  const openOptionValue = (kind: DesignOptionKind, name: string, field: 'price' | 'duration') => {
    const withOpt = designs.filter((d) => matchOption(d, kind, name));
    const pick = (d: Design) =>
      field === 'price' ? matchOption(d, kind, name)!.price_delta : matchOption(d, kind, name)!.duration_delta_min;
    setPreview({
      title: `${KIND_LABEL[kind]} · ${name} ${field === 'price' ? '가격' : '시간'} 맞추기`,
      unit: field === 'price' ? '원' : '분',
      step: field === 'price' ? PRICE_INPUT_STEP : DURATION_STEP,
      clamp: (v) => Math.max(0, Math.round(v)),
      format: field === 'price' ? formatWon : (n) => `${n}분`,
      groupResult: groupByValue(withOpt, pick),
      apply: (targets, value) =>
        runBulk(targets, async (d) => {
          const opt = matchOption(d, kind, name);
          if (opt) {
            await designsApi.updateOption(d.id, opt.id, field === 'price' ? { price_delta: value } : { duration_delta_min: value });
          }
        }),
    });
  };
```

- [ ] **Step 2: 옵션 현황판 섹션 렌더**

`{/* 옵션 현황판 — Task 5에서 채운다 */}` 주석을 아래로 교체한다:
```tsx
        <section className="mt-5 space-y-2">
          <h3 className="text-body-sm font-semibold text-primary">추가옵션 현황</h3>
          <ul className="space-y-1">
            {options.map((o) => {
              const all = o.count === o.total;
              const priceText = o.priceDelta === 'mixed' ? '값 제각각 ⚠' : formatWon(o.priceDelta);
              const durText = o.durationDelta === 'mixed' ? '시간 제각각 ⚠' : `${o.durationDelta}분`;
              return (
                <li key={`${o.kind}-${o.name}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                  <span className="flex-1 truncate">
                    {KIND_LABEL[o.kind]} · {o.name}{' '}
                    <span className="tabular-nums text-primary-50">
                      {o.count}/{o.total} · {priceText} · {durText}
                    </span>
                  </span>
                  <button
                    onClick={() => openOptionValue(o.kind, o.name, 'price')}
                    disabled={busy}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-caption text-primary hover:bg-neutral-50 disabled:opacity-50"
                  >
                    가격 맞추기
                  </button>
                  <button
                    onClick={() => openOptionValue(o.kind, o.name, 'duration')}
                    disabled={busy}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-caption text-primary hover:bg-neutral-50 disabled:opacity-50"
                  >
                    시간 맞추기
                  </button>
                  {!all && (
                    <button
                      onClick={() =>
                        addOptionToAll(
                          o.kind,
                          o.name,
                          o.priceDelta === 'mixed' ? 0 : o.priceDelta,
                          o.durationDelta === 'mixed' ? 0 : o.durationDelta,
                        )
                      }
                      disabled={busy}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-caption text-primary hover:bg-neutral-50 disabled:opacity-50"
                    >
                      전체적용
                    </button>
                  )}
                  <button
                    onClick={() => removeOptionFromAll(o.kind, o.name)}
                    disabled={busy}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-caption text-danger/80 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    빼기
                  </button>
                </li>
              );
            })}
            {options.length === 0 && <li className="text-caption text-primary-50">아직 옵션이 없어요.</li>}
          </ul>

          {/* 새 옵션 추가 */}
          <div className="space-y-1.5 rounded-md bg-neutral-50 p-2">
            <div className="flex gap-1.5">
              <select
                value={optKind}
                onChange={(e) => setOptKind(e.target.value as DesignOptionKind)}
                className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-caption outline-none focus:border-secondary"
              >
                <option value="extend">연장</option>
                <option value="removal">제거</option>
                <option value="care">케어</option>
              </select>
              <input
                value={optName}
                onChange={(e) => setOptName(e.target.value)}
                placeholder="옵션 이름"
                className="flex-1 rounded-md border border-neutral-300 px-2.5 py-1.5 text-body-sm outline-none focus:border-secondary"
              />
            </div>
            <div className="flex items-center gap-1.5 text-caption">
              <input
                type="number"
                value={optPrice}
                onChange={(e) => setOptPrice(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                className="w-24 rounded-md border border-neutral-300 px-2 py-1.5 outline-none focus:border-secondary"
              />
              <span className="text-primary-50">원</span>
              <input
                type="number"
                value={optDur}
                onChange={(e) => setOptDur(Math.max(0, Math.round(Number(e.target.value) || 0)))}
                className="w-20 rounded-md border border-neutral-300 px-2 py-1.5 outline-none focus:border-secondary"
              />
              <span className="text-primary-50">분</span>
              <button
                onClick={() => {
                  if (optName.trim()) {
                    addOptionToAll(optKind, optName, optPrice, optDur);
                    setOptName('');
                    setOptPrice(0);
                    setOptDur(0);
                  }
                }}
                disabled={busy || !optName.trim()}
                className="ml-auto rounded-md bg-secondary px-3 py-1.5 font-semibold text-white disabled:opacity-50"
              >
                전체 추가
              </button>
            </div>
          </div>
        </section>
```

- [ ] **Step 3: 타입체크**

Run: `pnpm typecheck`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/app/dashboard/designs/_components/standards-panel.tsx
git commit -m "feat(designs): 현황판 추가옵션 추가/제거/값맞추기"
```

---

### Task 6: ⚙ 진입점 연결 (폴더·미분류·샵 전체)

**Files:**
- Modify: `src/app/dashboard/designs/_components/folder-designs.tsx`
- Modify: `src/app/dashboard/designs/_components/folder-grid.tsx`

**Interfaces:**
- Consumes: `StandardsPanel`(Task 3~5), `collectAll`(`@/lib/api-client`), `designsApi.listDesigns`.
- Produces: 없음.

- [ ] **Step 1: 폴더 안 목록 헤더에 ⚙ 추가 (폴더/미분류 현황판)**

`folder-designs.tsx` import에 추가:
```tsx
import { StandardsPanel } from './standards-panel';
```
상태 추가(`const [selectMode, ...]` 근처):
```tsx
  const [standardsOpen, setStandardsOpen] = useState(false);
```
헤더의 "선택" 버튼 옆에 ⚙ 버튼을 추가한다:
```tsx
        <button
          type="button"
          onClick={() => setStandardsOpen(true)}
          aria-label="현황판"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:bg-neutral-50"
        >
          ⚙ 기준
        </button>
```
컨테이너(`<div className="space-y-4">`) 끝(액션바 조건부 렌더 아래)에 패널을 붙인다. `designs`는 이미 로드돼 있어(이 폴더/미분류 전체를 `collectAll`로 가져온 값) 그대로 넘긴다:
```tsx
      {standardsOpen && (
        <StandardsPanel
          scopeLabel={view.label}
          designs={designs}
          onClose={() => setStandardsOpen(false)}
          onDone={refetchLists}
        />
      )}
```

- [ ] **Step 2: 타입체크 · 화면 확인 (폴더/미분류)**

Run: `pnpm typecheck`
Expected: 에러 없음.
개발 서버: 폴더 진입 → "⚙ 기준" → 현황판에서 가격 일괄 변경(미리보기 → 9개에 적용) 확인, 태그 전체 추가 확인, 옵션 전체 추가/빼기 확인. 미분류 폴더에서도 ⚙가 뜨고 동작하는지 확인.

- [ ] **Step 3: 커밋 (폴더/미분류 진입점)**

```bash
git add src/app/dashboard/designs/_components/folder-designs.tsx
git commit -m "feat(designs): 폴더·미분류 현황판 진입(⚙ 기준)"
```

- [ ] **Step 4: 폴더 목록 화면에 샵 전체 ⚙ 추가**

`folder-grid.tsx`는 지금 `FolderGrid`가 폴더 카드만 그린다. 샵 전체 현황판은 전 디자인을 모아야 하므로 별도 진입 버튼 + 로딩을 둔다. `FolderGrid` 상단에 import 추가:
```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { collectAll } from '@/lib/api-client';
import type { Design } from '@/services';
import { StandardsPanel } from './standards-panel';
```
(기존 `import { useState } from 'react';`가 이미 있으면 중복 추가하지 말고 `useQuery` 등만 합친다.)

`FolderGrid` 함수 본문 시작에 샵 전체 현황판 상태·쿼리를 추가한다:
```tsx
  const qc = useQueryClient();
  const [shopBoardOpen, setShopBoardOpen] = useState(false);
  // 샵 전체 최빈값을 세려면 전 디자인이 필요하다(폴더 필터 없이 collectAll). 패널을 열 때만 조회한다.
  const allDesigns = useQuery({
    queryKey: ['designs', 'all'],
    queryFn: () => collectAll<Design>((cursor) => designsApi.listDesigns({ limit: 50, cursor })),
    enabled: shopBoardOpen,
  });
```
(`useQueryClient`가 없으면 import에 추가: `import { useQuery, useQueryClient } from '@tanstack/react-query';`. `designsApi`는 이미 import돼 있다.)

`FolderGrid`가 반환하는 최상위 `<div className="grid grid-cols-2 gap-3">`를 조각(`<>…</>`)으로 감싸고, 그 위에 샵 전체 버튼을, 아래에 패널을 붙인다:
```tsx
  return (
    <>
      <div className="mb-3 flex justify-end">
        <button
          onClick={() => setShopBoardOpen(true)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:bg-neutral-50"
        >
          ⚙ 샵 전체 기준
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {/* 기존 내용 그대로 */}
      </div>
      {shopBoardOpen &&
        (allDesigns.isLoading ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
            <p className="rounded-lg bg-white px-4 py-3 text-body-sm text-primary">전 디자인 불러오는 중…</p>
          </div>
        ) : (
          <StandardsPanel
            scopeLabel="샵 전체"
            designs={allDesigns.data ?? []}
            onClose={() => setShopBoardOpen(false)}
            onDone={() => {
              qc.invalidateQueries({ queryKey: ['designs'] });
              qc.invalidateQueries({ queryKey: ['design-folders'] });
              allDesigns.refetch();
            }}
          />
        ))}
    </>
  );
```

- [ ] **Step 5: 타입체크 · 테스트**

Run: `pnpm typecheck && pnpm test`
Expected: 타입 에러 없음, 전체 테스트 PASS.

- [ ] **Step 6: 화면 확인 (샵 전체)**

개발 서버: 폴더 목록 화면 → "⚙ 샵 전체 기준" → "전 디자인 불러오는 중…" 후 현황판 → 샵 전체 태그/가격 일괄 동작 확인.

- [ ] **Step 7: 커밋 (샵 전체 진입점)**

```bash
git add src/app/dashboard/designs/_components/folder-grid.tsx
git commit -m "feat(designs): 샵 전체 현황판 진입(collectAll)"
```

---

## 단계 경계 검증 (3단계 완료)

- [ ] `pnpm typecheck` — 에러 없음
- [ ] `pnpm test` — 전부 PASS
- [ ] `pnpm build` — 백그라운드 실행 후 완료까지 대기(~10분). `EXIT 124`는 타임아웃이니 재실행/대기. `Compiled successfully` 확인.

---

## Self-Review (스펙 대조)

**스펙 커버리지:**
- §3.1 값 하나짜리 미리보기(최빈 base 체크, 따로 수정 무리 해제, 동점 시 전부 해제) → Task 1 `groupByValue` + Task 3 `ApplyPreview`.
- §3.2 목록짜리 현황판 추가/제거, `MAX_OWNER_TAGS` 상한 건너뛰기 → Task 4(태그), Task 5(옵션). 옵션 값은 다시 값 하나짜리(`[가격/시간 맞추기]`) → Task 5.
- §4 진입점: 폴더 목록 ⚙=샵 전체, 폴더 안 ⚙=그 폴더, 미분류도 현황판 → Task 6.
- §6 일괄 = `applyToMany` N번 루프 + 진행률 + 부분실패 재시도 → Task 3 `runBulk`(태그·옵션·미리보기 공용 통로).
- §7 파일 구조(`_lib/standards.ts`, `apply-preview.tsx`, `standards-panel.tsx`) → 그대로.
- §9 샵 전체 현황판은 `collectAll`로 전 디자인 로드 + 로딩 표시 → Task 6 Step 4.

**타입 일관성:** `GroupResult<number>`(Task 1) ↔ `PreviewCfg.groupResult`(Task 3) 일치. `ApplyResult<Design>`(2단계) ↔ `runBulk`(Task 3) 일치. `DesignOptionKind` 재노출(Task 2 Step 1) ↔ Task 5 사용 일치. `optionCoverage`의 `DeltaValue`(Task 2) ↔ Task 5 렌더(`=== 'mixed'`) 일치.

**미해결 가정(구현자 확인):** 목록 응답(`listDesigns`)이 각 `DesignMe`에 `options`/`designers`/`owner_tags`를 실제로 채워 보내는지. 스키마상 옵셔널이지만 카드의 디자이너 범위 표시가 이미 목록의 `designers`에 의존해 동작하므로 채워진다고 본다. Task 6 화면 확인에서 옵션 현황이 실제 값으로 뜨는지 반드시 눈으로 검증한다. 비어 보이면 백엔드가 목록에 `options`를 안 싣는 것이므로, `StandardsPanel` 진입 시 디자인별 `listOptions`를 `collectAll` 후 병합하는 방식으로 조정한다(별도 보고).
