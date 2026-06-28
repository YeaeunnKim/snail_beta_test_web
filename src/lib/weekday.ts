/**
 * 요일 정의 (weekday 숫자 ↔ 한국어 라벨).
 *
 * 샵 영업시간(BusinessHourEntry)·디자이너 스케줄(ScheduleEntry)의 `weekday` 숫자에 사용된다.
 *
 * TODO(backend): weekday 숫자 컨벤션(0=월 vs 0=일)이 스펙에 명시돼 있지 않다.
 * 현재는 Python datetime.weekday() 관례(0=월 … 6=일)를 가정한다. 백엔드와 확정 후 필요 시 수정.
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
