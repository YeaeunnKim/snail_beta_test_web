/** 디자인 카드·폼이 공유하는 순수 헬퍼. page.tsx에서 추출 — 동작 변경 없음. */
import type { Design } from '@/services';

export const MAX_DETAIL_PHOTOS = 5;
export const MAX_EDIT_PHOTOS = 6; // 수정 시 대표 1 + 상세 5

export const formatWon = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 확대 뷰에 넘길 사진 URL. 대표 사진이 먼저 오도록 정렬한다. */
export function designImageUrls(d: Design): string[] {
  const imgs = d.images ?? [];
  if (imgs.length > 0) {
    return [...imgs]
      .sort((a, b) => Number(b.is_thumbnail) - Number(a.is_thumbnail))
      .map((i) => i.original_url);
  }
  return d.thumbnail_url ? [d.thumbnail_url] : [];
}

/** 기존 사진 URL에서 object_key를 역추출(수정 폼이 재업로드 없이 기존 사진을 다루기 위함). */
export function urlToObjectKey(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/[^/]+\//, '');
  } catch {
    return url;
  }
}
