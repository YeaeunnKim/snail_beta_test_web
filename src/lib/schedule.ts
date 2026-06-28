/**
 * 디자이너 주간 스케줄 헬퍼.
 *
 * 디자이너 스케줄은 조회(GET) 엔드포인트가 없는 write-only 구조다. 따라서 편집기 진입 시
 * 샵 영업시간(ShopMe.business_hours)으로 기본값을 시드하고, 저장(PUT) 시 덮어쓴다.
 */
import type { Schemas } from '@/types/api-helpers';
import { WEEKDAYS } from './weekday';

type BusinessHourEntry = Schemas['BusinessHourEntry'];

export interface ScheduleRow {
  weekday: number;
  is_day_off: boolean;
  start_time: string;
  end_time: string;
  break_start_time: string;
  break_end_time: string;
}

/** 샵 영업시간으로 7일치 스케줄 기본값을 만든다. */
export function seedScheduleFromHours(hours?: BusinessHourEntry[] | null): ScheduleRow[] {
  const byWeekday = new Map<number, BusinessHourEntry>();
  for (const h of hours ?? []) byWeekday.set(h.weekday, h);
  return WEEKDAYS.map((w) => {
    const h = byWeekday.get(w.value);
    const closed = h?.is_closed ?? false;
    return {
      weekday: w.value,
      is_day_off: closed,
      start_time: h?.open_time ?? '10:00',
      end_time: h?.close_time ?? '20:00',
      break_start_time: '',
      break_end_time: '',
    };
  });
}

/** "HH:MM" → 0시 기준 분. 형식이 아니면 null. */
export function toMinutes(t?: string | null): number | null {
  if (!t || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
