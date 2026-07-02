'use client';

/**
 * 대시보드 홈 요약 집계.
 *
 * 백엔드에 단일 요약 API가 없어 여러 목록 엔드포인트를 병렬 조합한다:
 *  - 오늘 예약   : GET /shops/me/reservations?from=오늘&to=오늘
 *  - 신규 요청   : GET /shops/me/reservations?status=pending
 *  - 입금 대기   : GET /shops/me/reservations?status=payment_pending
 *  - 이번 달     : GET /shops/me/reservations?from=월초&to=월말  (건수 + 정산 완료 합계)
 *  - 미답변 문의 : GET /shops/me/inquiries 중 status=pending
 *
 * 각 목록은 커서 페이지네이션이라 총개수를 주지 않는다. 홈 카드에서는 첫 페이지(limit 50)를
 * 세고, 다음 페이지가 있으면 "N+"로 표시(*HasMore). 합계도 첫 페이지 기준이다.
 */
import { useQuery } from '@tanstack/react-query';
import { inquiriesApi, reservationsApi } from '@/services';
import type { Reservation } from '@/services';
import { todayLocalDate } from '@/lib/date';

const PAGE = 50;

export interface DashboardSummary {
  today: string;
  todayCount: number;
  todayHasMore: boolean;
  /** 오늘 일정 (시작 시간순) */
  todaySchedule: Reservation[];

  /** 처리 대기(pending) 요청 목록 + 개수 */
  pendingItems: Reservation[];
  newRequestCount: number;
  newRequestHasMore: boolean;

  /** 입금 대기(payment_pending) */
  payWaitCount: number;
  payWaitHasMore: boolean;
  payWaitSum: number;

  /** 미답변 문의(pending) */
  unansweredInquiryCount: number;
  unansweredInquiryHasMore: boolean;

  /** 이번 달 */
  monthCount: number;
  monthHasMore: boolean;
  monthSettledSum: number;
}

/** YYYY-MM-DD 문자열의 그 달 1일/말일을 로컬 기준으로 계산한다. */
function monthRange(iso: string): { start: string; end: string } {
  const [y, m] = iso.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = `${y}-${pad(m)}-01`;
  const last = new Date(y, m, 0).getDate(); // m은 1-based → 다음달 0일 = 이번달 말일
  const end = `${y}-${pad(m)}-${pad(last)}`;
  return { start, end };
}

const sumPrice = (list: Reservation[]) => list.reduce((s, r) => s + (r.total_price ?? 0), 0);

export function useDashboardSummary(shopId: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', 'summary', shopId],
    enabled: !!shopId,
    queryFn: async (): Promise<DashboardSummary> => {
      const today = todayLocalDate();
      const { start, end } = monthRange(today);

      const [todayRes, pendingRes, payRes, monthRes, inquiries] = await Promise.all([
        reservationsApi.listReservations({ from: today, to: today, limit: PAGE }),
        reservationsApi.listReservations({ status: 'pending', limit: PAGE }),
        reservationsApi.listReservations({ status: 'payment_pending', limit: PAGE }),
        reservationsApi.listReservations({ from: start, to: end, limit: PAGE }),
        inquiriesApi.listMyShopInquiries({ limit: PAGE }),
      ]);

      const todaySchedule = [...todayRes.data]
        .filter((r) => !['cancelled_by_user', 'cancelled_by_shop', 'rejected'].includes(r.status))
        .sort((a, b) => a.start_at.localeCompare(b.start_at));

      const pendingItems = [...pendingRes.data].sort((a, b) =>
        (b.created_at ?? '').localeCompare(a.created_at ?? ''),
      );

      const unansweredInq = (inquiries.data ?? []).filter((i) => i.status === 'pending');

      return {
        today,
        todayCount: todayRes.data.length,
        todayHasMore: todayRes.page?.has_next ?? false,
        todaySchedule,

        pendingItems,
        newRequestCount: pendingRes.data.length,
        newRequestHasMore: pendingRes.page?.has_next ?? false,

        payWaitCount: payRes.data.length,
        payWaitHasMore: payRes.page?.has_next ?? false,
        payWaitSum: sumPrice(payRes.data),

        unansweredInquiryCount: unansweredInq.length,
        unansweredInquiryHasMore: inquiries.page?.has_next ?? false,

        monthCount: monthRes.data.length,
        monthHasMore: monthRes.page?.has_next ?? false,
        monthSettledSum: sumPrice(monthRes.data.filter((r) => r.status === 'completed')),
      };
    },
  });
}
