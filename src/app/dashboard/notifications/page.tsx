'use client';

/**
 * 알림 — 예약 요청/방문 관리 (모바일).
 *
 * 세그먼트 3개:
 *  - 요청     : pending(수락/거절) · payment_pending(입금 확인/취소)
 *  - 방문 예정 : confirmed(방문 완료/노쇼/취소) — 방문 임박 순
 *  - 방문 완료 : completed(읽기 전용) — 최근 순
 *
 * 거절/취소는 사유가 필수라 카드에서 사유 입력 후 확정한다.
 * 상태를 바꾸면 ['reservations'] 쿼리를 무효화해 일정 탭의 예약 잠금도 함께 갱신된다.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reservationsApi } from '@/services';
import type { Reservation } from '@/services';
import { collectAll } from '@/lib/api-client';
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

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [seg, setSeg] = useState<Seg>('requests');

  const reservationsQuery = useQuery({
    queryKey: ['reservations', 'notifications'],
    queryFn: () =>
      collectAll<Reservation>((cursor) => reservationsApi.listReservations({ cursor, limit: 50 })),
  });
  const all = useMemo(() => reservationsQuery.data ?? [], [reservationsQuery.data]);

  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
    },
  });

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
        <h1 className="text-heading-md font-bold text-primary">알림</h1>
        <p className="mt-0.5 text-caption text-primary-50">들어온 예약을 수락하고 방문을 관리하세요.</p>
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
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
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

      {action.isError && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-caption text-danger">
          {toUserMessage(action.error)}
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
            <ReservationCard key={r.id} r={r} run={(fn) => action.mutate(fn)} busy={action.isPending} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReservationCard({
  r,
  run,
  busy,
}: {
  r: Reservation;
  run: (fn: () => Promise<unknown>) => void;
  busy: boolean;
}) {
  const [reasonMode, setReasonMode] = useState<null | 'reject' | 'cancel'>(null);
  const [reason, setReason] = useState('');
  const [expanded, setExpanded] = useState(false);
  const badge = badgeMeta(r.status);

  const submitReason = () => {
    if (!reason.trim()) return;
    if (reasonMode === 'reject') run(() => reservationsApi.reject(r.id, reason.trim()));
    else if (reasonMode === 'cancel') run(() => reservationsApi.cancel(r.id, reason.trim()));
    setReasonMode(null);
    setReason('');
  };

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3.5">
      {/* 헤더: 상태 + 방문 일시 */}
      <div className="flex items-center justify-between">
        <span
          className="rounded-full px-2.5 py-1 text-caption font-bold"
          style={{ background: badge.bg, color: badge.tx }}
        >
          {badge.label}
        </span>
        <span className="text-caption font-semibold text-primary">
          {dayLabel(r.start_at)} {formatTime(r.start_at)}~{formatTime(r.end_at)}
        </span>
      </div>

      {/* 고객 + 디자인 */}
      <div className="mt-2.5 flex items-center gap-2.5">
        {r.design?.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.design.thumbnail_url}
            alt=""
            className="h-11 w-11 shrink-0 rounded-lg border border-neutral-200 object-cover"
          />
        ) : (
          <span className="h-11 w-11 shrink-0 rounded-lg border border-neutral-200 bg-neutral-100" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-sm font-bold text-primary">{r.user?.nickname ?? '고객'}</div>
          <div className="truncate text-caption text-primary-50">
            {r.design?.title ?? '시술'} · {r.designer?.name ?? '담당자 미정'}
          </div>
        </div>
        <div className="shrink-0 text-body-sm font-bold text-primary">{won(r.total_price)}</div>
      </div>

      {/* 고객 요청사항 */}
      {r.user_request && (
        <p className="mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-caption text-primary">
          <span className="font-semibold text-secondary">요청사항 </span>
          {r.user_request}
        </p>
      )}

      {/* 접힌 상태: 빠른 액션(+ 사유 입력). 펼치면 아래 상세의 액션을 사용. */}
      {!expanded &&
        (reasonMode ? (
          <div className="mt-2.5 space-y-2">
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonMode === 'reject' ? '거절 사유를 입력해주세요.' : '취소 사유를 입력해주세요.'}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
            />
            <div className="flex gap-2">
              <button
                disabled={busy || !reason.trim()}
                onClick={submitReason}
                className="flex-1 rounded-lg bg-danger-bg py-2 text-caption font-bold text-danger disabled:opacity-50"
              >
                {reasonMode === 'reject' ? '거절 확정' : '취소 확정'}
              </button>
              <button
                onClick={() => {
                  setReasonMode(null);
                  setReason('');
                }}
                className="flex-1 rounded-lg bg-neutral-100 py-2 text-caption font-bold text-primary"
              >
                닫기
              </button>
            </div>
          </div>
        ) : (
          <Actions
            r={r}
            busy={busy}
            run={run}
            onReject={() => setReasonMode('reject')}
            onCancel={() => setReasonMode('cancel')}
          />
        ))}

      {/* 자세히 보기 토글 */}
      <button
        onClick={() => {
          setExpanded((v) => !v);
          setReasonMode(null);
        }}
        className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-lg border border-neutral-200 py-1.5 text-caption font-semibold text-primary-50"
      >
        {expanded ? '접기' : '자세히 보기'}
        <span className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>⌄</span>
      </button>

      {/* 펼친 상세: 디자인·옵션·사진, 담당 디자이너 일정(타임테이블), 요청사항+답변, 상태 액션 */}
      {expanded && (
        <div className="-mx-3.5 -mb-3.5 mt-2.5 overflow-hidden rounded-b-2xl">
          <ReservationDetail reservation={r} />
        </div>
      )}
    </div>
  );
}

function Actions({
  r,
  busy,
  run,
  onReject,
  onCancel,
}: {
  r: Reservation;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const primary =
    'flex-1 rounded-lg bg-secondary py-2 text-caption font-bold text-white disabled:opacity-50';
  const ghost = 'flex-1 rounded-lg bg-neutral-100 py-2 text-caption font-bold text-primary disabled:opacity-50';
  const danger = 'flex-1 rounded-lg bg-danger-bg py-2 text-caption font-bold text-danger disabled:opacity-50';

  if (r.status === 'pending') {
    return (
      <div className="mt-2.5 flex gap-2">
        <button disabled={busy} onClick={() => run(() => reservationsApi.accept(r.id))} className={primary}>
          수락
        </button>
        <button disabled={busy} onClick={onReject} className={danger}>
          거절
        </button>
      </div>
    );
  }
  if (r.status === 'payment_pending') {
    return (
      <div className="mt-2.5 flex gap-2">
        <button
          disabled={busy}
          onClick={() => run(() => reservationsApi.confirmPayment(r.id))}
          className={primary}
        >
          입금 확인
        </button>
        <button disabled={busy} onClick={onCancel} className={danger}>
          취소
        </button>
      </div>
    );
  }
  if (r.status === 'confirmed') {
    return (
      <div className="mt-2.5 flex gap-2">
        <button disabled={busy} onClick={() => run(() => reservationsApi.complete(r.id))} className={primary}>
          방문 완료
        </button>
        <button disabled={busy} onClick={() => run(() => reservationsApi.noShow(r.id))} className={ghost}>
          노쇼
        </button>
        <button disabled={busy} onClick={onCancel} className={danger}>
          취소
        </button>
      </div>
    );
  }
  return null; // completed 등 종료 상태는 액션 없음
}
