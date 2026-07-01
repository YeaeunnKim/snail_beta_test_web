/**
 * 일간 디자이너 타임라인 헬퍼.
 *
 * 디자이너별 하루 예약을 가로 막대로 시각화하기 위한 시간 축(윈도) 계산과
 * 예약 상태 → 막대 표현 매핑을 담는다. 시간 축은 샵 영업시간을 기준으로 잡되,
 * 영업시간 밖 예약이 있으면 그 예약까지 보이도록 자동으로 넓힌다.
 */
import type { Schemas } from '@/types/api-helpers';
import type { ReservationStatus } from '@/services';
import { toMinutes } from './schedule';

type BusinessHourEntry = Schemas['BusinessHourEntry'];

/** 시간 축 윈도 (정시 단위). startHour 이상 endHour 미만을 한 칸씩 그린다. */
export interface TimelineWindow {
  startHour: number;
  endHour: number;
}

const DEFAULT_WINDOW: TimelineWindow = { startHour: 10, endHour: 20 };

/** ISO datetime(로컬) → 0시 기준 분. */
export function isoToMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * 시간 축 윈도를 계산한다.
 *  - 기본: 주간 영업시간(비휴무일)의 최이른 오픈 ~ 최늦은 마감
 *  - 그 범위 밖 예약이 있으면 정시 단위로 넓힘
 *  - 둘 다 없으면 10~20시
 */
export function computeWindow(
  hours: BusinessHourEntry[] | null | undefined,
  reservations: { start_at: string; end_at: string }[],
): TimelineWindow {
  let minMin = Infinity;
  let maxMin = -Infinity;

  for (const h of hours ?? []) {
    if (h.is_closed) continue;
    const open = toMinutes(h.open_time);
    const close = toMinutes(h.close_time);
    if (open != null) minMin = Math.min(minMin, open);
    if (close != null) maxMin = Math.max(maxMin, close);
  }
  for (const r of reservations) {
    minMin = Math.min(minMin, isoToMinutes(r.start_at));
    maxMin = Math.max(maxMin, isoToMinutes(r.end_at));
  }

  if (minMin === Infinity || maxMin === -Infinity) return { ...DEFAULT_WINDOW };

  const startHour = Math.floor(minMin / 60);
  let endHour = Math.ceil(maxMin / 60);
  if (endHour <= startHour) endHour = startHour + 1;
  return { startHour, endHour };
}

export type ReservationKind = 'confirmed' | 'requested' | 'cancelled';

/**
 * 예약 상태 → 표시 종류.
 *  - confirmed: 확정·완료 (채운 막대)
 *  - requested: 대기·입금대기 (점선 "요청")
 *  - cancelled: 거절·취소·노쇼 (취소선·흐림)
 */
export function kindOf(status: ReservationStatus): ReservationKind {
  switch (status) {
    case 'confirmed':
    case 'completed':
      return 'confirmed';
    case 'pending':
    case 'payment_pending':
      return 'requested';
    default:
      return 'cancelled';
  }
}

/** 디자이너 행에 순환 배정할 색상 팔레트 (mockup 기준). */
export const TIMELINE_PALETTE = [
  { bg: '#fcebeb', border: '#e24b4a', text: '#a32d2d' }, // red
  { bg: '#faeeda', border: '#ef9f27', text: '#854f0b' }, // amber
  { bg: '#eaf3de', border: '#97c459', text: '#3b6d11' }, // green
  { bg: '#e1f5ee', border: '#5dcaa5', text: '#0f6e56' }, // teal
  { bg: '#e6f1fb', border: '#378add', text: '#185fa5' }, // blue
  { bg: '#eeedfe', border: '#7f77dd', text: '#3c3489' }, // purple
  { bg: '#fbeaf0', border: '#ed93b1', text: '#993556' }, // pink
] as const;
