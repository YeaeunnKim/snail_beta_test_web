'use client';

/**
 * 대시보드 홈 (owner_app 목업 기준).
 *
 *  - 상단 지표 카드 4개(오늘 예약 / 신규 요청 / 입금 대기 / 미답변 문의) → 각 목록으로 딥링크
 *  - 오늘 일정 + 처리 대기 요청(수락/거절 인라인) 2단 패널
 *  - 정산 요약 바(정산 대기 / 이번 달 정산 완료 / 이번 달 예약)
 *
 * 요약 수치는 useDashboardSummary가 여러 목록 API를 조합한다(첫 페이지 기준, 초과 시 N+).
 */
import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useMyShop } from '@/hooks/use-my-shop';
import { useDashboardSummary } from '@/hooks/use-dashboard-summary';
import type { Reservation } from '@/services';
import { formatTime } from '@/lib/date';
import { TodayTimeline } from '@/components/day-timeline';
import { ReservationDetail } from '@/components/reservation-detail';

const DOT = { brand: '#c97f7f', rose: '#e4a5a5', brown: '#8b7565', sage: '#8fa07f' };

const VERIFICATION_LABEL: Record<string, string> = {
  pending: '심사 대기 중',
  approved: '승인 완료',
  rejected: '반려됨',
};

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const fmtCount = (n: number, more: boolean) => (more ? `${n}+` : String(n));

function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

