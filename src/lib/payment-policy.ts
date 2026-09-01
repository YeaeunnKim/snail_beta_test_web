// 예약금 상한. 백엔드 `reservation_policy.DEPOSIT_AMOUNT_MAX` / `DEPOSIT_AMOUNT_MIN` 과
// 같은 값이어야 하며, 어긋나면 폼은 통과하는데 서버가 INVALID_PAYMENT_POLICY(400)로 막는다.
//
// ⚠️ 상한은 PG 심사에 신고한 "단건 결제기준 상품 금액 최고가"다(2026-08-31, 100,000원).
// 바꾸려면 코드가 아니라 PG사 변경 회신이 먼저다.
export const DEPOSIT_AMOUNT_MIN = 1_000;
export const DEPOSIT_AMOUNT_MAX = 100_000;

export const DEPOSIT_AMOUNT_MAX_MESSAGE = `예약금은 ${DEPOSIT_AMOUNT_MAX.toLocaleString()}원을 넘을 수 없습니다`;
