/** 알림 API. 사장님 인박스 + 샵 알림. */
import { apiClient } from '@/lib/api-client';

/** 사장님 알림 목록 */
export async function listOwnerNotifications(query?: { cursor?: string; limit?: number }) {
  return apiClient.get('/api/v1/owners/me/notifications', { query });
}

/** 사장님 알림 단건 읽음 처리 */
export async function markOwnerNotificationRead(notificationId: string) {
  return apiClient.post('/api/v1/owners/me/notifications/{notification_id}/read', {
    params: { notification_id: notificationId },
  });
}

/** 사장님 알림 전체 읽음 처리 */
export async function markAllOwnerNotificationsRead() {
  return apiClient.post('/api/v1/owners/me/notifications/read-all');
}

/** 샵 알림 목록 */
export async function listShopNotifications(query?: { cursor?: string; limit?: number }) {
  return apiClient.get('/api/v1/shops/me/notifications', { query });
}

/** 샵 알림 단건 읽음 처리 */
export async function markShopNotificationRead(notificationId: string) {
  return apiClient.patch('/api/v1/shops/me/notifications/{notification_id}/read', {
    params: { notification_id: notificationId },
  });
}
