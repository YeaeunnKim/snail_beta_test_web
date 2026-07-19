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
