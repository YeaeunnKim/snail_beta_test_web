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
  expired: '만료',
  no_show: '노쇼',
  completed: '완료',
};

export const RESERVATION_STATUS_CLS: Record<ReservationStatus, string> = {
  pending: 'bg-warning-bg text-warning font-bold',
  payment_pending: 'bg-warning-bg text-warning font-bold',
  confirmed: 'bg-info-bg text-info font-bold',
  rejected: 'bg-danger-bg text-danger font-bold',
  cancelled_by_user: 'bg-primary-10 text-primary-50 font-bold',
  cancelled_by_shop: 'bg-primary-10 text-primary-50 font-bold',
  expired: 'bg-primary-10 text-primary-50 font-bold',
  no_show: 'bg-danger-bg text-danger font-bold',
  completed: 'bg-success-bg text-success font-bold',
};
