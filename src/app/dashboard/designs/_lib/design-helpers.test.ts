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
