'use client';

/**
 * 일정 관리 — 8월 1~7일. 보기 모드 + "예약 가능 시간 수정" 편집 모드.
 *
 *  - 평상시(보기): 예약 가능(하양)/불가(회색) 배경 위에 우리 앱 요청/예약이 뜬다.
 *    요청(테두리)·확정(채움)을 누르면 상세(디자인·사진·타임라인·요청사항+답변·액션)가 열린다.
 *  - "예약 가능 시간 수정"을 누르면 편집 모드: 세로로 드래그해 가능 시간을 켜고 끈다. 저장 시 반영.
 *  - 일별은 디자이너 여러 명을 나란히, 주별은 한 명의 7일.
 *
 * 저장: 하루 가능창 → 스케줄 근무창, 창 안 빈틈 → 휴무(TimeOff), 빈 날 → 휴무일.
 * 스케줄/휴무는 조회 API가 없어 선택 상태·휴무 ID는 localStorage에 보관(같은 기기 기준).
 * 최초에는 10:00~22:00을 기본으로 채워 보여준다(저장 눌러야 snail 앱에 반영).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { designersApi, reservationsApi } from '@/services';
import type { Reservation, ReservationStatus, ScheduleEntry, TimeOffCreate } from '@/services';
import { collectAll } from '@/lib/api-client';
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
  availDayToScheduleAndTimeOff,
  dateShortLabel,
  localDateOf,
  localMinOf,
  minToTime,
  slotStartMin,
} from '@/lib/beta-schedule';

const HOLDING: ReservationStatus[] = ['pending', 'payment_pending', 'confirmed', 'completed'];
const ROW_H = 36;
const GRID_H = (DAY_MINUTES / 60) * ROW_H;

const availKey = (id: string) => `snail_beta_avail:${id}`;
const tidKey = (id: string) => `snail_beta_tid:${id}`;
const cell = (date: string, slot: number) => `${date}|${slot}`;

/** 최초 기본 가용시간: 매일 10:00~22:00 */
function defaultAvail(): Set<string> {
  const set = new Set<string>();
  const from = (10 * 60 - DAY_START_MIN) / 30; // 10:00
  for (const date of BETA_DATES) for (let i = from; i < SLOTS_PER_DAY; i += 1) set.add(cell(date, i));
  return set;
}

