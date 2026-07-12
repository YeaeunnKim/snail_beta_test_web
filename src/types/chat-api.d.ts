/**
 * 채팅 API 타입 보강(수동).
 *
 * 백엔드 chats 라우터를 방금 추가했으나 아직 `pnpm generate:types`로 api.d.ts에
 * 반영되지 않았으므로, 여기서 `paths` 인터페이스를 선언 병합(declaration merging)으로
 * 확장해 apiClient가 채팅 경로를 타입세이프하게 호출할 수 있게 한다.
 *
 * 백엔드 배포 후 `pnpm generate:types`를 돌리면 api.d.ts에 정식 반영되므로
 * 이 파일은 그때 삭제하면 된다.
 */
export {};

declare module './api' {
  interface paths {
    '/api/v1/shops/me/chats': {
      get: {
        parameters: {
          query?: { cursor?: string | null; limit?: number };
          path?: never;
          header?: never;
          cookie?: never;
        };
        responses: {
          200: {
            content: {
              'application/json': {
                data: {
                  id: string;
                  shop_id: string;
                  user_id: string;
                  title: string;
                  shop_name: string;
                  thumbnail_url: string | null;
                  last_message_preview: string | null;
                  last_message_at: string | null;
                  unread_count: number;
                  created_at: string;
                }[];
                page?: { next_cursor?: string | null; has_next?: boolean };
                request_id: string;
              };
            };
          };
        };
      };
    };
    '/api/v1/chats/{room_id}/messages': {
      get: {
        parameters: {
          query?: { cursor?: string | null; limit?: number };
          path: { room_id: string };
          header?: never;
          cookie?: never;
        };
        responses: {
          200: {
            content: {
              'application/json': {
                data: {
                  id: string;
                  room_id: string;
                  sender_type: 'user' | 'owner' | 'admin' | 'system';
                  sender_id: string;
                  body: string;
                  created_at: string;
                }[];
                page?: { next_cursor?: string | null; has_next?: boolean };
                request_id: string;
              };
            };
          };
        };
      };
      post: {
        parameters: {
          query?: never;
          path: { room_id: string };
          header?: never;
          cookie?: never;
        };
        requestBody: { content: { 'application/json': { body: string } } };
        responses: {
          201: {
            content: {
              'application/json': {
                id: string;
                room_id: string;
                sender_type: 'user' | 'owner' | 'admin' | 'system';
                sender_id: string;
                body: string;
                created_at: string;
              };
            };
          };
        };
      };
    };
    '/api/v1/chats/{room_id}/read': {
      post: {
        parameters: {
          query?: never;
          path: { room_id: string };
          header?: never;
          cookie?: never;
        };
        responses: { 204: { content?: never } };
      };
    };
  }
}
