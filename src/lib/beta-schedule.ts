/**
 * 베타 일정 헬퍼 — 오늘부터 다음달 말까지, 일/주 달력. 30분 단위.
 *
 * 모델(영업시간 기본 + 휴무 차감): **예약 가능의 기본값 = 샵 영업시간**이다.
 * 영업시간 안에서 예약이 안 잡혀 있으면 기본 예약 가능(하양). 드래그는 그 위에 **휴무(예약 불가)**를 칠한다.
 *   - 요일 스케줄(ScheduleEntry) = 샵 영업시간(영업하는 요일 → 시작~종료, 닫는 요일 → is_day_off).
 *   - 드래그로 막은(예약 불가로 칠한) 영업시간 안 구간 → 그 날짜의 휴무(TimeOff).
 *   - 영업시간 밖은 애초에 예약 불가(달력에서 '영업 외'). 아무것도 안 막은 날은 영업시간 전체 예약 가능.
 * 오늘부터 다음달 말까지의 날짜 범위를 기준으로 일/주 달력을 관리한다.
 *
 * 우리 앱 예약은 백엔드가 가용시간 계산 시 자동 제외한다. 현재 상태(스케줄/휴무)는 서버에서
 * 불러와 재구성하므로 기기가 달라도 일관된다.
 */
import type { BusinessHourEntry, ScheduleEntry, TimeOff, TimeOffCreate } from '@/services';
import { shiftLocalDate, todayLocalDate } from './date';

function dayDiff(start: string, end: string): number {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const startDate = new Date(sy, sm - 1, sd);
  const endDate = new Date(ey, em - 1, ed);
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
}

export function endOfNextMonth(date: string = todayLocalDate()): string {
  const [y, m] = date.split('-').map(Number);
  return todayLocalDate(new Date(y, m + 1, 0));
}

export function buildScheduleDates(startDate: string = todayLocalDate()): string[] {
  const endDate = endOfNextMonth(startDate);
  return Array.from({ length: dayDiff(startDate, endDate) + 1 }, (_, i) => shiftLocalDate(startDate, i));
}

export function weekDatesFor(date: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftLocalDate(date, i));
}

/** 일정 관리 대상 날짜(오늘부터 다음달 말까지) */
export const BETA_DATES = buildScheduleDates();

export type BetaDate = (typeof BETA_DATES)[number];

/** 달력 시간축 (09:00 ~ 22:00) */
export const DAY_START_MIN = 9 * 60; // 540
export const DAY_END_MIN = 22 * 60; // 1320
export const DAY_MINUTES = DAY_END_MIN - DAY_START_MIN; // 780
/** 정시 라벨용 시(hour) 배열: 9,10,...,22 */
export const HOURS = Array.from({ length: DAY_MINUTES / 60 + 1 }, (_, i) => 9 + i);

/** 가용시간 선택 단위 (분) */
export const SLOT_MIN = 30;
export const SLOTS_PER_DAY = DAY_MINUTES / SLOT_MIN; // 26

/** 슬롯 인덱스(0..) → 0시 기준 시작 분 */
export function slotStartMin(i: number): number {
  return DAY_START_MIN + i * SLOT_MIN;
}

