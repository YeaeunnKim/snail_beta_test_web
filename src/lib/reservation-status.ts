/**
 * 예약 상태 표시(라벨·배지 색)와 상태 전이 가능 액션.
 *
 * 전이: pending → accept/reject, payment_pending → confirm-payment,
 *       confirmed → complete/no-show/cancel. 그 외는 종료 상태(읽기 전용).
 */
import type { ReservationStatus } from '@/services';

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: '대기',
  payment_pending: '입금대기',
  confirmed: '확정',
  rejected: '거절',
  cancelled_by_user: '고객취소',
  cancelled_by_shop: '샵취소',
  no_show: '노쇼',
  completed: '완료',
};

export const RESERVATION_STATUS_CLS: Record<ReservationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  payment_pending: 'bg-orange-100 text-orange-700',
  confirmed: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled_by_user: 'bg-neutral-100 text-neutral-500',
  cancelled_by_shop: 'bg-neutral-100 text-neutral-500',
  no_show: 'bg-red-100 text-red-700',
  completed: 'bg-blue-100 text-blue-700',
};
