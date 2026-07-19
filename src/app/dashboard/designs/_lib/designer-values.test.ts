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
