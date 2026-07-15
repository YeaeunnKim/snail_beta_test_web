'use client';

/**
 * 일정 관리 — 오늘부터 다음달 말까지, 7일 단위 보기. 보기 모드 + "예약 가능 시간 수정" 편집 모드.
 *
 *  - 평상시(보기): 예약 가능(하양)/불가(회색) 배경 위에 우리 앱 요청/예약이 뜬다.
 *    요청(테두리)·확정(채움)을 누르면 상세(디자인·사진·타임라인·요청사항+답변·액션)가 열린다.
 *  - "예약 가능 시간 수정"을 누르면 편집 모드: 세로로 드래그해 가능 시간을 켜고 끈다. 저장 시 반영.
 *  - 일별은 디자이너 여러 명을 나란히, 주별은 한 명의 7일.
 *
 * 저장: 날짜별 선택을 요일별 주간 스케줄 7건으로 집계(요일 근무창=그 요일 켠 시간의 합집합 외곽).
 *   한 주만 칠해도 같은 요일의 나머지 주가 그 근무창을 상속해 예약 가능으로 유지된다(주간 반복 패턴).
 *   근무창 안을 "일부만" 켠 날짜의 빈틈만 날짜별 휴무(TimeOff)로 내려보낸다(백엔드 스케줄은 요일 반복 패턴).
 * 현재 상태는 서버(스케줄·휴무 조회 API)에서 불러와 재구성하므로 기기가 달라도 일관된다.
 * 서버에 저장 이력이 없으면 샵 영업시간을 기본으로 채워 보여준다(저장 눌러야 snail 앱에 반영).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { designersApi, reservationsApi } from '@/services';
import type { Reservation, ReservationStatus, ScheduleEntry, TimeOff } from '@/services';
import { collectAll, pooledMap } from '@/lib/api-client';
import { toUserMessage } from '@/lib/error-messages';
import { ReservationDetail } from '@/components/reservation-detail';
import {
  BETA_DATES,
  DAY_MINUTES,
  DAY_START_MIN,
  DAY_END_MIN,
  HOURS,
  SLOTS_PER_DAY,
  appWeekday,
  availToWeeklyScheduleAndTimeOff,
  businessHoursSeed,
  serverToAvailSet,
  dateShortLabel,
  endOfNextMonth,
  localDateOf,
  localMinOf,
  minToTime,
  slotStartMin,
  weekDatesFor,
} from '@/lib/beta-schedule';
import { todayLocalDate, shiftLocalDate } from '@/lib/date';
import { useMyShop } from '@/hooks/use-my-shop';

const HOLDING: ReservationStatus[] = ['pending', 'payment_pending', 'confirmed', 'completed'];
/** 저장 시 휴무 생성/삭제 동시 실행 상한(서버 과부하 방지) */
const WRITE_POOL = 6;
const ROW_H = 36;
const GRID_H = (DAY_MINUTES / 60) * ROW_H;

const cell = (date: string, slot: number) => `${date}|${slot}`;
const SCHEDULE_RANGE = { from: BETA_DATES[0], to: BETA_DATES[BETA_DATES.length - 1] };

const clampMin = (m: number) => Math.min(DAY_END_MIN, Math.max(DAY_START_MIN, m));

function availRanges(set: Set<string>, date: string): { startMin: number; endMin: number }[] {
  const on = Array.from({ length: SLOTS_PER_DAY }, (_, i) => set.has(cell(date, i)));
  const out: { startMin: number; endMin: number }[] = [];
  let s: number | null = null;
  for (let i = 0; i <= SLOTS_PER_DAY; i += 1) {
    if (i < SLOTS_PER_DAY && on[i]) {
      if (s === null) s = i;
    } else if (s !== null) {
      out.push({ startMin: slotStartMin(s), endMin: slotStartMin(i) });
      s = null;
    }
  }
  return out;
}

interface ResBarItem {
  res: Reservation;
  startMin: number;
  endMin: number;
}
function resBarsFor(reservations: Reservation[], designerId: string, date: string): ResBarItem[] {
  return reservations
    .filter((r) => r.designer_id === designerId && HOLDING.includes(r.status) && localDateOf(r.start_at) === date)
    .map((r) => ({ res: r, startMin: clampMin(localMinOf(r.start_at)), endMin: clampMin(localMinOf(r.end_at)) }));
}

