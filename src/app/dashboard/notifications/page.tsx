'use client';

/**
 * 알림 — 예약 요청/방문 관리 (모바일).
 *
 * 세그먼트 3개:
 *  - 요청     : pending(수락/거절) · payment_pending(입금 확인만 — 취소는 409라 버튼 없음)
 *  - 방문 예정 : confirmed(방문 완료/노쇼/취소) — 방문 임박 순
 *  - 방문 완료 : completed(읽기 전용) — 최근 순
 *
 * 거절/취소는 사유가 필수라 카드에서 사유 입력 후 확정한다.
 * 상태를 바꾸면 ['reservations'] 쿼리를 무효화해 일정 탭의 예약 잠금도 함께 갱신된다.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { designsApi, reservationsApi } from '@/services';
import type { Reservation } from '@/services';
import { formatTime } from '@/lib/date';
import { badgeMeta, dayLabel, won } from '@/lib/reservation-format';
import { toUserMessage } from '@/lib/error-messages';
import { ReservationDetail } from '@/components/reservation-detail';

type Seg = 'requests' | 'upcoming' | 'done';

const SEGMENTS: { key: Seg; label: string }[] = [
  { key: 'requests', label: '요청' },
  { key: 'upcoming', label: '방문 예정' },
  { key: 'done', label: '방문 완료' },
];

function segOf(r: Reservation): Seg | null {
  if (r.status === 'pending' || r.status === 'payment_pending') return 'requests';
  if (r.status === 'confirmed') return 'upcoming';
  if (r.status === 'completed') return 'done';
  return null; // rejected / cancelled_* / no_show
}

const RESERVATIONS_MAX_PAGES = 50; // limit 50 * 50페이지 = 최대 2500건

/**
 * 예약 이력을 커서로 끝까지 모으되 상한(2500건)을 둔다. 상한에 닿았는데 다음 페이지가
 * 남아있으면(truncated) 화면에서 "일부 오래된 이력은 표시되지 않을 수 있어요" 경고를 띄운다.
 */
async function collectReservationsBounded(): Promise<{ data: Reservation[]; truncated: boolean }> {
  const all: Reservation[] = [];
  let cursor: string | undefined;
  let truncated = false;
  for (let i = 0; i < RESERVATIONS_MAX_PAGES; i += 1) {
    const { data, page } = await reservationsApi.listReservations({ cursor, limit: 50 });
    all.push(...data);
    const next = page?.next_cursor;
    const hasMore = !!next && page?.has_next !== false;
    if (!hasMore) break;
    cursor = next;
    if (i === RESERVATIONS_MAX_PAGES - 1) truncated = true;
  }
  return { data: all, truncated };
}

export default function NotificationsPage() {
  const [seg, setSeg] = useState<Seg>('requests');

  const reservationsQuery = useQuery({
    queryKey: ['reservations', 'notifications'],
    queryFn: collectReservationsBounded,
  });
  const all = useMemo(() => reservationsQuery.data?.data ?? [], [reservationsQuery.data]);
  const truncated = reservationsQuery.data?.truncated ?? false;

  const counts = useMemo(() => {
    const c: Record<Seg, number> = { requests: 0, upcoming: 0, done: 0 };
    for (const r of all) {
      const s = segOf(r);
      if (s) c[s] += 1;
    }
    return c;
  }, [all]);

  const list = useMemo(() => {
    const rows = all.filter((r) => segOf(r) === seg);
    rows.sort((a, b) =>
      seg === 'requests'
        ? b.created_at.localeCompare(a.created_at) // 최근 요청 먼저
        : seg === 'upcoming'
          ? a.start_at.localeCompare(b.start_at) // 방문 임박 순
          : b.start_at.localeCompare(a.start_at), // 최근 완료 먼저
    );
    return rows;
  }, [all, seg]);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-heading-lg font-bold text-primary">알림</h1>
        <p className="mt-1 text-body-sm text-primary-50">들어온 예약을 수락하고 방문을 관리하세요.</p>
      </div>

      {/* 세그먼트 */}
      <div className="flex gap-1 rounded-xl bg-neutral-100 p-1">
        {SEGMENTS.map((s) => {
          const on = seg === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setSeg(s.key)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-caption font-semibold ${
                on ? 'bg-white text-primary shadow-sm' : 'text-primary-50'
              }`}
            >
              {s.label}
              {counts[s.key] > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-caption font-bold ${
                    s.key === 'requests' ? 'bg-secondary text-white' : 'bg-neutral-200 text-primary'
                  }`}
                >
                  {counts[s.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {truncated && (
        <p className="rounded-md bg-warning-bg px-3 py-2 text-caption text-warning">
          이력이 많아 일부 오래된 예약은 표시되지 않을 수 있어요.
        </p>
      )}

      {/* 목록 */}
      {reservationsQuery.isLoading ? (
        <p className="py-10 text-center text-body-sm text-primary-50">불러오는 중…</p>
      ) : reservationsQuery.isError ? (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">
          {toUserMessage(reservationsQuery.error)}
        </p>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 p-12 text-center text-body-sm text-primary-50">
          {seg === 'requests' ? '새 요청이 없어요.' : seg === 'upcoming' ? '예정된 방문이 없어요.' : '완료된 방문이 없어요.'}
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.map((r) => (
            <ReservationCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReservationCard({ r }: { r: Reservation }) {
  const [expanded, setExpanded] = useState(false);
  const badge = badgeMeta(r.status);

  // 선택된 옵션 이름(사장님이 지은 이름) — 옵션을 골랐을 때만 디자인 상세를 불러와 매칭한다.
  const hasSelectedOptions = (r.selected_option_ids?.length ?? 0) > 0;
  const designQuery = useQuery({
    queryKey: ['design', r.design_id],
    queryFn: () => designsApi.getDesign(r.design_id),
    enabled: hasSelectedOptions,
  });
  const selectedOptionNames = hasSelectedOptions
    ? (designQuery.data?.options ?? [])
        .filter((o) => r.selected_option_ids!.includes(o.id))
        .map((o) => o.name)
    : [];

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3.5">
      {/* 헤더: 상태 + 고객명 + 방문 일시 (왼쪽) · 금액 (오른쪽) */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-caption font-bold"
            style={{ background: badge.bg, color: badge.tx }}
          >
            {badge.label}
          </span>
          <div className="min-w-0">
            <div className="truncate text-body-sm font-bold text-primary">{r.user?.nickname ?? '고객'}</div>
            <div className="mt-0.5 text-caption text-primary-50">
              {dayLabel(r.start_at)} {formatTime(r.start_at)}~{formatTime(r.end_at)}
            </div>
          </div>
        </div>
        <div className="shrink-0 text-body-sm font-bold text-primary">{won(r.total_price)}</div>
      </div>

      {/* 디자인 + 선택 옵션 */}
      <div className="mt-2.5 rounded-lg bg-neutral-50 px-3 py-2 text-caption text-primary">
        {r.design?.title ?? '시술'}
        {selectedOptionNames.length > 0 && ` | ${selectedOptionNames.join(' + ')}`}
      </div>

      {/* 자세히 보기 토글 */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-lg border border-neutral-200 py-1.5 text-caption font-semibold text-primary-50"
      >
        {expanded ? '접기' : '자세히 보기'}
        <span className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>⌄</span>
      </button>

      {/* 펼친 상세: 디자인·옵션·사진, 담당 디자이너 일정(타임테이블), 요청사항+답변, 상태 액션 */}
      {expanded && (
        <div className="mt-2.5">
          <ReservationDetail reservation={r} />
        </div>
      )}
    </div>
  );
}

