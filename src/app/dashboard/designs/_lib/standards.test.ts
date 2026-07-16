import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByValue, tagCoverage, optionCoverage } from './standards.ts';
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

test('optionCoverage: 한 디자인 안에 같은 (kind,name)이 중복이어도 count는 1', () => {
  const designs = [
    mkOpts('a', [
      { kind: 'care', name: '케어', price_delta: 30000, duration_delta_min: 20 },
      { kind: 'care', name: '케어', price_delta: 30000, duration_delta_min: 20 },
    ]),
    mkOpts('b', []),
  ];
  const cov = optionCoverage(designs);
  const care = cov.find((c) => c.name === '케어')!;
  assert.equal(care.count, 1); // 디자인 1개 안에 2개 있어도 디자인 개수는 1
  assert.equal(care.total, 2);
  assert.equal(care.priceDelta, 30000); // 중복 인스턴스도 delta 일치 판정엔 반영됨
});

test('optionCoverage: 정렬은 count 내림차순, 동수면 name 오름차순', () => {
  const designs = [
    mkOpts('d1', [{ kind: 'extend', name: '연장', price_delta: 50000, duration_delta_min: 30 }]),
    mkOpts('d2', [{ kind: 'extend', name: '연장', price_delta: 50000, duration_delta_min: 30 }]),
    mkOpts('d3', [
      { kind: 'extend', name: '연장', price_delta: 50000, duration_delta_min: 30 },
      { kind: 'care', name: '다라', price_delta: 10000, duration_delta_min: 10 },
    ]),
    mkOpts('d4', [{ kind: 'care', name: '가나', price_delta: 20000, duration_delta_min: 15 }]),
  ];
  const cov = optionCoverage(designs);
  // 연장(count 3)이 먼저, 가나·다라(count 1 동점)는 name 오름차순
  assert.deepEqual(cov.map((c) => c.name), ['연장', '가나', '다라']);
  assert.deepEqual(cov.map((c) => c.count), [3, 1, 1]);
});
