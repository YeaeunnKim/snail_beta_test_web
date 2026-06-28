'use client';

/**
 * 예약 관리 — 목록 + 상태 전이.
 *
 *  - URL query(status/from/to)로 필터. 대시보드 카드 딥링크가 그대로 동작한다.
 *  - 상태 전이: pending→수락/거절, payment_pending→입금확인,
 *    confirmed→방문완료/노쇼/취소. 거절·취소는 사유 필수(인라인 입력).
 *  - 액션 성공 시 예약 목록 + 대시보드 요약 캐시를 무효화한다.
 */
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reservationsApi } from '@/services';
import type { Reservation, ReservationStatus } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import { formatTime } from '@/lib/date';
import { RESERVATION_STATUS_CLS, RESERVATION_STATUS_LABEL } from '@/lib/reservation-status';

const STATUS_FILTERS: { label: string; value: ReservationStatus | 'all' }[] = [
  { label: '전체', value: 'all' },
  { label: '대기', value: 'pending' },
  { label: '입금대기', value: 'payment_pending' },
  { label: '확정', value: 'confirmed' },
  { label: '완료', value: 'completed' },
];

export default function ReservationsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">불러오는 중…</p>}>
      <ReservationsView />
    </Suspense>
  );
}

function ReservationsView() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();

  const status = (params.get('status') as ReservationStatus | null) ?? null;
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;

  const query = useQuery({
    queryKey: ['reservations', { status, from, to }],
    queryFn: () =>
      reservationsApi.listReservations({
        status: status ?? undefined,
        from,
        to,
        limit: 50,
      }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['reservations'] });
    qc.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
  };

  const setStatus = (next: ReservationStatus | 'all') => {
    const sp = new URLSearchParams(params.toString());
    if (next === 'all') sp.delete('status');
    else sp.set('status', next);
    router.replace(`/dashboard/reservations?${sp.toString()}`);
  };

  const clearDates = () => {
    const sp = new URLSearchParams(params.toString());
    sp.delete('from');
    sp.delete('to');
    router.replace(`/dashboard/reservations?${sp.toString()}`);
  };

  const reservations = query.data?.data ?? [];
  const activeStatus = status ?? 'all';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">예약 관리</h1>
        <p className="mt-1 text-sm text-neutral-500">예약을 확인하고 수락·거절 등 상태를 처리합니다.</p>
      </div>

      {/* 상태 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              activeStatus === f.value
                ? 'border-brand bg-brand text-white'
                : 'border-neutral-300 text-neutral-600'
            }`}
          >
            {f.label}
          </button>
        ))}
        {(from || to) && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600">
            기간: {from ?? '…'} ~ {to ?? '…'}
            <button onClick={clearDates} className="font-bold text-neutral-400">
              ×
            </button>
          </span>
        )}
      </div>

      {query.isLoading ? (
        <p className="text-sm text-neutral-400">불러오는 중…</p>
      ) : query.isError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{toUserMessage(query.error)}</p>
      ) : reservations.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          조건에 맞는 예약이 없습니다.
        </p>
      ) : (
        <ul className="space-y-3">
          {reservations.map((r) => (
            <ReservationCard key={r.id} reservation={r} onChanged={invalidate} />
          ))}
        </ul>
      )}

      {query.data?.page?.has_next && (
        <p className="text-center text-xs text-neutral-400">
          더 많은 예약이 있습니다. (페이지네이션은 추후 추가)
        </p>
      )}
    </div>
  );
}

function ReservationCard({
  reservation: r,
  onChanged,
}: {
  reservation: Reservation;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // 사유 입력 모드: 'reject' | 'cancel' | null
  const [reasonMode, setReasonMode] = useState<'reject' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');

  const action = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setError(null);
      setReasonMode(null);
      setReason('');
      onChanged();
    },
    onError: (e) => setError(toUserMessage(e)),
  });

  const run = (fn: () => Promise<unknown>) => action.mutate(fn);
  const busy = action.isPending;

  const date = new Date(r.start_at);
  const dateLabel = date.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${RESERVATION_STATUS_CLS[r.status]}`}>
              {RESERVATION_STATUS_LABEL[r.status]}
            </span>
            <span className="text-sm font-medium">
              {dateLabel} {formatTime(r.start_at)}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-neutral-700">
            {r.design?.title ?? '시술'}
            {r.designer?.name && <span className="text-neutral-400"> · {r.designer.name}</span>}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {r.user?.nickname ? `${r.user.nickname} · ` : ''}
            {r.total_price.toLocaleString('ko-KR')}원
          </p>
          {r.user_request && (
            <p className="mt-1 rounded bg-neutral-50 px-2 py-1 text-xs text-neutral-600">
              요청: {r.user_request}
            </p>
          )}
        </div>
      </div>

      {/* 사유 입력 */}
      {reasonMode && (
        <div className="mt-3 space-y-2">
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonMode === 'reject' ? '거절 사유를 입력해주세요.' : '취소 사유를 입력해주세요.'}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div className="flex gap-2">
            <button
              disabled={busy || !reason.trim()}
              onClick={() =>
                run(() =>
                  reasonMode === 'reject'
                    ? reservationsApi.reject(r.id, reason.trim())
                    : reservationsApi.cancel(r.id, reason.trim()),
                )
              }
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {reasonMode === 'reject' ? '거절 확정' : '취소 확정'}
            </button>
            <button
              onClick={() => {
                setReasonMode(null);
                setReason('');
              }}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-500"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* 액션 버튼 */}
      {!reasonMode && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.status === 'pending' && (
            <>
              <PrimaryBtn disabled={busy} onClick={() => run(() => reservationsApi.accept(r.id))}>
                수락
              </PrimaryBtn>
              <DangerBtn disabled={busy} onClick={() => setReasonMode('reject')}>
                거절
              </DangerBtn>
            </>
          )}
          {r.status === 'payment_pending' && (
            <PrimaryBtn disabled={busy} onClick={() => run(() => reservationsApi.confirmPayment(r.id))}>
              입금 확인
            </PrimaryBtn>
          )}
          {r.status === 'confirmed' && (
            <>
              <PrimaryBtn disabled={busy} onClick={() => run(() => reservationsApi.complete(r.id))}>
                방문 완료
              </PrimaryBtn>
              <NeutralBtn disabled={busy} onClick={() => run(() => reservationsApi.noShow(r.id))}>
                노쇼
              </NeutralBtn>
              <DangerBtn disabled={busy} onClick={() => setReasonMode('cancel')}>
                취소
              </DangerBtn>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </li>
  );
}

function PrimaryBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
    />
  );
}
function DangerBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600 disabled:opacity-50"
    />
  );
}
function NeutralBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 disabled:opacity-50"
    />
  );
}
