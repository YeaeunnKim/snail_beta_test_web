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
