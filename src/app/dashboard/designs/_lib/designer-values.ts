/**
 * 디자인의 디자이너별 가격·소요시간 범위 계산.
 *
 * 백엔드는 디자이너별 override를 "기본값과 다른 것만" 저장하므로,
 * design.designers[].base_price 는 그 디자이너의 실효 가격이다.
 * 기본값(design.base_price)도 범위에 포함시킨다 — 디자이너 전원이 기본값과
 * 다른 같은 값을 가진 경우에도 "기본과 다르다"는 사실이 카드에 드러나야 하기 때문.
 */
import type { Design } from '@/services';

export interface ValueRange {
  min: number;
  max: number;
  uniform: boolean; // true면 카드에 단일 값, false면 "min~max ▾"
}

function rangeOf(values: number[]): ValueRange {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, uniform: min === max };
}

export function priceRange(d: Design): ValueRange {
  return rangeOf([d.base_price, ...(d.designers ?? []).map((x) => x.base_price)]);
}

export function durationRange(d: Design): ValueRange {
  return rangeOf([d.duration_minutes, ...(d.designers ?? []).map((x) => x.duration_minutes)]);
}
