/**
 * 주/월 뷰용 달력 계산 헬퍼.
 *
 * 날짜는 모두 "YYYY-MM-DD"(로컬) 문자열로 다룬다. 요일 컨벤션은 월요일 시작
 * (lib/weekday.WEEKDAYS: 0=월 … 6=일)과 맞춘다.
 */
import { shiftLocalDate, todayLocalDate } from './date';

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

/** date가 속한 주의 월요일. */
export function startOfWeek(date: string): string {
  const { y, m, d } = parts(date);
  const dow = (new Date(y, m - 1, d, 12).getDay() + 6) % 7; // 0=월 … 6=일
  return shiftLocalDate(date, -dow);
}

/** date가 속한 주의 월~일 7일치. */
export function weekDates(date: string): string[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => shiftLocalDate(start, i));
}

/** date가 속한 달의 1일. */
export function startOfMonth(date: string): string {
  const { y, m } = parts(date);
  return todayLocalDate(new Date(y, m - 1, 1, 12));
}

/** n개월 이동 (일자는 말일로 클램프). */
export function shiftMonth(date: string, n: number): string {
  const { y, m, d } = parts(date);
  const target = new Date(y, m - 1 + n, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return todayLocalDate(target);
}

export interface MonthCell {
  date: string;
  inMonth: boolean;
}

/** date가 속한 달을 덮는 주 배열(월요일 시작). 앞뒤로 다른 달 날짜가 채워질 수 있다. */
export function monthGrid(date: string): MonthCell[][] {
  const first = startOfMonth(date);
  const month = parts(first).m;
  let cursor = startOfWeek(first);

  const weeks: MonthCell[][] = [];
  for (let w = 0; w < 6; w += 1) {
    const row: MonthCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      row.push({ date: cursor, inMonth: parts(cursor).m === month });
      cursor = shiftLocalDate(cursor, 1);
    }
    weeks.push(row);
  }
  // 전부 다음 달인 후행 주는 제거 (4~6주 가변).
  while (weeks.length > 4 && weeks[weeks.length - 1].every((c) => !c.inMonth)) weeks.pop();
  return weeks;
}

/** "YYYY-MM-DD" → 일(day) 숫자. */
export function dayOfMonth(date: string): number {
  return parts(date).d;
}

/** JS getDay() (0=일 … 6=토). */
export function dayOfWeek(date: string): number {
  const { y, m, d } = parts(date);
  return new Date(y, m - 1, d, 12).getDay();
}

const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** "4월 3일 (수)" */
export function dayLabel(date: string): string {
  const { m, d } = parts(date);
  return `${m}월 ${d}일 (${DOW_KO[dayOfWeek(date)]})`;
}

/** "6.29 ~ 7.5" */
export function weekShortLabel(date: string): string {
  const days = weekDates(date);
  const a = parts(days[0]);
  const b = parts(days[6]);
  return `${a.m}.${a.d} ~ ${b.m}.${b.d}`;
}

/** "2026년 6월" */
export function monthLabel(date: string): string {
  const { y, m } = parts(date);
  return `${y}년 ${m}월`;
}

/** "6월 29일 ~ 7월 5일" */
export function weekRangeLabel(date: string): string {
  const days = weekDates(date);
  const a = parts(days[0]);
  const b = parts(days[6]);
  return `${a.m}월 ${a.d}일 ~ ${b.m}월 ${b.d}일`;
}
