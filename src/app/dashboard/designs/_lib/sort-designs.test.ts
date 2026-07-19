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
