/**
 * 샵 지역(지명) 선택지 — 온보딩/샵 정보수정에서 공통으로 사용한다.
 *
 * 자유 입력을 막고 이 목록에서만 고르게 한다(드롭다운). 순서는 지정된 순서 그대로.
 * 백엔드 `region`은 자유 문자열이라, 여기 라벨을 그대로 값으로 전송한다.
 */
export const SHOP_REGIONS = [
  '강남',
  '건대',
  '명동',
  '성수',
  '신림',
  '압구정',
  '이태원',
  '잠실',
  '홍대',
  '보문',
  '안암',
] as const;

export type ShopRegion = (typeof SHOP_REGIONS)[number];

/** 저장된 region 값이 선택지에 있는 값인지 (구버전 자유입력 데이터 방어용) */
export function isKnownRegion(value: string | null | undefined): value is ShopRegion {
  return !!value && (SHOP_REGIONS as readonly string[]).includes(value);
}