/** localStorage에서 디자이너 가용시간 로드(키 없으면 기본값 시드) */
function loadAvail(id: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  const raw = window.localStorage.getItem(availKey(id));
  if (raw === null) return defaultAvail();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return defaultAvail();
  }
}
function loadIds(id: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(window.localStorage.getItem(tidKey(id)) ?? '[]') as string[];
  } catch {
    return [];
  }
}

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
  const [view, setView] = useState<'day' | 'week'>('day');
  const [dayIdx, setDayIdx] = useState(0);
  const [weekDesignerId, setWeekDesignerId] = useState<string | null>(null);
  const [availBy, setAvailBy] = useState<Record<string, Set<string>>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [detailRes, setDetailRes] = useState<Reservation | null>(null);
  const drag = useRef<{ el: HTMLElement; designerId: string; date: string; anchor: number; mode: 'paint' | 'erase'; snapshot: Set<string> } | null>(null);

  const designersQuery = useQuery({ queryKey: ['designers'], queryFn: () => designersApi.listDesigners() });
  const designers = useMemo(() => designersQuery.data ?? [], [designersQuery.data]);

  useEffect(() => {
    if (!weekDesignerId && designers.length > 0) setWeekDesignerId(designers[0].id);
  }, [designers, weekDesignerId]);

  const reloadAvail = () => {
    const map: Record<string, Set<string>> = {};
    for (const d of designers) map[d.id] = loadAvail(d.id);
    setAvailBy(map);
  };
  useEffect(() => {
    if (designers.length > 0) reloadAvail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designers]);

  const reservationsQuery = useQuery({
    queryKey: ['reservations', 'beta-schedule'],
    queryFn: () =>
      collectAll<Reservation>((cursor) =>
        reservationsApi.listReservations({ from: BETA_DATES[0], to: BETA_DATES[6], limit: 50, cursor }),
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
        const entries: ScheduleEntry[] = [];
        const timeOffPayloads: TimeOffCreate[] = [];
        for (const date of BETA_DATES) {
          const slots = new Set<number>();
          for (let i = 0; i < SLOTS_PER_DAY; i += 1) if (set.has(cell(date, i))) slots.add(i);
          const { entry, timeOffs } = availDayToScheduleAndTimeOff(date, slots);
          entries.push(entry);
          timeOffPayloads.push(...timeOffs);
        }
        for (const id of loadIds(d.id)) {
          try {
            await designersApi.deleteTimeOff(d.id, id);
          } catch {
            /* 무시 */
          }
        }
        await designersApi.setSchedule(d.id, { entries });
        const newIds: string[] = [];
        for (const p of timeOffPayloads) {
          const created = await designersApi.addTimeOff(d.id, p);
          if (created?.id) newIds.push(created.id);
        }
        window.localStorage.setItem(availKey(d.id), JSON.stringify([...set]));
        window.localStorage.setItem(tidKey(d.id), JSON.stringify(newIds));
      }
      setEditing(false);
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
      ? designers.map((d) => ({ designerId: d.id, date: BETA_DATES[dayIdx], label: d.name }))
      : BETA_DATES.map((date) => ({
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
          <h1 className="text-heading-md font-bold text-primary">일정 관리</h1>
          <p className="mt-0.5 text-caption text-primary-50">
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

      {view === 'day' ? (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setDayIdx((i) => Math.max(0, i - 1))}
            disabled={dayIdx === 0}
            className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 text-primary-50 disabled:opacity-30"
          >
            ‹
          </button>
          <div className="min-w-[110px] text-center text-body-sm font-bold text-primary">
            {dateShortLabel(BETA_DATES[dayIdx])}
          </div>
          <button
            onClick={() => setDayIdx((i) => Math.min(BETA_DATES.length - 1, i + 1))}
            disabled={dayIdx === BETA_DATES.length - 1}
            className="grid h-8 w-8 place-items-center rounded-lg border border-neutral-200 text-primary-50 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      ) : (
        designers.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
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
        )
      )}

      {/* 범례 + 수정 버튼 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-caption text-primary-50">
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm border border-neutral-300 bg-white" /> 가능
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-neutral-200" /> 불가
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
                className={`flex-1 truncate border-r border-neutral-100 px-1 py-1.5 text-center text-[11px] font-bold leading-tight last:border-r-0 ${
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
                  <span className="absolute right-1 -top-1.5 text-[9px] text-primary-50">{h}</span>
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
                  className={`relative flex-1 border-r border-neutral-100 bg-neutral-200 last:border-r-0 ${editing ? 'touch-pan-x cursor-pointer' : ''}`}
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
                      compact={view === 'week'}
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
  compact,
  editing,
  onClick,
}: {
  item: ResBarItem;
  compact: boolean;
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
      className={`absolute inset-x-0.5 overflow-hidden rounded-lg border px-1.5 py-1 text-left leading-tight shadow-sm ${
        editing ? 'opacity-70' : ''
      }`}
      style={{ top: `${top}%`, height: `${Math.max(height, 5)}%`, ...style }}
      title={`${name} · ${design} ${minToTime(startMin)}~${minToTime(endMin)}`}
    >
      <div className="flex items-center gap-1">
        <span className="truncate text-[10px] font-bold">{name}</span>
        {pending && (
          <span
            className="shrink-0 rounded px-1 py-px text-[8px] font-bold text-white"
            style={{ background: 'var(--color-warning)' }}
          >
            요청
          </span>
        )}
        {completed && (
          <span
            className="shrink-0 rounded px-1 py-px text-[8px] font-bold text-white"
            style={{ background: 'var(--color-primary-50)' }}
          >
            완료
          </span>
        )}
      </div>
      {!compact && (
        <span className="mt-0.5 block truncate text-[9px] font-medium opacity-90">
          {design} · {minToTime(startMin)}~{minToTime(endMin)}
        </span>
      )}
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
