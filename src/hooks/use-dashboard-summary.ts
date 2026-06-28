'use client';

/**
 * 대시보드 요약 집계.
 *
 * 백엔드에 단일 요약 API(GET /owner/dashboard/summary)가 없어 여러 엔드포인트를
 * 병렬 조합한다:
 *  - 오늘 예약   : GET /shops/me/reservations?from=오늘&to=오늘
 *  - 신규 요청   : GET /shops/me/reservations?status=pending
 *  - 미답변 리뷰 : GET /shops/{id}/reviews 중 reply == null
 *  - 스네일 태그 : GET /snails?tagged_shop_id={id}
 *
 * 각 목록은 커서 페이지네이션이라 총개수를 주지 않는다. 대시보드 카드에서는
 * 첫 페이지(limit 100)를 세고, 다음 페이지가 있으면 "N+"로 표시(*HasMore).
 */
import { useQuery } from '@tanstack/react-query';
import { reservationsApi, reviewsApi, snailsApi } from '@/services';
import type { Reservation } from '@/services';
import { todayLocalDate } from '@/lib/date';

const PAGE = 100;

export interface DashboardSummary {
  todayCount: number;
  todayHasMore: boolean;
  newRequestCount: number;
  newRequestHasMore: boolean;
  unansweredReviewCount: number;
  snailTagCount: number;
  snailTagHasMore: boolean;
  /** 오늘 일정 (시작 시간순) */
  todaySchedule: Reservation[];
  today: string;
}

export function useDashboardSummary(shopId: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', 'summary', shopId],
    enabled: !!shopId,
    queryFn: async (): Promise<DashboardSummary> => {
      const today = todayLocalDate();
      const [todayRes, pendingRes, reviews, snaps] = await Promise.all([
        reservationsApi.listReservations({ from: today, to: today, limit: PAGE }),
        reservationsApi.listReservations({ status: 'pending', limit: PAGE }),
        reviewsApi.listReviewsForShop(shopId!, { limit: PAGE }),
        snailsApi.listSnails({ tagged_shop_id: shopId!, limit: PAGE }),
      ]);

      const todaySchedule = [...todayRes.data].sort((a, b) => a.start_at.localeCompare(b.start_at));

      return {
        todayCount: todayRes.data.length,
        todayHasMore: todayRes.page?.has_next ?? false,
        newRequestCount: pendingRes.data.length,
        newRequestHasMore: pendingRes.page?.has_next ?? false,
        unansweredReviewCount: reviews.filter((r) => !r.reply).length,
        snailTagCount: snaps.items.length,
        snailTagHasMore: !!snaps.next_cursor,
        todaySchedule,
        today,
      };
    },
  });
}
