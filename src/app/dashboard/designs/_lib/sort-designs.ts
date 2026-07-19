/**
 * 공개(visibility === 'active') 디자인을 목록 상단으로 올린다.
 * 두 무리 각각의 상대 순서는 원본 그대로 유지한다(filter는 순서를 보존하므로 안정적이다).
 */
import type { Design } from '@/services';

export function sortPublishedFirst(designs: Design[]): Design[] {
  return [
    ...designs.filter((d) => d.visibility === 'active'),
    ...designs.filter((d) => d.visibility !== 'active'),
  ];
}
