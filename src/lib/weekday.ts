/**
 * 요일 정의 (weekday 숫자 ↔ 한국어 라벨).
 *
 * 샵 영업시간(BusinessHourEntry)·디자이너 스케줄(ScheduleEntry)의 `weekday` 숫자에 사용된다.
 *
 * 컨벤션 확정(백엔드): 0=월요일 … 6=일요일.
 */
export const WEEKDAYS = [
  { value: 0, label: '월' },
  { value: 1, label: '화' },
  { value: 2, label: '수' },
  { value: 3, label: '목' },
  { value: 4, label: '금' },
  { value: 5, label: '토' },
  { value: 6, label: '일' },
] as const;

/** "HH:MM" 24시간 형식 검증용 정규식 */
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