export default function SchedulePage() {
  const [view, setView] = useState<'day' | 'week'>('week');
  const [weekStartDate, setWeekStartDate] = useState(todayLocalDate());
  const [dayIdx, setDayIdx] = useState(0);
  const [weekDesignerId, setWeekDesignerId] = useState<string | null>(null);
  const [availBy, setAvailBy] = useState<Record<string, Set<string>>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [detailRes, setDetailRes] = useState<Reservation | null>(null);
  const drag = useRef<{ el: HTMLElement; designerId: string; date: string; anchor: number; mode: 'paint' | 'erase'; snapshot: Set<string> } | null>(null);

  const qc = useQueryClient();
  const designersQuery = useQuery({ queryKey: ['designers'], queryFn: () => designersApi.listDesigners() });
  const designers = useMemo(() => designersQuery.data ?? [], [designersQuery.data]);
  const designerIds = useMemo(() => designers.map((d) => d.id).join(','), [designers]);

  // 샵 영업시간 → 저장 이력이 없는 디자이너의 하얀칸 기본값(seed).
  const shopQuery = useMyShop();
  const seedSet = useMemo(
    () => businessHoursSeed(shopQuery.data?.business_hours),
    [shopQuery.data?.business_hours],
  );

  // 서버의 현재 스케줄·휴무를 디자이너별로 조회(기기 무관 일관성). 캐시 삭제 걱정 없음.
  const scheduleQuery = useQuery({
    queryKey: ['designer-schedules', designerIds],
    enabled: designers.length > 0,
    queryFn: async () => {
      const map: Record<string, { schedule: ScheduleEntry[]; timeOffs: TimeOff[] }> = {};
      await Promise.all(
        designers.map(async (d) => {
          const [schedule, timeOffs] = await Promise.all([
            designersApi.getSchedule(d.id),
            designersApi.listTimeOff(d.id, SCHEDULE_RANGE),
          ]);
          map[d.id] = { schedule, timeOffs };
        }),
      );
      return map;
    },
  });

  useEffect(() => {
    if (!weekDesignerId && designers.length > 0) setWeekDesignerId(designers[0].id);
  }, [designers, weekDesignerId]);

  // 서버 스케줄이 있으면 재구성, 없으면(미저장) 영업시간 기본값(seed).
  const reloadAvail = useCallback(() => {
    const server = scheduleQuery.data;
    const map: Record<string, Set<string>> = {};
    for (const d of designers) {
      const entry = server?.[d.id];
      map[d.id] =
        entry && entry.schedule.length > 0
          ? serverToAvailSet(BETA_DATES, entry.schedule, entry.timeOffs)
          : new Set(seedSet);
    }
    setAvailBy(map);
  }, [designers, scheduleQuery.data, seedSet]);

  // 편집 중에는 서버 재조회가 사용자의 미저장 편집을 덮어쓰지 않도록 막는다.
  useEffect(() => {
    if (designers.length > 0 && !editing) reloadAvail();
  }, [reloadAvail, designers.length, editing]);

  const visibleDates = useMemo(() => weekDatesFor(weekStartDate), [weekStartDate]);
  const maxWeekStartDate = useMemo(() => shiftLocalDate(endOfNextMonth(todayLocalDate()), -6), []);
  const canMovePrevWeek = weekStartDate > todayLocalDate();
  const canMoveNextWeek = shiftLocalDate(weekStartDate, 7) <= maxWeekStartDate;

  const reservationsQuery = useQuery({
    queryKey: ['reservations', 'beta-schedule', weekStartDate],
    queryFn: () =>
      collectAll<Reservation>((cursor) =>
        reservationsApi.listReservations({ from: visibleDates[0], to: visibleDates[visibleDates.length - 1], limit: 50, cursor }),
      ),
  });
  const reservations = useMemo(() => reservationsQuery.data ?? [], [reservationsQuery.data]);

  // ── 편집: 드래그로 가용시간 칠하기 ──
  const slotFromEvent = (el: HTMLElement, clientY: number) => {
    const rect = el.getBoundingClientRect();
    const raw = ((clientY - rect.top) / rect.height) * SLOTS_PER_DAY;
    return Math.min(SLOTS_PER_DAY - 1, Math.max(0, Math.floor(raw)));
  };
  // 예약이 이미 잡힌 슬롯 인덱스(예약된 시간은 예약불가로 바꿀 수 없다)
  const reservedSlots = (designerId: string, date: string): Set<number> => {
    const set = new Set<number>();
    for (const b of resBarsFor(reservations, designerId, date)) {
      for (let i = 0; i < SLOTS_PER_DAY; i += 1) {
        if (slotStartMin(i) < b.endMin && slotStartMin(i + 1) > b.startMin) set.add(i);
      }
    }
    return set;
  };
  const applyRange = (designerId: string, date: string, anchor: number, cur: number, mode: 'paint' | 'erase', snapshot: Set<string>) => {
    const lo = Math.min(anchor, cur);
    const hi = Math.max(anchor, cur);
    const reserved = mode === 'erase' ? reservedSlots(designerId, date) : null;
    const next = new Set(snapshot);
    for (let i = lo; i <= hi; i += 1) {
      const k = cell(date, i);
      if (mode === 'paint') next.add(k);
      else if (!reserved?.has(i)) next.delete(k); // 예약된 슬롯은 지우지 않음(항상 예약가능 유지)
    }
    setAvailBy((prev) => ({ ...prev, [designerId]: next }));
  };
  const onDown = (designerId: string, date: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editing) return;
    const el = e.currentTarget;
    const anchor = slotFromEvent(el, e.clientY);
    const snapshot = availBy[designerId] ?? new Set<string>();
    const mode: 'paint' | 'erase' = snapshot.has(cell(date, anchor)) ? 'erase' : 'paint';
    drag.current = { el, designerId, date, anchor, mode, snapshot: new Set(snapshot) };
    el.setPointerCapture(e.pointerId);
    applyRange(designerId, date, anchor, anchor, mode, drag.current.snapshot);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    applyRange(d.designerId, d.date, d.anchor, slotFromEvent(d.el, e.clientY), d.mode, d.snapshot);
  };
  const onUp = () => {
    drag.current = null;
  };

  const startEdit = () => {
    setMessage(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    reloadAvail(); // 저장 안 한 변경 되돌리기
    setEditing(false);
    setMessage(null);
  };

  const onSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      for (const d of designers) {
        const set = availBy[d.id] ?? new Set<string>();
        // 날짜별 선택을 요일별 주간 스케줄 7건 + 날짜별 휴무로 집계(백엔드 계약: entries 요일별 7건).
        const { entries, timeOffs } = availToWeeklyScheduleAndTimeOff(BETA_DATES, (date, slot) =>
          set.has(cell(date, slot)),
        );

        // 1) 관리 범위(BETA_DATES) 안의 기존 휴무를 서버에서 조회해 삭제(범위 밖 휴무는 보존).
        //    localStorage 대신 서버가 출처라, 부분 실패로 남은 고아 휴무도 다음 저장 때 함께 정리된다.
        const existing = await designersApi.listTimeOff(d.id, SCHEDULE_RANGE);
        await pooledMap(existing, WRITE_POOL, (t) =>
          designersApi.deleteTimeOff(d.id, t.id).catch(() => undefined),
        );

        // 2) 주간 스케줄 설정(요일별 7건).
        await designersApi.setSchedule(d.id, { entries });

        // 3) 새 휴무 추가 — 동시성 제한 병렬.
        await pooledMap(timeOffs, WRITE_POOL, (p) => designersApi.addTimeOff(d.id, p));
      }
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ['designer-schedules'] });
      setMessage({ type: 'ok', text: '저장했어요. 하얀 시간이 snail 앱에 예약 가능 시간으로 노출됩니다.' });
    } catch (e) {
      setMessage({ type: 'err', text: toUserMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  if (designersQuery.isLoading) {
    return <p className="py-12 text-center text-body-sm text-primary-50">불러오는 중…</p>;
  }
  if (designers.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-body-sm text-primary-50">
        등록된 디자이너가 없어요. 샵 설정을 먼저 완료해주세요.
      </p>
    );
  }

  const columns: { designerId: string; date: string; label: string; danger?: boolean }[] =
    view === 'day'
      ? designers.map((d) => ({ designerId: d.id, date: visibleDates[dayIdx], label: d.name }))
      : visibleDates.map((date) => ({
          designerId: weekDesignerId ?? designers[0].id,
          date,
          label: dateShortLabel(date),
          danger: appWeekday(date) >= 5,
        }));
  const colMinW = view === 'day' ? Math.max(64, Math.floor(360 / Math.max(1, designers.length))) : 48;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-heading-lg font-bold text-primary">일정 관리</h1>
          <p className="mt-1 text-body-sm text-primary-50">
            {editing ? '세로로 드래그해 예약 가능 시간을 켜고 끄세요.' : '요청·예약을 누르면 상세가 열려요.'}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-neutral-100 p-1">
          {(['day', 'week'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-caption font-semibold ${
                view === v ? 'bg-white text-primary shadow-sm' : 'text-primary-50'
              }`}
            >
              {v === 'day' ? '일별' : '주별'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setWeekStartDate((d) => shiftLocalDate(d, -7))}
            disabled={!canMovePrevWeek}
            className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 text-primary-50 disabled:opacity-30"
            title="이전 주"
          >
            «
          </button>
          {view === 'day' ? (
            <>
              <button
                onClick={() => setDayIdx((i) => Math.max(0, i - 1))}
                disabled={dayIdx === 0}
                className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 text-primary-50 disabled:opacity-30"
              >
                ‹
              </button>
              <div className="min-w-[140px] text-center text-body-sm font-bold text-primary">
                {`${dateShortLabel(visibleDates[dayIdx])} · ${dateShortLabel(visibleDates[0])}~${dateShortLabel(visibleDates[visibleDates.length - 1])}`}
              </div>
              <button
                onClick={() => setDayIdx((i) => Math.min(visibleDates.length - 1, i + 1))}
                disabled={dayIdx === visibleDates.length - 1}
                className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 text-primary-50 disabled:opacity-30"
              >
                ›
              </button>
            </>
          ) : (
            <div className="min-w-[160px] text-center text-body-sm font-bold text-primary">
              {`${dateShortLabel(visibleDates[0])}~${dateShortLabel(visibleDates[visibleDates.length - 1])}`}
            </div>
          )}
          <button
            onClick={() => setWeekStartDate((d) => shiftLocalDate(d, 7))}
            disabled={!canMoveNextWeek}
            className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 text-primary-50 disabled:opacity-30"
            title="다음 주"
          >
            »
          </button>
        </div>
        {view === 'week' && designers.length > 1 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {designers.map((d) => (
              <button
                key={d.id}
                onClick={() => setWeekDesignerId(d.id)}
                className={`rounded-full border px-3 py-1 text-caption font-semibold ${
                  d.id === weekDesignerId ? 'border-secondary bg-secondary text-white' : 'border-neutral-300 text-primary'
                }`}
              >
                {d.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 범례 + 수정 버튼 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-caption text-primary-50">
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm border border-neutral-300 bg-white" /> 가능
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-neutral-400" /> 불가
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm border border-warning bg-warning-bg" /> 요청
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-success" /> 확정
          </span>
        </div>
        {!editing && (
          <button
            onClick={startEdit}
            className="shrink-0 rounded-lg border border-secondary px-3 py-1.5 text-caption font-semibold text-secondary"
          >
            ✏️ 예약 가능 시간 수정
          </button>
        )}
      </div>

      {message && (
        <p
          className={`rounded-md px-3 py-2 text-caption ${
            message.type === 'ok' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
          }`}
        >
          {message.text}
        </p>
      )}

      {/* 달력 */}
      <div
        className={`overflow-x-auto rounded-xl border ${editing ? 'border-secondary ring-1 ring-secondary/30' : 'border-neutral-200'}`}
      >
        <div style={{ minWidth: 36 + columns.length * colMinW }}>
          <div className="flex border-b border-neutral-200 bg-neutral-50">
            <div className="w-9 shrink-0 border-r border-neutral-200" />
            {columns.map((c, i) => (
              <div
                key={`${c.designerId}-${c.date}-${i}`}
                className={`flex-1 truncate border-r border-neutral-100 px-1 py-1.5 text-center text-caption font-bold leading-tight last:border-r-0 ${
                  c.danger ? 'text-danger' : 'text-primary'
                }`}
                style={{ minWidth: colMinW }}
              >
                {c.label}
              </div>
            ))}
          </div>

          <div className="flex">
            <div className="w-9 shrink-0 border-r border-neutral-200" style={{ height: GRID_H }}>
              {HOURS.slice(0, -1).map((h) => (
                <div key={h} className="relative border-b border-neutral-100" style={{ height: ROW_H }}>
                  <span className="absolute right-1 -top-1.5 text-caption text-primary-50">{h}</span>
                </div>
              ))}
            </div>

            {columns.map((c, i) => {
              const set = availBy[c.designerId] ?? new Set<string>();
              const ranges = availRanges(set, c.date);
              const bars = resBarsFor(reservations, c.designerId, c.date);
              return (
                <div
                  key={`${c.designerId}-${c.date}-${i}`}
                  className={`relative flex-1 border-r border-neutral-100 bg-neutral-400 last:border-r-0 ${editing ? 'touch-pan-x cursor-pointer' : ''}`}
                  style={{ height: GRID_H, minWidth: colMinW }}
                  onPointerDown={editing ? onDown(c.designerId, c.date) : undefined}
                  onPointerMove={editing ? onMove : undefined}
                  onPointerUp={editing ? onUp : undefined}
                >
                  {ranges.map((r) => (
                    <div
                      key={r.startMin}
                      className="pointer-events-none absolute inset-x-0 bg-white"
                      style={{
                        top: `${((r.startMin - DAY_START_MIN) / DAY_MINUTES) * 100}%`,
                        height: `${((r.endMin - r.startMin) / DAY_MINUTES) * 100}%`,
                      }}
                    />
                  ))}
                  {HOURS.slice(1, -1).map((h) => (
                    <div
                      key={h}
                      className="pointer-events-none absolute inset-x-0 border-t border-neutral-100"
                      style={{ top: `${((h * 60 - DAY_START_MIN) / DAY_MINUTES) * 100}%` }}
                    />
                  ))}
                  {bars.map((b) => (
                    <ResBar
                      key={b.res.id}
                      item={b}
                      editing={editing}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!editing) setDetailRes(b.res);
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="text-caption text-primary-50">
        {editing
          ? '드래그로 켠 하얀 시간이 저장 후 snail 앱 예약 가능 시간으로 노출됩니다.'
          : '요청이 들어오면 가능 시간 위에 테두리로 떠요. 눌러서 확정하면 초록으로 채워집니다.'}
      </p>

      {/* 편집 저장 바 */}
      {editing && (
        <div className="sticky bottom-16 z-10 flex items-center gap-2 rounded-xl border border-secondary bg-white/95 p-2 shadow-sm backdrop-blur">
          <button onClick={cancelEdit} className="rounded-lg bg-neutral-100 px-4 py-2 text-caption font-bold text-primary">
            취소
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="ml-auto rounded-lg bg-secondary px-5 py-2 text-body-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      )}

      {/* 상세(보기 모드) */}
      {detailRes && <DetailModal reservation={detailRes} onClose={() => setDetailRes(null)} />}
    </div>
  );
}

/* ── 요청/예약 바 ── */

function ResBar({
  item,
  editing,
  onClick,
}: {
  item: ResBarItem;
  editing: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const { res: r, startMin, endMin } = item;
  const pending = r.status === 'pending' || r.status === 'payment_pending';
  const completed = r.status === 'completed';
  const name = r.user?.nickname ?? '고객';
  const design = r.design?.title ?? '시술';
  const top = ((startMin - DAY_START_MIN) / DAY_MINUTES) * 100;
  const height = ((endMin - startMin) / DAY_MINUTES) * 100;
  const style: Record<string, string> = completed
    ? { background: 'var(--color-primary-10)', color: 'var(--color-primary-50)', borderColor: '#d6d3ce' }
    : pending
      ? { background: 'var(--color-warning-bg)', color: 'var(--color-warning)', borderColor: 'var(--color-warning)' }
      : { background: 'var(--color-success)', color: '#ffffff', borderColor: 'var(--color-success)' };
  return (
    <button
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className={`absolute inset-x-0 flex items-center justify-center overflow-hidden border px-1.5 py-1 leading-tight ${
        editing ? 'opacity-70' : ''
      }`}
      style={{ top: `${top}%`, height: `${Math.max(height, 5)}%`, ...style }}
      title={`${name} · ${design} ${minToTime(startMin)}~${minToTime(endMin)}`}
    >
      <span className="truncate text-center text-caption font-semibold">{name}</span>
    </button>
  );
}

/* ── 상세 모달(전체 상세 재사용) ── */

function DetailModal({ reservation, onClose }: { reservation: Reservation; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85vh] max-w-md flex-col rounded-t-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-body-md font-bold text-primary">{reservation.user?.nickname ?? '고객'} 예약 상세</h2>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg bg-neutral-100 text-primary-50">
            ✕
          </button>
        </div>
        <div className="overflow-auto">
          {/* 액션 성공 시 목록이 갱신되고 모달을 닫는다. */}
          <ReservationDetail reservation={reservation} onChanged={onClose} />
        </div>
      </div>
    </>
  );
}
