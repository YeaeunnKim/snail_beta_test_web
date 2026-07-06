'use client';

/**
 * 예약 상세 (예약 관리 인라인 상세 · 홈 처리대기 요청 공용).
 *
 * 자체 mutation을 소유해 상태 전이/입금확인/답변을 처리하고, 성공 시 예약·대시보드
 * 캐시를 무효화한다. 확정/거절·취소(사유 필수)/방문완료/노쇼를 모두 다룬다.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reservationsApi } from '@/services';
import type { Reservation } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import { formatTime } from '@/lib/date';
import { dateTimeLabel, dayLabel, payState, won } from '@/lib/reservation-format';
import { DesignerDayTimeline } from '@/components/day-timeline';
import { InquiryThread, ReservationDesignBlock } from '@/components/reservation-design';

export function PayPill({ state }: { state: 'WAIT' | 'DONE' }) {
  const meta =
    state === 'WAIT'
      ? { label: '입금 대기', cls: 'bg-warning-bg text-warning' }
      : { label: '입금 완료', cls: 'bg-success-bg text-success' };
  return (
    <span className={`rounded-full px-2 py-0.5 text-caption font-bold ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

export function ReservationDetail({
  reservation: r,
  onChanged,
}: {
  reservation: Reservation;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [reasonMode, setReasonMode] = useState<'reject' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ps = payState(r);

  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setError(null);
      setReasonMode(null);
      setReason('');
      setReply('');
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onChanged?.();
    },
    onError: (e) => setError(toUserMessage(e)),
  });
  const run = (fn: () => Promise<unknown>) => action.mutate(fn);
  const busy = action.isPending;

  const timeline: { label: string; at: string }[] = [{ label: '예약 요청', at: r.created_at }];
  if (r.owner_payment_confirmed_at) timeline.push({ label: '입금 확인', at: r.owner_payment_confirmed_at });
  if (r.completed_at) timeline.push({ label: '방문 완료', at: r.completed_at });
  if (r.no_show_at) timeline.push({ label: '노쇼 처리', at: r.no_show_at });

  return (
    <div className="border-t border-neutral-100 bg-rose-hover px-5 pb-6 pt-1">
      <InfoLine k="요청일" v={dateTimeLabel(r.created_at)} />
      <InfoLine k="방문일" v={`${dayLabel(r.start_at)} ${formatTime(r.start_at)}~${formatTime(r.end_at)}`} />
      <InfoLine k="담당자" v={r.designer?.name ?? '-'} />
      <InfoLine k="금액" v={won(r.total_price)} />

      <SectionTitle>담당 디자이너 일정 · 방문일</SectionTitle>
      <DesignerDayTimeline reservation={r} />

      <SectionTitle>디자인</SectionTitle>
      {r.design ? <ReservationDesignBlock reservation={r} /> : <p className="text-body-sm text-primary-50">디자인 정보가 없어요.</p>}

      {ps && (
        <>
          <SectionTitle>결제 (플랫폼 → 사장님 계좌)</SectionTitle>
          <div className="flex flex-wrap items-center gap-2.5">
            <PayPill state={ps} />
            {r.deposit_amount_snapshot != null && (
              <span className="text-caption text-primary-50">예약금 {won(r.deposit_amount_snapshot)}</span>
            )}
            {r.status === 'payment_pending' && (
              <button
                disabled={busy}
                onClick={() => run(() => reservationsApi.confirmPayment(r.id))}
                className="rounded-lg bg-secondary px-3 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
              >
                입금 완료 처리
              </button>
            )}
          </div>
        </>
      )}

      <SectionTitle>요청사항</SectionTitle>
      <InquiryThread reservation={r} />

      {/* 예약 확정 시 요청 답변(선택) — 아직 승인 전 & 답변 없음 */}
      {r.status === 'pending' && !r.owner_reply && !reasonMode && (
        <div className="mt-3">
          <label className="mb-1 block text-caption font-semibold text-primary-50">
            답변 (선택) — 예약 확정 시 함께 전달돼요
          </label>
          <textarea
            rows={2}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="요청에 대한 답변을 적어주세요."
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
          />
        </div>
      )}

      {/* 사유 입력 */}
      {reasonMode ? (
        <div className="mt-4 space-y-2">
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
              onClick={() =>
                run(() =>
                  reasonMode === 'reject'
                    ? reservationsApi.reject(r.id, reason.trim())
                    : reservationsApi.cancel(r.id, reason.trim()),
                )
              }
              className="rounded-xl bg-danger-bg px-4 py-2 text-body-sm font-semibold text-danger disabled:opacity-50"
            >
              {reasonMode === 'reject' ? '거절 확정' : '취소 확정'}
            </button>
            <button
              onClick={() => {
                setReasonMode(null);
                setReason('');
              }}
              className="rounded-xl bg-neutral-100 px-4 py-2 text-body-sm font-semibold text-primary"
            >
              닫기
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {r.status === 'pending' && (
            <>
              <ActBtn kind="primary" busy={busy} onClick={() => run(() => reservationsApi.accept(r.id, reply.trim() || undefined))}>
                {reply.trim() ? '답변과 함께 확정' : '예약 확정'}
              </ActBtn>
              <ActBtn kind="danger" busy={busy} onClick={() => setReasonMode('reject')}>
                거절
              </ActBtn>
            </>
          )}
          {r.status === 'confirmed' && (
            <>
              <ActBtn kind="primary" busy={busy} onClick={() => run(() => reservationsApi.complete(r.id))}>
                방문 완료
              </ActBtn>
              <ActBtn kind="ghost" busy={busy} onClick={() => run(() => reservationsApi.noShow(r.id))}>
                노쇼
              </ActBtn>
              <ActBtn kind="danger" busy={busy} onClick={() => setReasonMode('cancel')}>
                취소
              </ActBtn>
            </>
          )}
          {r.status === 'payment_pending' && (
            <ActBtn kind="danger" busy={busy} onClick={() => setReasonMode('cancel')}>
              취소
            </ActBtn>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-caption text-danger">{error}</p>}

      <SectionTitle>변경 이력</SectionTitle>
      <ul className="space-y-1.5">
        {timeline.map((t) => (
          <li key={t.label} className="flex gap-2.5 text-caption text-primary-50">
            <span className="min-w-[88px] shrink-0 text-primary-10">{dateTimeLabel(t.at)}</span>
            <span>{t.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InfoLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2.5 border-b border-neutral-100 py-2.5 text-body-sm">
      <span className="w-16 shrink-0 text-primary-50">{k}</span>
      <span className="font-semibold">{v}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 mt-4 text-caption font-semibold text-primary-50">{children}</div>;
}

function ActBtn({
  kind,
  busy,
  onClick,
  children,
}: {
  kind: 'primary' | 'ghost' | 'danger';
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const cls =
    kind === 'primary'
      ? 'bg-secondary text-white'
      : kind === 'danger'
        ? 'bg-danger-bg text-danger'
        : 'bg-neutral-100 text-primary';
  return (
    <button disabled={busy} onClick={onClick} className={`rounded-xl px-4 py-2 text-body-sm font-semibold disabled:opacity-50 ${cls}`}>
      {children}
    </button>
  );
}
