import { PageStub } from '@/components/ui/page-stub';

export default function ReservationsPage() {
  return (
    <PageStub
      title="예약 관리"
      description="상태/기간 필터로 예약을 조회하고 상태 전이 액션을 처리합니다. pending→accept/reject, payment_pending→confirm-payment, confirmed→complete/no-show/cancel."
      apis={[
        'reservationsApi.listReservations({ status, from, to, cursor, limit })',
        'reservationsApi.accept/reject/confirmPayment/complete/noShow/cancel',
      ]}
    />
  );
}
