/**
 * 베타 일정 헬퍼 — 8월 1~7일, 일/주 달력. 30분 단위 "예약 가능" 선택.
 *
 * 모델(when2meet): 기본은 회색(예약 불가). 드래그로 하얗게 칠한 시간 = 예약 가능.
 *   - 하루의 가능 시간(연속 창) → 디자이너 주간 스케줄(ScheduleEntry) 근무 창
 *   - 근무 창 안의 비어 있는(회색) 구간 → 휴무(TimeOff) 블록
 *   - 하나도 안 칠한 날 → 휴무일
 * 8월 1~7일은 월~일 7요일이 하나씩이라 주간 스케줄과 1:1 대응된다.
 *
 * 우리 앱 예약은 백엔드가 가용시간 계산 시 자동 제외한다. 스케줄/휴무는 조회 API가 없어
 * 선택 상태와 휴무 ID는 localStorage에 함께 보관한다(같은 기기 기준).
 */
import type { BusinessHourEntry, ScheduleEntry, TimeOffCreate } from '@/services';

/** 베타 대상 날짜 (2026-08-01 ~ 2026-08-07) */
export const BETA_DATES = [
  '2026-08-01',
  '2026-08-02',
  '2026-08-03',
  '2026-08-04',
  '2026-08-05',
  '2026-08-06',
  '2026-08-07',
] as const;

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
 * 하루의 "예약 가능" 슬롯 집합 → 스케줄 1칸 + 휴무 블록들.
 * available: 그날 예약 가능으로 칠한 슬롯 인덱스 집합.
 */
export function availDayToScheduleAndTimeOff(
  date: string,
  available: Set<number>,
): { entry: ScheduleEntry; timeOffs: TimeOffCreate[] } {
  const weekday = appWeekday(date);
  const slots = [...available].sort((a, b) => a - b);

  if (slots.length === 0) {
    return {
      entry: { weekday, is_day_off: true, start_time: null, end_time: null, break_start_time: null, break_end_time: null },
      timeOffs: [],
    };
  }

  const first = slots[0];
  const last = slots[slots.length - 1];
  const entry: ScheduleEntry = {
    weekday,
    is_day_off: false,
    start_time: minToTime(slotStartMin(first)),
    end_time: minToTime(slotStartMin(last) + SLOT_MIN),
    break_start_time: null,
    break_end_time: null,
  };

  // 근무 창 [first, last] 안의 비어 있는 연속 구간 → 휴무 블록
  const timeOffs: TimeOffCreate[] = [];
  let gapStart: number | null = null;
  for (let i = first; i <= last; i += 1) {
    const on = available.has(i);
    if (!on && gapStart === null) gapStart = i;
    if (on && gapStart !== null) {
      timeOffs.push({
        off_date: date,
        start_time: minToTime(slotStartMin(gapStart)),
        end_time: minToTime(slotStartMin(i)),
        reason: '예약 불가',
      });
      gapStart = null;
    }
  }

  return { entry, timeOffs };
}
