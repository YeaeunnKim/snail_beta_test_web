'use client';

/**
 * 대시보드 홈.
 *
 * 단일 요약 API가 없어 useDashboardSummary가 여러 엔드포인트를 조합한다.
 *  - 4개 지표 카드: 오늘 예약 / 신규 요청 / 미답변 리뷰 / 스네일 태그
 *  - 오늘 일정 요약(시간순)
 *  - 카드 클릭 → 해당 목록 화면으로 딥링크(필터 query 포함)
 *
 * 스네일 태그는 "내 샵을 태그한 스냅" 수를 보여주지만, 사장님용 스냅 관리 화면이
 * 아직 없어 클릭 딥링크는 비활성(관리 화면 준비 중)이다.
 */
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useMyShop } from '@/hooks/use-my-shop';
import { useDashboardSummary } from '@/hooks/use-dashboard-summary';
import { formatTime } from '@/lib/date';
import type { ReservationStatus } from '@/services';

const VERIFICATION_LABEL: Record<string, string> = {
  pending: '심사 대기 중',
  approved: '승인 완료',
  rejected: '반려됨',
};

const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: '대기',
  payment_pending: '입금대기',
  confirmed: '확정',
  rejected: '거절',
  cancelled_by_user: '고객취소',
  cancelled_by_shop: '샵취소',
  no_show: '노쇼',
  completed: '완료',
};

const STATUS_CLS: Record<ReservationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  payment_pending: 'bg-orange-100 text-orange-700',
  confirmed: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled_by_user: 'bg-neutral-100 text-neutral-500',
  cancelled_by_shop: 'bg-neutral-100 text-neutral-500',
  no_show: 'bg-red-100 text-red-700',
  completed: 'bg-blue-100 text-blue-700',
};

function fmtCount(n: number, more: boolean): string {
  return more ? `${n}+` : String(n);
}

export default function DashboardHome() {
  const { owner, verificationStatus, isApproved, needsVerification } = useAuth();
  const { data: shop, isLoading: shopLoading } = useMyShop();
  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useDashboardSummary(
    shop?.id,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">대시보드</h1>
        {shop && <p className="mt-1 text-sm text-neutral-500">{shop.name}</p>}
      </div>

      {/* 인증 상태 배너 */}
      {needsVerification && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          사업자 인증이 필요합니다 ({VERIFICATION_LABEL[verificationStatus ?? ''] ?? verificationStatus}).{' '}
          <Link href="/business-verification" className="font-semibold underline">
            인증 화면으로 이동
          </Link>
          {owner?.verification_rejected_reason && (
            <p className="mt-1">반려 사유: {owner.verification_rejected_reason}</p>
          )}
        </div>
      )}

      {/* 승인됐지만 아직 샵이 없으면 온보딩으로 유도 */}
      {isApproved && !shopLoading && shop === null && (
        <div className="rounded-md border border-brand/40 bg-brand/5 p-4 text-sm">
          <p className="font-semibold text-neutral-800">아직 등록된 샵이 없습니다.</p>
          <p className="mt-1 text-neutral-600">샵 정보를 등록하면 예약을 받을 수 있어요.</p>
          <Link
            href="/onboarding"
            className="mt-3 inline-block rounded-md bg-brand px-4 py-2 text-xs font-semibold text-white"
          >
            샵 등록 시작하기
          </Link>
        </div>
      )}

      {/* 샵이 있을 때만 요약 표시 */}
      {shop && (
        <>
          {summaryError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              요약 정보를 불러오지 못했습니다.
            </p>
          )}

          {/* 4개 지표 카드 */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="오늘 예약"
              loading={summaryLoading}
              value={summary ? fmtCount(summary.todayCount, summary.todayHasMore) : '—'}
              href={
                summary ? `/dashboard/reservations?from=${summary.today}&to=${summary.today}` : undefined
              }
            />
            <MetricCard
              label="신규 요청"
              loading={summaryLoading}
              value={summary ? fmtCount(summary.newRequestCount, summary.newRequestHasMore) : '—'}
              href="/dashboard/reservations?status=pending"
            />
            <MetricCard
              label="미답변 리뷰"
              loading={summaryLoading}
              value={summary ? String(summary.unansweredReviewCount) : '—'}
              href="/dashboard/reviews?filter=unanswered"
            />
            <MetricCard
              label="스네일 태그"
              loading={summaryLoading}
              value={summary ? fmtCount(summary.snailTagCount, summary.snailTagHasMore) : '—'}
              hint="관리 화면 준비 중"
            />
          </div>

          {/* 오늘 일정 요약 */}
          <section className="rounded-lg border border-neutral-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-700">오늘 일정</h2>
              {summary && (
                <Link
                  href={`/dashboard/reservations?from=${summary.today}&to=${summary.today}`}
                  className="text-xs text-brand underline"
                >
                  전체 보기
                </Link>
              )}
            </div>

            {summaryLoading ? (
              <p className="text-sm text-neutral-400">불러오는 중…</p>
            ) : summary && summary.todaySchedule.length > 0 ? (
              <ul className="divide-y divide-neutral-100">
                {summary.todaySchedule.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="w-12 shrink-0 font-medium text-neutral-700">
                      {formatTime(r.start_at)}
                    </span>
                    <span className="flex-1 truncate">
                      {r.design?.title ?? '시술'}
                      {r.designer?.name && (
                        <span className="text-neutral-400"> · {r.designer.name}</span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLS[r.status]}`}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-400">오늘 예약이 없습니다.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  href,
  hint,
  loading,
}: {
  label: string;
  value: string;
  href?: string;
  hint?: string;
  loading?: boolean;
}) {
  const inner = (
    <div className="h-full rounded-lg border border-neutral-200 bg-white p-4 transition group-hover:border-brand">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-neutral-900">{loading ? '…' : value}</p>
      {hint && <p className="mt-1 text-[11px] text-neutral-400">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="group block">
      {inner}
    </Link>
  ) : (
    inner
  );
}
