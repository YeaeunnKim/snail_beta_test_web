'use client';

/**
 * 알림 — 예약 요청 · 문의 · 리뷰가 들어오면 하나의 피드로 쌓인다.
 *
 * 백엔드에 통합 알림 스트림 대신 이벤트별 목록 API가 있어, 세 소스를 모아
 * 생성 시각 내림차순으로 합친다:
 *  - 요청 : GET /shops/me/reservations?status=pending  (새 방문 요청)
 *  - 문의 : GET /shops/me/inquiries                     (미답변=읽지 않음)
 *  - 리뷰 : GET /shops/{id}/reviews                     (미답변=읽지 않음)
 * "읽지 않음"은 아직 처리(수락/답변)가 필요한 항목을 뜻한다.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { inquiriesApi, reservationsApi, reviewsApi, shopApi } from '@/services';
import { toUserMessage } from '@/lib/error-messages';

type Kind = 'reservation' | 'inquiry' | 'review';

interface FeedItem {
  id: string;
  kind: Kind;
  at: string;
  title: string;
  desc: string;
  unread: boolean;
  href: string;
}

const KIND_META: Record<Kind, { label: string; icon: string; color: string }> = {
  reservation: { label: '요청', icon: '📅', color: '#e4a5a5' },
  inquiry: { label: '문의', icon: '💬', color: '#8fa07f' },
  review: { label: '리뷰', icon: '⭐', color: '#c69a76' },
};

const FILTERS: { key: 'all' | Kind; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'reservation', label: '요청' },
  { key: 'inquiry', label: '문의' },
  { key: 'review', label: '리뷰' },
];

const EMPTY: FeedItem[] = [];

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

export default function NotificationsPage() {
  const [filter, setFilter] = useState<'all' | Kind>('all');

  const shopQ = useQuery({ queryKey: ['shop', 'me'], queryFn: () => shopApi.getMyShop() });
  const shopId = shopQ.data?.id;

  const feedQ = useQuery({
    queryKey: ['activity-feed', shopId],
    enabled: !!shopId,
    queryFn: async (): Promise<FeedItem[]> => {
      const [pending, inquiries, reviews] = await Promise.all([
        reservationsApi.listReservations({ status: 'pending', limit: 50 }),
        inquiriesApi.listMyShopInquiries({ limit: 50 }),
        reviewsApi.listReviewsForShop(shopId as string, { limit: 50 }),
      ]);

      const items: FeedItem[] = [];

      for (const r of pending.data) {
        const when = new Date(r.start_at).toLocaleDateString('ko-KR', {
          month: 'numeric',
          day: 'numeric',
        });
        items.push({
          id: `res-${r.id}`,
          kind: 'reservation',
          at: r.created_at,
          title: `새 방문 요청 · ${r.user?.nickname ?? '고객'}`,
          desc: `${when} · ${r.design?.title ?? '시술'} · ${r.total_price.toLocaleString('ko-KR')}원`,
          unread: true,
          href: '/dashboard/reservations?status=pending',
        });
      }

      for (const i of inquiries.data ?? []) {
        items.push({
          id: `inq-${i.id}`,
          kind: 'inquiry',
          at: i.created_at,
          title: '새 디자인 문의',
          desc: i.body,
          unread: i.status === 'pending',
          href: '/dashboard/inquiries',
        });
      }

      for (const rv of reviews) {
        items.push({
          id: `rev-${rv.id}`,
          kind: 'review',
          at: rv.created_at,
          title: `새 리뷰 ${'★'.repeat(rv.rating)} · ${rv.author.nickname}`,
          desc: rv.body || '(사진 리뷰)',
          unread: !rv.reply,
          href: '/dashboard/reviews',
        });
      }

      return items.sort((a, b) => b.at.localeCompare(a.at));
    },
  });

  const items = feedQ.data ?? EMPTY;
  const shown = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.kind === filter)),
    [items, filter],
  );
  const unreadCount = items.filter((i) => i.unread).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">알림</h1>
        <p className="mt-1 text-sm text-neutral-500">
          예약 요청 · 문의 · 리뷰가 들어오면 여기에 쌓여요.
          {unreadCount > 0 && (
            <span className="ml-1 font-semibold text-brand">처리할 항목 {unreadCount}개</span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              filter === f.key
                ? 'border-brand bg-brand text-white'
                : 'border-neutral-300 text-neutral-600'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shopQ.isLoading || feedQ.isLoading ? (
        <p className="text-sm text-neutral-400">불러오는 중…</p>
      ) : feedQ.isError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {toUserMessage(feedQ.error)}
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          아직 새 알림이 없어요.
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((it) => {
            const meta = KIND_META[it.kind];
            return (
              <li key={it.id}>
                <Link
                  href={it.href}
                  className={`flex items-start gap-3 rounded-xl border p-4 transition hover:border-brand ${
                    it.unread ? 'border-line bg-brand-soft/10' : 'border-line bg-white'
                  }`}
                >
                  <span
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm"
                    style={{ background: `${meta.color}22` }}
                  >
                    {meta.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                        style={{ background: `${meta.color}22`, color: meta.color }}
                      >
                        {meta.label}
                      </span>
                      <b className="truncate text-sm">{it.title}</b>
                      {it.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />}
                    </div>
                    <p className="mt-1 truncate text-xs text-neutral-500">{it.desc}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-neutral-400">{relTime(it.at)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
