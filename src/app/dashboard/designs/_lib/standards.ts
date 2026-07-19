/**
 * 폴더·샵 단위 "기준" 집계. 폴더에 기준값을 저장하지 않고, 폴더 안 디자인들의
 * 현재 값을 세서 최빈 무리를 기준으로 친다. 저장할 상태가 없어 어느 기기에서 열든 같은 결과다.
 */
import type { Design, DesignOptionKind } from '@/services';

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

const OPT_SEP = ' '; // (kind,name) 합성 키 구분자 — 태그·이름에 안 나오는 문자

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
