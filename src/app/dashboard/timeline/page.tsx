'use client';

/**
 * 일정(디자이너 타임라인) — 일/주/월 뷰 + 디자이너 필터 + 예약 상세 시트.
 *
 *  - 일: 디자이너 행 × 시간축 막대. 시간축은 샵 영업시간 기준(밖이면 자동 확장).
 *  - 주: 디자이너 행 × 7일 칸(월~일). 칸마다 예약 알약. 요일 헤더 클릭 시 그 날 선택.
 *  - 월: 달력 그리드. 날짜 칸마다 디자이너 색 점 + 예약 수. 칸 클릭 시 그 날 일 뷰로.
 *  - 디자이너 필터 칩으로 행/점을 끄고 켠다(클라이언트 상태).
 *  - 막대/알약 클릭 → 우측 상세 시트. 확정(수락·입금확인)/취소(사유 입력 후 cancel·reject)는
 *    실제 예약 API로 처리한다. (예약 추가·복구는 백엔드가 없어 미제공.)
 *
 * 상태 표현: 확정·완료 = 채움, 대기·입금대기 = 점선("요청"), 거절·취소·노쇼 = 취소선·흐림.
 * 영업시간·점심·휴무 편집은 /dashboard/designers(시간표 관리)에서 처리한다.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designersApi, reservationsApi } from '@/services';
import type { Designer, Reservation } from '@/services';
import { useMyShop } from '@/hooks/use-my-shop';
import { toUserMessage } from '@/lib/error-messages';
import { collectAll } from '@/lib/api-client';
import { formatTime, shiftLocalDate, todayLocalDate } from '@/lib/date';
import {
  dayLabel,
  dayOfMonth,
  dayOfWeek,
  monthGrid,
  monthLabel,
  shiftMonth,
  weekDates,
  weekShortLabel,
} from '@/lib/calendar';
import { WEEKDAYS } from '@/lib/weekday';
import { RESERVATION_STATUS_CLS, RESERVATION_STATUS_LABEL } from '@/lib/reservation-status';
import { InquiryThread, ReservationDesignBlock } from '@/components/reservation-design';
import { DayTimeline } from '@/components/day-timeline';
import { kindOf, TIMELINE_PALETTE } from '@/lib/timeline';

type ViewMode = 'day' | 'week' | 'month';
type Palette = (typeof TIMELINE_PALETTE)[number];

/** ISO datetime → 로컬 "YYYY-MM-DD" */
const localDateOf = (iso: string) => todayLocalDate(new Date(iso));
const isCancelled = (r: Reservation) => kindOf(r.status) === 'cancelled';

