/**
 * 1:1 채팅 API (사장님 측).
 *
 * 앱 사용자와 샵 사이의 대화방/메시지를 조회하고 답장한다.
 * 실시간성은 화면에서 React Query refetchInterval(폴링)로 구현한다.
 */
import { apiClient } from '@/lib/api-client';
import type { Operation, SuccessResponse } from '@/types/api-helpers';

export type ChatRoom = SuccessResponse<Operation<'/api/v1/shops/me/chats', 'get'>>['data'][number];

export type ChatMessage = SuccessResponse<
  Operation<'/api/v1/chats/{room_id}/messages', 'get'>
>['data'][number];

/** 내 샵으로 들어온 대화방 목록 (커서 페이지네이션) */
export async function listMyShopChats(query?: { cursor?: string; limit?: number }) {
  return apiClient.get('/api/v1/shops/me/chats', { query });
}

/** 대화방 메시지 목록 (최신순) */
export async function listMessages(roomId: string, query?: { cursor?: string; limit?: number }) {
  return apiClient.get('/api/v1/chats/{room_id}/messages', {
    params: { room_id: roomId },
    query,
  });
}

/** 메시지 전송 */
export async function sendMessage(roomId: string, body: string) {
  return apiClient.post('/api/v1/chats/{room_id}/messages', {
    params: { room_id: roomId },
    body: { body },
  });
}

/** 대화방 읽음 처리 */
export async function markRead(roomId: string) {
  return apiClient.post('/api/v1/chats/{room_id}/read', {
    params: { room_id: roomId },
  });
}
