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
import { computeWindow, isoToMinutes, kindOf, TIMELINE_PALETTE } from '@/lib/timeline';

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
          <div className="text-xl font-bold leading-tight text-brand">{shop?.name ?? '내 샵'}</div>
          <div className="text-[11px] font-medium text-neutral-400">디자이너 스케줄</div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setDate(todayLocalDate())}
            className="h-8 rounded-lg border border-neutral-200 bg-white px-3 text-[13px] text-neutral-600 hover:bg-neutral-50"
          >
            오늘
          </button>
          <button
            onClick={() => navigate(-1)}
            aria-label="이전"
            className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"
          >
            ‹
          </button>
          <div className="min-w-[150px] text-center text-base font-semibold">{label}</div>
          <button
            onClick={() => navigate(1)}
            aria-label="다음"
            className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"
          >
            ›
          </button>
        </div>

        <div className="flex gap-1 rounded-xl bg-neutral-100 p-1">
          {(['day', 'week', 'month'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-4 py-1.5 text-[13px] font-semibold ${
                mode === m ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
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
          <p className="m-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{toUserMessage(error)}</p>
        ) : loading ? (
          <p className="py-12 text-center text-sm text-neutral-400">불러오는 중…</p>
        ) : designers.length === 0 ? (
          <p className="m-4 rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
            등록된 디자이너가 없습니다. 디자이너 탭에서 추가해주세요.
          </p>
        ) : mode === 'day' ? (
          <DayView
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
        className={`inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-[12.5px] font-semibold ${
          allOn ? 'border-brand text-neutral-800' : 'border-neutral-300 bg-neutral-50 text-neutral-400'
        }`}
      >
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: allOn ? 'var(--brand, #f6648a)' : '#ccc' }} />
        전체
      </button>
      {designers.map((d) => {
        const off = hidden.has(d.id);
        const color = colorOf.get(d.id) ?? TIMELINE_PALETTE[0];
        return (
          <button
            key={d.id}
            onClick={() => onToggle(d.id)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
              off ? 'border-neutral-200 bg-neutral-50 text-neutral-400' : 'border-neutral-200 text-neutral-800'
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

/* ───────────────────────── 일 뷰 ───────────────────────── */

function DayView({
  designers,
  reservations,
  businessHours,
  date,
  colorOf,
  onSelect,
}: {
  designers: Designer[];
  reservations: Reservation[];
  businessHours: Parameters<typeof computeWindow>[0];
  date: string;
  colorOf: Map<string, Palette>;
  onSelect: (id: string) => void;
}) {
  const dayRes = useMemo(
    () => reservations.filter((r) => localDateOf(r.start_at) === date),
    [reservations, date],
  );
  const win = useMemo(
    () => computeWindow(businessHours, dayRes.filter((r) => !isCancelled(r))),
    [businessHours, dayRes],
  );

  const byDesigner = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const r of dayRes) {
      const list = map.get(r.designer_id) ?? [];
      list.push(r);
      map.set(r.designer_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return map;
  }, [dayRes]);

  const { startHour, endHour } = win;
  const hourCount = endHour - startHour;
  const startMin = startHour * 60;
  const spanMin = hourCount * 60;
  const step = 100 / hourCount;
  const pct = (min: number) => ((min - startMin) / spanMin) * 100;
  const grid = `repeating-linear-gradient(to right, transparent 0, transparent calc(${step}% - 1px), #f4f3ee calc(${step}% - 1px), #f4f3ee ${step}%)`;

  const now = new Date();
  const nowMin = date === todayLocalDate() ? now.getHours() * 60 + now.getMinutes() : null;
  const nowPct = nowMin != null ? pct(nowMin) : null;
  const showNow = nowPct != null && nowPct >= 0 && nowPct <= 100;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div className="sticky top-0 z-10 flex border-b border-neutral-200 bg-neutral-50">
          <div className="w-[116px] shrink-0 border-r border-neutral-200 px-3.5 py-2 text-xs text-neutral-400">
            디자이너
          </div>
          <div className="flex flex-1">
            {Array.from({ length: hourCount }, (_, i) => (
              <span
                key={i}
                className="flex-1 border-r border-neutral-100 px-1.5 pt-2.5 text-[11px] text-neutral-400 last:border-r-0"
              >
                {startHour + i}
              </span>
            ))}
          </div>
        </div>

        {designers.map((d, i) => {
          const color = colorOf.get(d.id) ?? TIMELINE_PALETTE[0];
          const jobs = byDesigner.get(d.id) ?? [];
          const live = jobs.filter((r) => !isCancelled(r)).length;
          const last = i === designers.length - 1;
          return (
            <div key={d.id} className={`flex ${last ? '' : 'border-b border-neutral-100'}`}>
              <div className="flex w-[116px] shrink-0 items-center gap-2 border-r border-neutral-200 bg-neutral-50/60 px-3.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color.border }} />
                <span className="truncate text-[13.5px] font-semibold">{d.name}</span>
                <span className="ml-auto text-[11px] text-neutral-300">{live}건</span>
              </div>
              <div className="relative h-[62px] flex-1" style={{ background: grid }}>
                {showNow && (
                  <div className="absolute inset-y-0 z-[2] w-0.5 bg-brand/70" style={{ left: `${nowPct}%` }}>
                    <span className="absolute -left-[3px] -top-0.5 h-2 w-2 rounded-full bg-brand" />
                  </div>
                )}
                {jobs.map((r) => (
                  <DayBar key={r.id} reservation={r} color={color} pct={pct} onSelect={onSelect} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayBar({
  reservation: r,
  color,
  pct,
  onSelect,
}: {
  reservation: Reservation;
  color: Palette;
  pct: (min: number) => number;
  onSelect: (id: string) => void;
}) {
  const startPct = Math.max(0, pct(isoToMinutes(r.start_at)));
  const endPct = Math.min(100, pct(isoToMinutes(r.end_at)));
  const width = Math.max(0, endPct - startPct);
  if (width <= 0) return null;

  const kind = kindOf(r.status);
  const requested = kind === 'requested';
  const cancelled = kind === 'cancelled';
  const who = r.user?.nickname ?? '고객';
  const svc = r.design?.title ?? '시술';

  return (
    <button
      onClick={() => onSelect(r.id)}
      className={`absolute inset-y-[8px] overflow-hidden rounded-r-lg px-2 py-1 text-left transition-transform hover:-translate-y-px ${cancelled ? 'opacity-45' : ''}`}
      style={{
        left: `${startPct}%`,
        width: `${width}%`,
        background: requested ? '#ffffff' : color.bg,
        borderLeft: `3px solid ${color.border}`,
        borderTop: requested ? `1px dashed ${color.border}` : undefined,
        borderRight: requested ? `1px dashed ${color.border}` : undefined,
        borderBottom: requested ? `1px dashed ${color.border}` : undefined,
        color: color.text,
      }}
      title={`${who} · ${svc} · ${formatTime(r.start_at)}~${formatTime(r.end_at)}`}
    >
      <div className={`truncate text-[11.5px] font-bold ${cancelled ? 'line-through' : ''}`}>
        {who}
        {requested && (
          <span className="ml-1 rounded px-1 text-[9px] font-bold" style={{ background: color.bg, color: color.text }}>
            요청
          </span>
        )}
      </div>
      <div className="truncate text-[10.5px] opacity-85">
        {svc} · {formatTime(r.start_at)}~{formatTime(r.end_at)}
      </div>
    </button>
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

  const dowCls = (d: string) => (dayOfWeek(d) === 0 ? 'text-[#e2574d]' : dayOfWeek(d) === 6 ? 'text-[#3b82f6]' : 'text-neutral-800');

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        {/* 요일 헤더 */}
        <div className="sticky top-0 z-10 flex border-b border-neutral-200 bg-neutral-50">
          <div className="w-[116px] shrink-0 border-r border-neutral-200 px-3.5 py-2 text-xs text-neutral-400">
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
                  <div className="text-[12px] text-neutral-400">{WEEKDAYS[(dayOfWeek(d) + 6) % 7].label}</div>
                  <div className={`text-[15px] font-bold ${dowCls(d)}`}>{dayOfMonth(d)}</div>
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
                <span className="truncate text-[13.5px] font-semibold">{dz.name}</span>
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
      className={`overflow-hidden truncate rounded-md px-1.5 py-1 text-left text-[10.5px] font-semibold leading-tight ${cancelled ? 'opacity-45 line-through' : ''}`}
      style={{
        background: requested ? '#ffffff' : color.bg,
        border: `1px ${requested ? 'dashed' : 'solid'} ${color.border}`,
        color: color.text,
      }}
      title={`${who} · ${r.design?.title ?? '시술'} · ${formatTime(r.start_at)}~${formatTime(r.end_at)}`}
    >
      {who}
      <span className="ml-1 text-[9px] font-medium opacity-80">{formatTime(r.start_at)}</span>
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
              className={`flex-1 border-r border-neutral-100 py-2.5 text-center text-[12.5px] last:border-r-0 ${
                i === 5 ? 'text-[#3b82f6]' : i === 6 ? 'text-[#e2574d]' : 'text-neutral-500'
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
                ? 'text-neutral-300'
                : dow === 0
                  ? 'text-[#e2574d]'
                  : dow === 6
                    ? 'text-[#3b82f6]'
                    : 'text-neutral-700';
              return (
                <button
                  key={cell.date}
                  onClick={() => onOpenDay(cell.date)}
                  className={`min-h-[112px] flex-1 border-r border-neutral-100 p-2.5 text-left align-top last:border-r-0 hover:bg-[#fdf4f7] ${
                    cell.inMonth ? '' : 'bg-neutral-50/60'
                  }`}
                >
                  {isToday ? (
                    <span className="inline-grid h-[22px] min-w-[22px] place-items-center rounded-full bg-brand px-1.5 text-[12px] font-bold text-white">
                      {dayOfMonth(cell.date)}
                    </span>
                  ) : (
                    <span className={`text-[13px] font-semibold ${dateColor}`}>{dayOfMonth(cell.date)}</span>
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
                      <div className="mt-1.5 text-[11px] text-neutral-400">예약 {jobs.length}</div>
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
          <div className="text-[15px] font-bold">예약 상세</div>
          <button
            onClick={close}
            className="grid h-8 w-8 place-items-center rounded-lg bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
          >
            ✕
          </button>
        </header>

        {r && (
          <div className="overflow-auto px-5 pb-5">
            <div className="mb-3 mt-0.5 flex items-center gap-2.5">
              <span className="h-3 w-3 rounded-full" style={{ background: color.border }} />
              <span className="text-[15px] font-bold">{r.user?.nickname ?? '고객'}</span>
              <span className={`ml-auto rounded-full px-2.5 py-1 text-xs font-bold ${RESERVATION_STATUS_CLS[r.status]}`}>
                {RESERVATION_STATUS_LABEL[r.status]}
              </span>
            </div>

            <Kv k="디자이너" v={r.designer?.name ?? '-'} />
            <Kv k="날짜" v={localDateOf(r.start_at).replaceAll('-', '. ')} />
            <Kv k="시간" v={`${formatTime(r.start_at)} ~ ${formatTime(r.end_at)}`} />
            <Kv k="금액" v={`${r.total_price.toLocaleString('ko-KR')}원`} />

            <div className="mb-2 mt-4 text-xs font-bold text-neutral-400">디자인</div>
            {r.design ? (
              <ReservationDesignBlock reservation={r} />
            ) : (
              <p className="text-[13px] text-neutral-400">디자인 정보가 없어요.</p>
            )}

            <div className="mb-2 mt-4 text-xs font-bold text-neutral-400">문의사항</div>
            <InquiryThread reservation={r} />
            {r.status === 'pending' && !r.owner_reply && !reasonMode && (
              <div className="mt-3">
                <label className="mb-1 block text-xs font-semibold text-neutral-500">
                  답변 (선택) — 예약 확정 시 함께 전달돼요
                </label>
                <textarea
                  rows={2}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="문의에 대한 답변을 적어주세요."
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
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
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
                />
                <div className="flex gap-2">
                  <button
                    disabled={busy || !reason.trim()}
                    onClick={doCancel}
                    className="flex-1 rounded-xl bg-[#fdeaea] py-2.5 text-[13.5px] font-bold text-[#cf3b3b] disabled:opacity-50"
                  >
                    {r.status === 'pending' ? '거절 확정' : '취소 확정'}
                  </button>
                  <button
                    onClick={() => {
                      setReasonMode(false);
                      setReason('');
                    }}
                    className="flex-1 rounded-xl bg-neutral-100 py-2.5 text-[13.5px] font-bold text-neutral-600"
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
                      className="flex-1 rounded-xl bg-brand py-2.5 text-[13.5px] font-bold text-white disabled:opacity-50"
                    >
                      {r.status === 'pending' && reply.trim() ? '답변과 함께 확정' : '예약 확정'}
                    </button>
                  )}
                  {cancellable && (
                    <button
                      disabled={busy}
                      onClick={() => setReasonMode(true)}
                      className="flex-1 rounded-xl bg-[#fdeaea] py-2.5 text-[13.5px] font-bold text-[#cf3b3b] disabled:opacity-50"
                    >
                      예약 취소
                    </button>
                  )}
                </div>
              )
            )}

            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <p className="mt-4 text-[11px] leading-relaxed text-neutral-400">
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
    <div className="flex gap-2.5 border-b border-neutral-100 py-2.5 text-[13.5px]">
      <div className="w-[68px] shrink-0 text-neutral-400">{k}</div>
      <div className="font-semibold">{v}</div>
    </div>
  );
}
