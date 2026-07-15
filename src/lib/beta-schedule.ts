/**
 * 베타 일정 헬퍼 — 오늘부터 다음달 말까지, 일/주 달력. 30분 단위 "예약 가능" 선택.
 *
 * 모델(when2meet): 기본은 회색(예약 불가). 드래그로 하얗게 칠한 시간 = 예약 가능.
 *   - 하루의 가능 시간(연속 창) → 디자이너 주간 스케줄(ScheduleEntry) 근무 창
 *   - 근무 창 안의 비어 있는(회색) 구간 → 휴무(TimeOff) 블록
 *   - 하나도 안 칠한 날 → 휴무일
 * 오늘부터 다음달 말까지의 날짜 범위를 기준으로 일/주 달력을 관리한다.
 *
 * 우리 앱 예약은 백엔드가 가용시간 계산 시 자동 제외한다. 스케줄/휴무는 조회 API가 없어
 * 선택 상태와 휴무 ID는 localStorage에 함께 보관한다(같은 기기 기준).
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
 * 서버의 요일별 스케줄 + 날짜별 휴무 → 날짜/슬롯 "예약 가능" 집합(하양칸).
 * availToWeeklyScheduleAndTimeOff 의 역변환. 슬롯 예약가능 =
 *   (요일 근무창 안) AND (그 날짜 휴무 구간에 안 걸림).
 * 종일 휴무(시작/종료 null)나 시간 파싱 실패는 그 날짜 전체를 불가로 본다.
 * 반환 키 형식: `YYYY-MM-DD|slot`.
 */
export function serverToAvailSet(
  dates: readonly string[],
  schedule: ScheduleEntry[],
  timeOffs: TimeOff[],
): Set<string> {
  const set = new Set<string>();
  const byWeekday = new Map<number, ScheduleEntry>();
  for (const e of schedule) byWeekday.set(e.weekday, e);

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
    const entry = byWeekday.get(appWeekday(date));
    if (!entry || entry.is_day_off || !entry.start_time || !entry.end_time) continue;
    const winStart = timeToMin(entry.start_time.slice(0, 5));
    const winEnd = timeToMin(entry.end_time.slice(0, 5));
    if (winStart === null || winEnd === null) continue;
    const offs = offByDate.get(date) ?? [];
    for (let i = 0; i < SLOTS_PER_DAY; i += 1) {
      const s = slotStartMin(i);
      if (s < winStart || s >= winEnd) continue; // 근무창 밖
      if (offs.some((o) => s >= o.startMin && s < o.endMin)) continue; // 휴무에 걸림
      set.add(`${date}|${i}`);
    }
  }
  return set;
}

/**
 * 여러 날짜의 "예약 가능" 슬롯 → 요일별 주간 스케줄 7건 + 날짜별 휴무 블록.
 *
 * 주간 스케줄은 요일 반복 패턴이라(백엔드 계약: 요일별 7건, entries maxItems=7),
 * 같은 요일의 여러 날짜를 하나의 근무창으로 합쳐야 한다. 휴무(TimeOff)는 근무창에서
 * 빼기만 가능하므로:
 *   - 요일 근무창 = 그 요일 모든 날짜에서 켠 슬롯의 합집합 외곽(가장 이른 시작~가장 늦은 끝).
 *     (어느 날짜든 켠 슬롯은 반드시 이 창 안에 들어와야 TimeOff로 되돌릴 수 있다)
 *   - 각 날짜: 근무창 안에서 그날 안 켠 연속 구간 → 휴무(TimeOff).
 *   - 그 요일 어떤 날짜에서도 하나도 안 켰으면 → 요일 휴무(is_day_off).
 *
 * dates 는 대상 날짜들(중복 요일 포함 가능), hasSlot(date, slot) 은 해당 날짜/슬롯의 예약가능 여부.
 * 반환 entries 는 항상 월(0)~일(6) 7건이다.
 */
export function availToWeeklyScheduleAndTimeOff(
  dates: readonly string[],
  hasSlot: (date: string, slot: number) => boolean,
): { entries: ScheduleEntry[]; timeOffs: TimeOffCreate[] } {
  // 1) 요일별 근무창 외곽(첫 슬롯 first ~ 마지막 슬롯 last) 계산
  const windowByWeekday = new Map<number, { first: number; last: number }>();
  for (const date of dates) {
    const wd = appWeekday(date);
    for (let i = 0; i < SLOTS_PER_DAY; i += 1) {
      if (!hasSlot(date, i)) continue;
      const cur = windowByWeekday.get(wd);
      if (!cur) windowByWeekday.set(wd, { first: i, last: i });
      else if (i < cur.first) cur.first = i;
      else if (i > cur.last) cur.last = i;
    }
  }

  // 2) 요일별 스케줄 7건 (월=0 … 일=6)
  const entries: ScheduleEntry[] = [];
  for (let wd = 0; wd < 7; wd += 1) {
    const w = windowByWeekday.get(wd);
    entries.push(
      w
        ? {
            weekday: wd,
            is_day_off: false,
            start_time: minToTime(slotStartMin(w.first)),
            end_time: minToTime(slotStartMin(w.last) + SLOT_MIN),
            break_start_time: null,
            break_end_time: null,
          }
        : { weekday: wd, is_day_off: true, start_time: null, end_time: null, break_start_time: null, break_end_time: null },
    );
  }

  // 3) 날짜별 휴무: 요일 근무창 안에서 그날 안 켠 연속 구간(전부 안 켠 날 → 창 전체가 휴무)
  const timeOffs: TimeOffCreate[] = [];
  for (const date of dates) {
    const w = windowByWeekday.get(appWeekday(date));
    if (!w) continue; // 요일 자체가 휴무 → 근무창 없음, 별도 휴무 블록 불필요
    let gapStart: number | null = null;
    const flush = (endSlot: number) => {
      if (gapStart === null) return;
      timeOffs.push({
        off_date: date,
        start_time: minToTime(slotStartMin(gapStart)),
        end_time: minToTime(slotStartMin(endSlot)),
        reason: '예약 불가',
      });
      gapStart = null;
    };
    for (let i = w.first; i <= w.last; i += 1) {
      if (hasSlot(date, i)) flush(i);
      else if (gapStart === null) gapStart = i;
    }
    flush(w.last + 1); // 근무창 끝까지 이어진 빈 구간 마무리
  }

  return { entries, timeOffs };
}
