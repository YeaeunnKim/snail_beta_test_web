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
