/**
 * 예약 운영 API. 목록 조회 + 상태 전이 액션.
 *
 * 상태 전이:
 *  - pending         → accept / reject
 *  - payment_pending → confirm-payment
 *  - confirmed       → complete / no-show / cancel
 *  - terminal(rejected, cancelled_by_user, cancelled_by_shop, no_show, completed)는 읽기 전용
 */
import { apiClient } from '@/lib/api-client';
import type { ReservationStatus } from './types';

export interface ReservationListQuery {
  status?: ReservationStatus;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  cursor?: string;
  limit?: number;
}

/** 샵 예약 목록 (상태/기간/커서 필터) */
export async function listReservations(query?: ReservationListQuery) {
  return apiClient.get('/api/v1/shops/me/reservations', { query });
}

/** 예약 상세 */
export async function getReservation(reservationId: string) {
  return apiClient.get('/api/v1/shops/me/reservations/{reservation_id}', {
    params: { reservation_id: reservationId },
  });
}

/** 예약 승인 (pending → ...). ownerReply를 주면 고객 문의에 대한 답변으로 함께 저장된다. */
export async function accept(reservationId: string, ownerReply?: string) {
  return apiClient.post('/api/v1/shops/me/reservations/{reservation_id}/accept', {
    params: { reservation_id: reservationId },
    body: ownerReply ? { owner_reply: ownerReply } : undefined,
  });
}

/** 예약 거절 (reject_reason 필수) */
export async function reject(reservationId: string, rejectReason: string) {
  return apiClient.post('/api/v1/shops/me/reservations/{reservation_id}/reject', {
    params: { reservation_id: reservationId },
    body: { reject_reason: rejectReason },
  });
}

/** 결제 확인 (payment_pending → confirmed) */
export async function confirmPayment(reservationId: string) {
  return apiClient.post('/api/v1/shops/me/reservations/{reservation_id}/confirm-payment', {
    params: { reservation_id: reservationId },
  });
}

/** 방문 완료 처리 (confirmed → completed) */
export async function complete(reservationId: string) {
  return apiClient.post('/api/v1/shops/me/reservations/{reservation_id}/complete', {
    params: { reservation_id: reservationId },
  });
}

/** 노쇼 처리 (예약 시작 30분 후부터 가능) */
export async function noShow(reservationId: string) {
  return apiClient.post('/api/v1/shops/me/reservations/{reservation_id}/no-show', {
    params: { reservation_id: reservationId },
  });
}

/** 샵에 의한 예약 취소 (cancel_reason 필수) */
export async function cancel(reservationId: string, cancelReason: string) {
  return apiClient.post('/api/v1/shops/me/reservations/{reservation_id}/cancel', {
    params: { reservation_id: reservationId },
    body: { cancel_reason: cancelReason },
  });
}
