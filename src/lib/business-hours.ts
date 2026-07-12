/**
 * 샵 영업시간 편집 모델 · 헬퍼.
 *
 * 화면 모델(BusinessHoursValue): 기본 영업시간(base) + 요일별 7일(days).
 *   - 기본 시간을 바꾸면 "직전 base와 같던" 요일만 따라 바뀌고, 개별 조정한 요일은 유지한다.
 *   - 요일별로 휴무 토글 가능.
 * 시간은 09:00~22:00 · 30분 격자(일정 탭 달력 눈금과 일치)로 보정한다.
 *
 * 백엔드: PUT /shops/me/business-hours 는 BusinessHourEntry 7건. GET은 없고 ShopMe.business_hours 로 되읽는다.
 */
import { WEEKDAYS, TIME_RE } from './weekday';
import type { BusinessHourEntry } from '@/services';

/** 시간 격자: 09:00~22:00, 30분 */
export const GRID_START_MIN = 9 * 60;
export const GRID_END_MIN = 22 * 60;
export const GRID_STEP_MIN = 30;

export const DEFAULT_OPEN = '10:00';
export const DEFAULT_CLOSE = '20:00';

export function minToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function timeToMin(t: string): number | null {
  if (!TIME_RE.test(t.trim())) return null;
  const [h, m] = t.trim().split(':').map(Number);
  return h * 60 + m;
}

/** 백엔드가 돌려주는 "HH:MM:SS"(초 포함)를 "HH:MM"으로 정규화. 형식 이상/빈값이면 null. */
export function hhmm(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

/** 09:00~22:00, 30분 간격 시간 문자열(드롭다운 목록/보정용). */
export const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let m = GRID_START_MIN; m <= GRID_END_MIN; m += GRID_STEP_MIN) out.push(minToTime(m));
  return out;
})();

/** 입력 문자열을 09:00~22:00 · 30분 격자에 맞춰 보정한다. 형식 이상이면 fallback. */
export function snapToGrid(t: string, fallback: string): string {
  const min = timeToMin(t);
  if (min === null) return fallback;
  const clamped = Math.max(GRID_START_MIN, Math.min(GRID_END_MIN, min));
  const snapped = Math.round(clamped / GRID_STEP_MIN) * GRID_STEP_MIN;
  return minToTime(snapped);
}

export interface DayHours {
  weekday: number;
  open: string;
  close: string;
  closed: boolean;
}
export interface BusinessHoursValue {
  base: { open: string; close: string };
  days: DayHours[]; // 항상 7일(weekday 0..6, 월~일)
}

export function defaultBusinessHours(): BusinessHoursValue {
  return {
    base: { open: DEFAULT_OPEN, close: DEFAULT_CLOSE },
    days: WEEKDAYS.map((w) => ({ weekday: w.value, open: DEFAULT_OPEN, close: DEFAULT_CLOSE, closed: false })),
  };
}

/** 필드 값 → 백엔드 업로드용 엔트리 7건. */
export function toEntries(v: BusinessHoursValue): BusinessHourEntry[] {
  return v.days.map((d) => ({
    weekday: d.weekday,
    is_closed: d.closed,
    open_time: d.closed ? null : d.open,
    close_time: d.closed ? null : d.close,
  }));
}

/** 백엔드 엔트리 → 필드 값. base는 열린 날들의 최빈 open/close에서 추론한다. */
export function fromEntries(entries?: BusinessHourEntry[] | null): BusinessHoursValue {
  if (!entries || entries.length === 0) return defaultBusinessHours();
  const byWeekday = new Map<number, BusinessHourEntry>();
  for (const e of entries) byWeekday.set(e.weekday, e);

  const count = (pick: (e: BusinessHourEntry) => string | null | undefined) => {
    const m = new Map<string, number>();
    for (const e of entries) {
      if (e.is_closed) continue;
      const v = hhmm(pick(e));
      if (v) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  };
  const mostCommon = (m: Map<string, number>, fb: string) =>
    [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fb;
  const base = {
    open: mostCommon(count((e) => e.open_time), DEFAULT_OPEN),
    close: mostCommon(count((e) => e.close_time), DEFAULT_CLOSE),
  };

  const days = WEEKDAYS.map((w) => {
    const e = byWeekday.get(w.value);
    if (!e) return { weekday: w.value, open: base.open, close: base.close, closed: false };
    return {
      weekday: w.value,
      open: hhmm(e.open_time) ?? base.open,
      close: hhmm(e.close_time) ?? base.close,
      closed: !!e.is_closed,
    };
  });
  return { base, days };
}