export default function TimelinePage() {
  const [mode, setMode] = useState<ViewMode>('day');
  const [date, setDate] = useState(() => todayLocalDate());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: shop } = useMyShop();

  const designersQuery = useQuery({
    queryKey: ['designers'],
    queryFn: () => designersApi.listDesigners(),
  });
  const designers = useMemo(() => designersQuery.data ?? [], [designersQuery.data]);

  const range = useMemo<{ from: string; to: string }>(() => {
    if (mode === 'day') return { from: date, to: date };
    if (mode === 'week') {
      const days = weekDates(date);
      return { from: days[0], to: days[6] };
    }
    const weeks = monthGrid(date);
    return { from: weeks[0][0].date, to: weeks[weeks.length - 1][6].date };
  }, [mode, date]);

  const reservationsQuery = useQuery({
    queryKey: ['reservations', 'timeline', range.from, range.to],
    queryFn: () =>
      collectAll<Reservation>((cursor) =>
        reservationsApi.listReservations({ from: range.from, to: range.to, limit: 50, cursor }),
      ),
  });
  const reservations = reservationsQuery.data ?? [];

  const colorOf = useMemo(() => {
    const map = new Map<string, Palette>();
    designers.forEach((d, i) => map.set(d.id, TIMELINE_PALETTE[i % TIMELINE_PALETTE.length]));
    return map;
  }, [designers]);

  const visibleDesigners = useMemo(
    () => designers.filter((d) => !hidden.has(d.id)),
    [designers, hidden],
  );

  const navigate = (dir: -1 | 1) =>
    setDate((d) =>
      mode === 'day' ? shiftLocalDate(d, dir) : mode === 'week' ? shiftLocalDate(d, dir * 7) : shiftMonth(d, dir),
    );

  const toggleDesigner = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size >= designers.length) next.clear(); // 전부 끄면 전체로 복귀
      return next;
    });

  const openDay = (d: string) => {
    setDate(d);
    setMode('day');
  };

  const label = mode === 'day' ? dayLabel(date) : mode === 'week' ? weekShortLabel(date) : monthLabel(date);
  const loading = designersQuery.isLoading || reservationsQuery.isLoading;
  const error = designersQuery.error ?? reservationsQuery.error;
  const selected = selectedId ? reservations.find((r) => r.id === selectedId) ?? null : null;

  return (
    <div className="space-y-4">
      {/* 상단 바 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-heading-lg font-bold leading-tight text-secondary">{shop?.name ?? '내 샵'}</div>
          <div className="text-caption font-semibold text-primary-50">디자이너 스케줄</div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setDate(todayLocalDate())}
            className="h-8 rounded-lg border border-neutral-200 bg-white px-3 text-body-sm font-semibold text-primary hover:bg-neutral-50"
          >
            오늘
          </button>
          <button
            onClick={() => navigate(-1)}
            aria-label="이전"
            className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 bg-white text-primary-50 hover:bg-neutral-50"
          >
            ‹
          </button>
          <div className="min-w-[150px] text-center text-body-md font-semibold">{label}</div>
          <button
            onClick={() => navigate(1)}
            aria-label="다음"
            className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 bg-white text-primary-50 hover:bg-neutral-50"
          >
            ›
          </button>
        </div>

        <div className="flex gap-1 rounded-xl bg-neutral-100 p-1">
          {(['day', 'week', 'month'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-4 py-1.5 text-body-sm font-semibold ${
                mode === m ? 'bg-white text-primary shadow-sm' : 'text-primary-50 hover:text-primary'
              }`}
            >
              {m === 'day' ? '일' : m === 'week' ? '주' : '월'}
            </button>
          ))}
        </div>
      </div>

      {/* 디자이너 필터 */}
      {designers.length > 0 && (
        <Filters designers={designers} hidden={hidden} colorOf={colorOf} onToggle={toggleDesigner} onAll={() => setHidden(new Set())} />
      )}

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        {error ? (
          <p className="m-4 rounded-md bg-red-50 px-3 py-2 text-body-sm text-red-700">{toUserMessage(error)}</p>
        ) : loading ? (
          <p className="py-12 text-center text-body-sm text-primary-50">불러오는 중…</p>
        ) : designers.length === 0 ? (
          <p className="m-4 rounded-md border border-dashed border-neutral-300 p-8 text-center text-body-sm text-primary-50">
            등록된 디자이너가 없습니다. 디자이너 탭에서 추가해주세요.
          </p>
        ) : mode === 'day' ? (
          <DayTimeline
            designers={visibleDesigners}
            reservations={reservations}
            businessHours={shop?.business_hours}
            date={date}
            colorOf={colorOf}
            onSelect={setSelectedId}
          />
        ) : mode === 'week' ? (
          <WeekView
            designers={visibleDesigners}
            reservations={reservations}
            date={date}
            colorOf={colorOf}
            onSelectDate={setDate}
            onSelect={setSelectedId}
          />
        ) : (
          <MonthView
            reservations={reservations}
            date={date}
            hidden={hidden}
            colorOf={colorOf}
            onOpenDay={openDay}
          />
        )}
      </div>

      <DetailSheet reservation={selected} colorOf={colorOf} onClose={() => setSelectedId(null)} />
    </div>
  );
}

/* ───────────────────────── 필터 ───────────────────────── */