/** "HH:MM" → 0시 기준 분 (형식 아니면 null) */
export function timeToMin(t: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 0시 기준 분 → "HH:MM" */
export function minToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** 날짜 문자열 → 앱 요일(0=월 … 6=일) */
export function appWeekday(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  return (d.getDay() + 6) % 7;
}

const WD_LABEL = ['월', '화', '수', '목', '금', '토', '일'];

/** "8/1 (금)" */
export function dateShortLabel(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}/${Number(d)} (${WD_LABEL[appWeekday(dateStr)]})`;
}

/** ISO datetime → 로컬 "YYYY-MM-DD" */
export function localDateOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO datetime → 로컬 0시 기준 분 */
export function localMinOf(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * 샵 영업시간(business_hours) → 베타 7일의 기본 "예약 가능" 슬롯 집합.
 * 각 날짜의 요일 영업시간(여는~닫는) 안의 30분 슬롯을 켠다. 휴무일/시간없음은 비운다.
 * 아직 일정을 저장하지 않은 디자이너의 하얀칸 기본값으로 쓰인다. 반환 키 형식: `YYYY-MM-DD|slot`.
 */
export function businessHoursSeed(entries?: BusinessHourEntry[] | null): Set<string> {
  const set = new Set<string>();
  if (!entries || entries.length === 0) return set;
  const byWeekday = new Map<number, BusinessHourEntry>();
  for (const e of entries) byWeekday.set(e.weekday, e);
  for (const date of BETA_DATES) {
    const e = byWeekday.get(appWeekday(date));
    if (!e || e.is_closed || !e.open_time || !e.close_time) continue;
    // 백엔드는 "HH:MM:SS"로 줄 수 있어 앞 5자리("HH:MM")만 파싱한다.
    const openMin = timeToMin(e.open_time.slice(0, 5));
    const closeMin = timeToMin(e.close_time.slice(0, 5));
    if (openMin === null || closeMin === null) continue;
    for (let i = 0; i < SLOTS_PER_DAY; i += 1) {
      const s = slotStartMin(i);
      if (s >= openMin && s < closeMin) set.add(`${date}|${i}`);
    }
  }
  return set;
}

/**
 * 요일별 영업시간(business_hours) → 그 요일의 예약 가능 근무창(분 단위, 그리드 09:00~22:00로 클램프).
 * 닫힌 요일 / 시간 없음 / 파싱 실패 / 범위 밖이면 null(=영업 안 함).
 * seed(businessHoursSeed)의 슬롯 포함 규칙과 동일한 창을 만든다.
 */
function businessWindowMin(
  byWeekday: Map<number, BusinessHourEntry>,
  weekday: number,
): { startMin: number; endMin: number } | null {
  const e = byWeekday.get(weekday);
  if (!e || e.is_closed || !e.open_time || !e.close_time) return null;
  const open = timeToMin(e.open_time.slice(0, 5));
  const close = timeToMin(e.close_time.slice(0, 5));
  if (open === null || close === null) return null;
  const startMin = Math.max(open, DAY_START_MIN);
  const endMin = Math.min(close, DAY_END_MIN);
  if (startMin >= endMin) return null;
  return { startMin, endMin };
}

/**
 * (새 모델) 예약 가능 기본값 = 영업시간. 드래그는 "휴무"를 칠한다.
 * 영업시간 seed에서 서버 휴무(TimeOff) 구간을 빼서 현재 "예약 가능" 집합을 재구성한다.
 * 종일 휴무(시작/종료 null)나 시간 파싱 실패는 그 날짜 전체를 휴무로 본다.
 * 반환 키 형식: `YYYY-MM-DD|slot`.
 */
export function seedMinusTimeOffs(
  seed: Set<string>,
  dates: readonly string[],
  timeOffs: readonly TimeOff[],
): Set<string> {
  const set = new Set(seed);
  const offByDate = new Map<string, { startMin: number; endMin: number }[]>();
  for (const t of timeOffs) {
    const s = t.start_time != null ? timeToMin(t.start_time.slice(0, 5)) : null;
    const e = t.end_time != null ? timeToMin(t.end_time.slice(0, 5)) : null;
    // 종일 휴무 또는 파싱 실패 → 하루 전체 범위로 간주.
    const range = s !== null && e !== null ? { startMin: s, endMin: e } : { startMin: DAY_START_MIN, endMin: DAY_END_MIN };
    const list = offByDate.get(t.off_date);
    if (list) list.push(range);
    else offByDate.set(t.off_date, [range]);
  }
  for (const date of dates) {
    const offs = offByDate.get(date);
    if (!offs) continue;
    for (let i = 0; i < SLOTS_PER_DAY; i += 1) {
      const s = slotStartMin(i);
      if (offs.some((o) => s >= o.startMin && s < o.endMin)) set.delete(`${date}|${i}`);
    }
  }
  return set;
}

/**
 * (새 모델) 날짜별 "예약 가능" 슬롯 → 요일별 주간 스케줄 7건 + 날짜별 휴무 블록.
 *
 * 예약 가능의 기본 뼈대는 "샵 영업시간"이다(요일 스케줄 = 영업시간). 사장님이 드래그로
 * 막은 시간(영업시간 안에서 예약 불가로 칠한 구간)만 그 날짜의 휴무(TimeOff)로 내려보낸다.
 *   - 요일 스케줄: 영업하는 요일 → 영업 시작~종료(그리드 클램프), 닫는 요일 → is_day_off.
 *   - 날짜별 휴무: 그 날짜 영업시간 창 안에서 예약 불가(hasSlot=false)로 칠한 연속 구간.
 * 영업시간 밖은 애초에 예약 불가라 별도 휴무가 필요 없다. 아무것도 안 막은 날짜는 휴무 0건
 * (= 영업시간 전체 예약 가능). 반환 entries 는 항상 월(0)~일(6) 7건이다.
 */
export function availToBusinessScheduleAndTimeOff(
  dates: readonly string[],
  businessHours: BusinessHourEntry[] | null | undefined,
  hasSlot: (date: string, slot: number) => boolean,
): { entries: ScheduleEntry[]; timeOffs: TimeOffCreate[] } {
  const byWeekday = new Map<number, BusinessHourEntry>();
  for (const e of businessHours ?? []) byWeekday.set(e.weekday, e);

  // 1) 요일별 스케줄 7건 = 영업시간(닫는 요일은 휴무).
  const entries: ScheduleEntry[] = [];
  const winByWeekday = new Map<number, { startMin: number; endMin: number }>();
  for (let wd = 0; wd < 7; wd += 1) {
    const win = businessWindowMin(byWeekday, wd);
    if (!win) {
      entries.push({ weekday: wd, is_day_off: true, start_time: null, end_time: null, break_start_time: null, break_end_time: null });
      continue;
    }
    winByWeekday.set(wd, win);
    entries.push({
      weekday: wd,
      is_day_off: false,
      start_time: minToTime(win.startMin),
      end_time: minToTime(win.endMin),
      break_start_time: null,
      break_end_time: null,
    });
  }

  // 2) 날짜별 휴무: 영업시간 창 안에서 예약 불가(hasSlot=false)로 칠한 연속 구간.
  const timeOffs: TimeOffCreate[] = [];
  for (const date of dates) {
    const win = winByWeekday.get(appWeekday(date));
    if (!win) continue; // 영업 안 하는 요일 → 창 없음, 휴무 불필요
    let blockStart: number | null = null;
    const flush = (endSlot: number) => {
      if (blockStart === null) return;
      timeOffs.push({
        off_date: date,
        start_time: minToTime(slotStartMin(blockStart)),
        end_time: minToTime(slotStartMin(endSlot)),
        reason: '예약 불가',
      });
      blockStart = null;
    };
    for (let i = 0; i < SLOTS_PER_DAY; i += 1) {
      const s = slotStartMin(i);
      const inBiz = s >= win.startMin && s < win.endMin;
      if (!inBiz) {
        flush(i); // 영업시간 밖 → 열린 휴무 블록 마감
        continue;
      }
      if (hasSlot(date, i)) flush(i); // 예약 가능 → 블록 마감
      else if (blockStart === null) blockStart = i; // 예약 불가(휴무) 시작
    }
    flush(SLOTS_PER_DAY); // 영업시간이 그리드 끝(22:00)까지면 마지막 블록 마무리
  }

  return { entries, timeOffs };
}
