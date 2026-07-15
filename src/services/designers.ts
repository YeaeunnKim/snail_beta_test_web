/** 디자이너 관리 API. 등록·수정·삭제·스케줄·휴무. */
import { apiClient } from '@/lib/api-client';
import type { DesignerCreate, DesignerScheduleSet, DesignerUpdate, TimeOffCreate } from './types';

/** 내 샵 디자이너 목록 */
export async function listDesigners() {
  return apiClient.get('/api/v1/shops/me/designers');
}

/** 디자이너 생성 */
export async function createDesigner(body: DesignerCreate) {
  return apiClient.post('/api/v1/shops/me/designers', { body });
}

/** 디자이너 수정 */
export async function updateDesigner(designerId: string, body: DesignerUpdate) {
  return apiClient.patch('/api/v1/shops/me/designers/{designer_id}', {
    params: { designer_id: designerId },
    body,
  });
}

/** 디자이너 삭제 */
export async function deleteDesigner(designerId: string) {
  return apiClient.delete('/api/v1/shops/me/designers/{designer_id}', {
    params: { designer_id: designerId },
  });
}

/** 디자이너 주간 스케줄 설정 (요일별 7건) */
export async function setSchedule(designerId: string, body: DesignerScheduleSet) {
  return apiClient.put('/api/v1/shops/me/designers/{designer_id}/schedule', {
    params: { designer_id: designerId },
    body,
  });
}

/** 디자이너 주간 스케줄 조회 (요일 오름차순, 미설정이면 빈 배열) */
export async function getSchedule(designerId: string) {
  return apiClient.get('/api/v1/shops/me/designers/{designer_id}/schedule', {
    params: { designer_id: designerId },
  });
}

/** 디자이너 휴무 조회 (from/to로 기간 필터, 날짜 오름차순) */
export async function listTimeOff(designerId: string, query?: { from?: string; to?: string }) {
  return apiClient.get('/api/v1/shops/me/designers/{designer_id}/time-off', {
    params: { designer_id: designerId },
    query,
  });
}

/** 디자이너 휴무 추가 */
export async function addTimeOff(designerId: string, body: TimeOffCreate) {
  return apiClient.post('/api/v1/shops/me/designers/{designer_id}/time-off', {
    params: { designer_id: designerId },
    body,
  });
}

/** 디자이너 휴무 삭제 */
export async function deleteTimeOff(designerId: string, timeOffId: string) {
  return apiClient.delete('/api/v1/shops/me/designers/{designer_id}/time-off/{time_off_id}', {
    params: { designer_id: designerId, time_off_id: timeOffId },
  });
}
