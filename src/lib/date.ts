/**
 * 날짜/시간 포맷 유틸.
 *
 * NOTE: 브라우저 로컬 타임존 기준이다. 사장님 대부분 KST 사용을 가정.
 * 예약 start_at/end_at은 ISO 8601(UTC)이며 표시 시 로컬로 변환된다.
 */

/** 브라우저 로컬 기준 오늘 날짜 (YYYY-MM-DD). 예약 목록 from/to 파라미터에 사용. */
export function todayLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ISO datetime → "HH:MM" (로컬) */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "YYYY-MM-DD"에 days만큼 더한 날짜 문자열. (타임존 안전: 로컬 정오 기준) */
export function shiftLocalDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days, 12);
  return todayLocalDate(dt);
}

/** "YYYY-MM-DD" → "2024년 4월 6일 (토)" */
export function formatDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}
