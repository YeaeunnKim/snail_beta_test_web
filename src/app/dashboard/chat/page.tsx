'use client';

/**
 * 채팅 목록 — 앱 사용자와의 1:1 대화방 목록.
 * 안읽음 수를 최신으로 유지하기 위해 8초 폴링한다.
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { chatApi } from '@/services';

function formatWhen(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) {
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays < 7) return `${diffDays}일 전`;
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

export default function ChatListPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['chats'],
    queryFn: () => chatApi.listMyShopChats(),
    refetchInterval: 8000,
  });

  const rooms = data?.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-heading-lg text-primary">채팅</h1>

      {isLoading ? (
        <p className="text-body-sm text-primary-50 py-10 text-center">불러오는 중…</p>
      ) : isError ? (
        <div className="flex flex-col items-center gap-2 py-10">
          <p className="text-body-sm text-primary-50">목록을 불러오지 못했어요</p>
          <button
            onClick={() => refetch()}
            className="border-primary-10 text-body-sm text-secondary rounded-lg border px-4 py-1.5"
          >
            다시 시도
          </button>
        </div>
      ) : rooms.length === 0 ? (
        <p className="text-body-sm text-primary-50 py-10 text-center">아직 대화가 없어요</p>
      ) : (
        <ul className="divide-primary-10 flex flex-col divide-y">
          {rooms.map((room) => {
            const unreadCount = room.unread_count ?? 0;
            return (
              <li key={room.id}>
                <Link href={`/dashboard/chat/${room.id}`} className="flex items-center gap-3 py-3.5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-neutral-100 text-lg">
                    {room.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={room.thumbnail_url}
                        alt={room.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      '👤'
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-body-sm text-primary truncate font-semibold">
                        {room.title}
                      </span>
                      <span className="text-caption text-primary-50 shrink-0">
                        {formatWhen(room.last_message_at)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="text-caption text-primary-50 truncate">
                        {room.last_message_preview ?? '대화를 시작해보세요'}
                      </span>
                      {unreadCount > 0 && (
                        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#E8604C] px-1.5 text-[11px] font-semibold text-white">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
