/**
 * 예약 표시용 포맷 유틸 (예약 관리 · 홈 상세에서 공용).
 */
import type { Reservation, ReservationStatus } from '@/services';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export type PayState = 'WAIT' | 'DONE' | null;

/** 결제 상태: 입금대기(WAIT) / 입금완료(DONE) / 해당없음(null) */
export function payState(r: Reservation): PayState {
  if (r.status === 'payment_pending') return 'WAIT';
  if (r.owner_payment_confirmed_at) return 'DONE';
  return null;
}

/** 상태 배지(입금대기는 '확정'으로 표시하고 결제는 별도 pill로) */
export function badgeMeta(status: ReservationStatus): { label: string; bg: string; tx: string } {
  switch (status) {
    case 'pending':
      return { label: '요청', bg: '#fff0d6', tx: '#aa7510' };
    case 'confirmed':
    case 'payment_pending':
      return { label: '확정', bg: '#e7f6ee', tx: '#1c8a5b' };
    case 'completed':
      return { label: '완료', bg: '#eceae4', tx: '#5f5d57' };
    case 'no_show':
      return { label: '노쇼', bg: '#fdeaea', tx: '#cf3b3b' };
    default:
      return { label: status === 'rejected' ? '거절' : '취소', bg: '#f3f2ee', tx: '#8f8c85' };
  }
}

/** ISO → "M.D (요일)" */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}.${d.getDate()} (${DOW[d.getDay()]})`;
}

/** ISO → "M.D HH:MM" */
export function dateTimeLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