export default function DashboardHome() {
  const { owner, verificationStatus, isApproved, needsVerification } = useAuth();
  const { data: shop, isLoading: shopLoading } = useMyShop();
  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useDashboardSummary(
    shop?.id,
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">대시보드</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {summary ? `${dateLabel(summary.today)} · 오늘 하루 현황이에요.` : shop?.name ?? ' '}
        </p>
      </div>

      {/* 인증 상태 배너 */}
      {needsVerification && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          사업자 인증이 필요합니다 ({VERIFICATION_LABEL[verificationStatus ?? ''] ?? verificationStatus}).{' '}
          <Link href="/dashboard/verification" className="font-semibold underline">
            인증 화면으로 이동
          </Link>
          {owner?.verification_rejected_reason && (
            <p className="mt-1">반려 사유: {owner.verification_rejected_reason}</p>
          )}
        </div>
      )}

      {/* 승인됐지만 아직 샵이 없으면 온보딩으로 유도 */}
      {isApproved && !shopLoading && shop === null && (
        <div className="rounded-lg border border-secondary/40 bg-secondary/5 p-4 text-sm">
          <p className="font-semibold text-neutral-800">아직 등록된 샵이 없습니다.</p>
          <p className="mt-1 text-neutral-600">샵 정보를 등록하면 예약을 받을 수 있어요.</p>
          <Link
            href="/onboarding"
            className="mt-3 inline-block rounded-lg bg-secondary px-4 py-2 text-xs font-semibold text-white"
          >
            샵 등록 시작하기
          </Link>
        </div>
      )}

      {shop && (
        <>
          {summaryError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              요약 정보를 불러오지 못했습니다.
            </p>
          )}

          {/* 지표 카드 */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="오늘 예약"
              dot={DOT.brand}
              loading={summaryLoading}
              value={summary ? fmtCount(summary.todayCount, summary.todayHasMore) : '—'}
              sub="일정 보기"
              href="/dashboard/timeline"
            />
            <StatCard
              label="신규 요청"
              dot={DOT.rose}
              loading={summaryLoading}
              value={summary ? fmtCount(summary.newRequestCount, summary.newRequestHasMore) : '—'}
              sub="방문 요청 처리"
              href="/dashboard/reservations?status=pending"
            />
            <StatCard
              label="입금 대기"
              dot={DOT.brown}
              loading={summaryLoading}
              value={summary ? fmtCount(summary.payWaitCount, summary.payWaitHasMore) : '—'}
              sub={summary ? `${won(summary.payWaitSum)} 정산 대기` : undefined}
              href="/dashboard/reservations?status=payment_pending"
            />
            <StatCard
              label="미답변 문의"
              dot={DOT.sage}
              loading={summaryLoading}
              value={
                summary
                  ? fmtCount(summary.unansweredInquiryCount, summary.unansweredInquiryHasMore)
                  : '—'
              }
              sub="고객 문의 답변"
              href="/dashboard/inquiries"
            />
          </div>

          {/* 오늘 일정 (디자이너 타임라인) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">오늘 일정</h2>
              <Link href="/dashboard/timeline" className="text-xs font-semibold text-secondary">
                전체 일정 →
              </Link>
            </div>
            <TodayTimeline />
          </section>

          {/* 처리 대기 요청 */}
          <section className="rounded-xl border border-primary-10 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold">처리 대기 요청</h2>
              <Link
                href="/dashboard/reservations?status=pending"
                className="text-xs font-semibold text-secondary"
              >
                모두 보기 →
              </Link>
            </div>
            {summaryLoading ? (
              <p className="text-sm text-neutral-400">불러오는 중…</p>
            ) : summary && summary.pendingItems.length > 0 ? (
              <ul className="divide-y divide-primary-10">
                {summary.pendingItems.slice(0, 6).map((r) => (
                  <PendingRow key={r.id} r={r} />
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-neutral-400">새로 들어온 요청이 없어요.</p>
            )}
          </section>

          {/* 정산 요약 */}
          {summary && (
            <div className="flex flex-wrap gap-x-10 gap-y-4 rounded-xl border border-primary-10 bg-white p-5">
              <Settle k="정산 대기" v={won(summary.payWaitSum)} color={DOT.rose} />
              <Settle k="이번 달 정산 완료" v={won(summary.monthSettledSum)} color={DOT.sage} />
              <Settle
                k="이번 달 예약"
                v={`${summary.monthCount}${summary.monthHasMore ? '+' : ''}건`}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PendingRow({ r }: { r: Reservation }) {
  const [open, setOpen] = useState(false);
  const date = new Date(r.start_at).toLocaleDateString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });

  return (
    <li className={open ? 'rounded-lg bg-[#fdf4f7]' : ''}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <b className="text-sm">{r.user?.nickname ?? '고객'}</b>
            {r.designer?.name && (
              <span className="text-xs text-neutral-400">· {r.designer.name}</span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-neutral-500">
            {date} {formatTime(r.start_at)} · {r.design?.title ?? '시술'} · {won(r.total_price)}
          </div>
          {r.user_request && (
            <div className="mt-1.5 inline-block max-w-full rounded-lg bg-secondary-50/40 px-2 py-1 text-xs text-[#a86a6a]">
              “{r.user_request}”
            </div>
          )}
        </div>
        <span
          className={`shrink-0 self-center text-xs text-neutral-300 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          ⌄
        </span>
      </button>
      {open && (
        <div className="-mx-5 mt-1 overflow-hidden">
          <ReservationDetail reservation={r} />
        </div>
      )}
    </li>
  );
}

function StatCard({
  label,
  value,
  dot,
  sub,
  href,
  loading,
}: {
  label: string;
  value: string;
  dot: string;
  sub?: string;
  href?: string;
  loading?: boolean;
}) {
  const inner = (
    <div className="h-full rounded-xl border border-primary-10 bg-white p-4 transition group-hover:border-secondary group-hover:-translate-y-0.5">
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
        {label}
      </div>
      <div className="mt-2 text-3xl font-extrabold leading-none">
        {loading ? '…' : value}
        <span className="ml-1 align-baseline text-sm font-semibold text-neutral-400">건</span>
      </div>
      {sub && <div className="mt-2 text-[11px] text-neutral-400">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="group block">
      {inner}
    </Link>
  ) : (
    <div className="group">{inner}</div>
  );
}

function Settle({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-neutral-500">{k}</span>
      <span className="text-xl font-extrabold" style={color ? { color } : undefined}>
        {v}
      </span>
    </div>
  );
}