function Filters({
  designers,
  hidden,
  colorOf,
  onToggle,
  onAll,
}: {
  designers: Designer[];
  hidden: Set<string>;
  colorOf: Map<string, Palette>;
  onToggle: (id: string) => void;
  onAll: () => void;
}) {
  const allOn = hidden.size === 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={onAll}
        className={`inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-body-sm font-semibold ${
          allOn ? 'border-secondary text-primary' : 'border-neutral-300 bg-neutral-50 text-primary-50'
        }`}
      >
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: allOn ? 'var(--color-secondary, #8b7565)' : '#ccc' }} />
        전체
      </button>
      {designers.map((d) => {
        const off = hidden.has(d.id);
        const color = colorOf.get(d.id) ?? TIMELINE_PALETTE[0];
        return (
          <button
            key={d.id}
            onClick={() => onToggle(d.id)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-body-sm font-semibold ${
              off ? 'border-neutral-200 bg-neutral-50 text-primary-50' : 'border-neutral-200 text-primary'
            }`}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: color.border, opacity: off ? 0.3 : 1 }}
            />
            {d.name}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── 주 뷰 ───────────────────────── */

function WeekView({
  designers,
  reservations,
  date,
  colorOf,
  onSelectDate,
  onSelect,
}: {
  designers: Designer[];
  reservations: Reservation[];
  date: string;
  colorOf: Map<string, Palette>;
  onSelectDate: (d: string) => void;
  onSelect: (id: string) => void;
}) {
  const days = weekDates(date);
  const byCell = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const r of reservations) {
      const key = `${r.designer_id}|${localDateOf(r.start_at)}`;
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return map;
  }, [reservations]);

  const dowCls = (d: string) => (dayOfWeek(d) === 0 ? 'text-[#e2574d]' : dayOfWeek(d) === 6 ? 'text-[#3b82f6]' : 'text-primary');

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        {/* 요일 헤더 */}
        <div className="sticky top-0 z-10 flex border-b border-neutral-200 bg-neutral-50">
          <div className="w-[116px] shrink-0 border-r border-neutral-200 px-3.5 py-2 text-caption text-primary-50">
            디자이너
          </div>
          <div className="flex flex-1">
            {days.map((d) => {
              const sel = d === date;
              return (
                <button
                  key={d}
                  onClick={() => onSelectDate(d)}
                  className={`flex-1 border-r border-neutral-100 py-1.5 text-center last:border-r-0 hover:bg-neutral-100 ${sel ? 'bg-[#ffeaf0]' : ''}`}
                >
                  <div className="text-caption text-primary-50">{WEEKDAYS[(dayOfWeek(d) + 6) % 7].label}</div>
                  <div className={`text-body-md font-bold ${dowCls(d)}`}>{dayOfMonth(d)}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 디자이너 행 */}
        {designers.map((dz, di) => {
          const color = colorOf.get(dz.id) ?? TIMELINE_PALETTE[0];
          const last = di === designers.length - 1;
          return (
            <div key={dz.id} className={`flex ${last ? '' : 'border-b border-neutral-100'}`}>
              <div className="flex w-[116px] shrink-0 items-center gap-2 border-r border-neutral-200 bg-neutral-50/60 px-3.5 py-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color.border }} />
                <span className="truncate text-body-sm font-semibold">{dz.name}</span>
              </div>
              <div className="flex flex-1">
                {days.map((d) => {
                  const sel = d === date;
                  const jobs = byCell.get(`${dz.id}|${d}`) ?? [];
                  return (
                    <div
                      key={d}
                      className={`flex min-h-[60px] flex-1 flex-col gap-1 border-r border-neutral-100 p-1 last:border-r-0 ${sel ? 'bg-[#fff5f8]' : ''}`}
                    >
                      {jobs.map((r) => (
                        <WeekPill key={r.id} reservation={r} color={color} onSelect={onSelect} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekPill({
  reservation: r,
  color,
  onSelect,
}: {
  reservation: Reservation;
  color: Palette;
  onSelect: (id: string) => void;
}) {
  const kind = kindOf(r.status);
  const requested = kind === 'requested';
  const cancelled = kind === 'cancelled';
  const who = r.user?.nickname ?? '고객';
  return (
    <button
      onClick={() => onSelect(r.id)}
      className={`overflow-hidden truncate rounded-md px-1.5 py-1 text-left text-caption font-semibold leading-tight ${cancelled ? 'opacity-45 line-through' : ''}`}
      style={{
        background: requested ? '#ffffff' : color.bg,
        border: `1px ${requested ? 'dashed' : 'solid'} ${color.border}`,
        color: color.text,
      }}
      title={`${who} · ${r.design?.title ?? '시술'} · ${formatTime(r.start_at)}~${formatTime(r.end_at)}`}
    >
      {who}
      <span className="ml-1 text-caption opacity-80">{formatTime(r.start_at)}</span>
    </button>
  );
}

/* ───────────────────────── 월 뷰 ───────────────────────── */

function MonthView({
  reservations,
  date,
  hidden,
  colorOf,
  onOpenDay,
}: {
  reservations: Reservation[];
  date: string;
  hidden: Set<string>;
  colorOf: Map<string, Palette>;
  onOpenDay: (d: string) => void;
}) {
  const weeks = monthGrid(date);
  const today = todayLocalDate();

  const byDate = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const r of reservations) {
      if (isCancelled(r) || hidden.has(r.designer_id)) continue;
      const key = localDateOf(r.start_at);
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return map;
  }, [reservations, hidden]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[680px]">
        <div className="flex border-b border-neutral-200 bg-neutral-50">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w.value}
              className={`flex-1 border-r border-neutral-100 py-2.5 text-center text-body-sm last:border-r-0 ${
                i === 5 ? 'text-[#3b82f6]' : i === 6 ? 'text-[#e2574d]' : 'text-primary-50'
              }`}
            >
              {w.label}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className={`flex ${wi === weeks.length - 1 ? '' : 'border-b border-neutral-100'}`}>
            {week.map((cell) => {
              const jobs = byDate.get(cell.date) ?? [];
              const isToday = cell.date === today;
              const dow = dayOfWeek(cell.date);
              const dateColor = !cell.inMonth
                ? 'text-primary-10'
                : dow === 0
                  ? 'text-[#e2574d]'
                  : dow === 6
                    ? 'text-[#3b82f6]'
                    : 'text-primary';
              return (
                <button
                  key={cell.date}
                  onClick={() => onOpenDay(cell.date)}
                  className={`min-h-[112px] flex-1 border-r border-neutral-100 p-2.5 text-left align-top last:border-r-0 hover:bg-[#fdf4f7] ${
                    cell.inMonth ? '' : 'bg-neutral-50/60'
                  }`}
                >
                  {isToday ? (
                    <span className="inline-grid h-[22px] min-w-[22px] place-items-center rounded-full bg-secondary px-1.5 text-caption font-bold text-white">
                      {dayOfMonth(cell.date)}
                    </span>
                  ) : (
                    <span className={`text-body-sm font-semibold ${dateColor}`}>{dayOfMonth(cell.date)}</span>
                  )}
                  {jobs.length > 0 && (
                    <>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {jobs.slice(0, 7).map((r) => {
                          const color = colorOf.get(r.designer_id) ?? TIMELINE_PALETTE[0];
                          const requested = kindOf(r.status) === 'requested';
                          return (
                            <span
                              key={r.id}
                              className="h-2 w-2 rounded-full"
                              style={
                                requested
                                  ? { border: `1.5px solid ${color.border}`, background: '#fff' }
                                  : { background: color.border }
                              }
                            />
                          );
                        })}
                      </div>
                      <div className="mt-1.5 text-caption text-primary-50">예약 {jobs.length}</div>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── 상세 시트 ───────────────────────── */

function DetailSheet({
  reservation: r,
  colorOf,
  onClose,
}: {
  reservation: Reservation | null;
  colorOf: Map<string, Palette>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reasonMode, setReasonMode] = useState(false);
  const [reason, setReason] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);

  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setError(null);
      setReasonMode(false);
      setReason('');
      setReply('');
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
    },
    onError: (e) => setError(toUserMessage(e)),
  });

  const open = r != null;
  const color = r ? colorOf.get(r.designer_id) ?? TIMELINE_PALETTE[0] : TIMELINE_PALETTE[0];
  const busy = action.isPending;

  // 확정 가능: 대기→수락, 입금대기→입금확인 / 취소 가능: 대기·입금대기·확정
  const confirmable = r?.status === 'pending' || r?.status === 'payment_pending';
  const cancellable = r?.status === 'pending' || r?.status === 'payment_pending' || r?.status === 'confirmed';

  const doConfirm = () => {
    if (!r) return;
    action.mutate(() =>
      r.status === 'payment_pending'
        ? reservationsApi.confirmPayment(r.id)
        : reservationsApi.accept(r.id, reply.trim() || undefined),
    );
  };
  const doCancel = () => {
    if (!r || !reason.trim()) return;
    action.mutate(() =>
      r.status === 'pending'
        ? reservationsApi.reject(r.id, reason.trim())
        : reservationsApi.cancel(r.id, reason.trim()),
    );
  };

  const close = () => {
    setReasonMode(false);
    setReason('');
    setError(null);
    onClose();
  };

  return (
    <>
      <div
        onClick={close}
        className={`fixed inset-0 z-40 bg-neutral-900/30 transition-opacity ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-[340px] max-w-[90vw] flex-col bg-white shadow-xl transition-transform ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <header className="flex items-center justify-between px-5 pb-3 pt-4">
          <div className="text-body-md font-bold">예약 상세</div>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-lg bg-neutral-100 text-primary-50 hover:bg-neutral-200"
          >
            ✕
          </button>
        </header>

        {r && (
          <div className="overflow-auto px-5 pb-5">
            <div className="mb-3 mt-0.5 flex items-center gap-2.5">
              <span className="h-3 w-3 rounded-full" style={{ background: color.border }} />
              <span className="text-body-md font-bold">{r.user?.nickname ?? '고객'}</span>
              <span className={`ml-auto rounded-full px-2.5 py-1 text-caption font-bold ${RESERVATION_STATUS_CLS[r.status]}`}>
                {RESERVATION_STATUS_LABEL[r.status]}
              </span>
            </div>

            <Kv k="디자이너" v={r.designer?.name ?? '-'} />
            <Kv k="날짜" v={localDateOf(r.start_at).replaceAll('-', '. ')} />
            <Kv k="시간" v={`${formatTime(r.start_at)} ~ ${formatTime(r.end_at)}`} />
            <Kv k="금액" v={`${r.total_price.toLocaleString('ko-KR')}원`} />

            <div className="mb-2 mt-4 text-caption font-bold text-primary-50">디자인</div>
            {r.design ? (
              <ReservationDesignBlock reservation={r} />
            ) : (
              <p className="text-body-sm text-primary-50">디자인 정보가 없어요.</p>
            )}

            <div className="mb-2 mt-4 text-caption font-bold text-primary-50">요청사항</div>
            <InquiryThread reservation={r} />
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

            {reasonMode ? (
              <div className="mt-4 space-y-2">
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={r.status === 'pending' ? '거절 사유를 입력해주세요.' : '취소 사유를 입력해주세요.'}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
                />
                <div className="flex gap-2">
                  <button
                    disabled={busy || !reason.trim()}
                    onClick={doCancel}
                    className="flex-1 rounded-xl bg-[#fdeaea] py-2.5 text-body-sm font-bold text-[#cf3b3b] disabled:opacity-50"
                  >
                    {r.status === 'pending' ? '거절 확정' : '취소 확정'}
                  </button>
                  <button
                    onClick={() => {
                      setReasonMode(false);
                      setReason('');
                    }}
                    className="flex-1 rounded-xl bg-neutral-100 py-2.5 text-body-sm font-bold text-primary"
                  >
                    닫기
                  </button>
                </div>
              </div>
            ) : (
              (confirmable || cancellable) && (
                <div className="mt-4 flex gap-2">
                  {confirmable && (
                    <button
                      disabled={busy}
                      onClick={doConfirm}
                      className="flex-1 rounded-xl bg-secondary py-2.5 text-body-sm font-bold text-white disabled:opacity-50"
                    >
                      {r.status === 'pending' && reply.trim() ? '답변과 함께 확정' : '예약 확정'}
                    </button>
                  )}
                  {cancellable && (
                    <button
                      disabled={busy}
                      onClick={() => setReasonMode(true)}
                      className="flex-1 rounded-xl bg-[#fdeaea] py-2.5 text-body-sm font-bold text-[#cf3b3b] disabled:opacity-50"
                    >
                      예약 취소
                    </button>
                  )}
                </div>
              )
            )}

            {error && <p className="mt-2 text-caption text-red-600">{error}</p>}
            <p className="mt-4 text-caption leading-relaxed text-primary-50">
              방문완료·노쇼 등 다른 상태 처리는 예약 관리 화면에서 할 수 있어요.
            </p>
          </div>
        )}
      </aside>
    </>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2.5 border-b border-neutral-100 py-2.5 text-body-sm">
      <div className="w-[68px] shrink-0 text-primary-50">{k}</div>
      <div className="font-semibold">{v}</div>
    </div>
  );
}
