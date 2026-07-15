'use client';

/**
 * 채팅 대화 화면 — 앱 사용자와 1:1 대화.
 * 웹소켓 대신 3초 폴링(refetchInterval)으로 실시간 대화를 구현한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chatApi } from '@/services';
import type { ChatMessage } from '@/services/chat';
import { ApiError } from '@/lib/api-error';

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

export default function ChatRoomPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const roomId = String(params.roomId);
  const queryClient = useQueryClient();

  const [text, setText] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 첫 페이지(최신 N개) 이전의 옛 메시지 — "이전 메시지 더보기"로 커서를 따라가며 누적한다.
  const [olderPages, setOlderPages] = useState<ChatMessage[][]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorInitRef = useRef(false);

  const messagesQuery = useQuery({
    queryKey: ['chat', roomId, 'messages'],
    queryFn: () => chatApi.listMessages(roomId),
    refetchInterval: 3000,
    enabled: Boolean(roomId),
  });

  // 최초 로드 시 첫 페이지의 커서 경계를 한 번만 저장한다.
  // (이후 3초 폴링으로 첫 페이지가 갱신돼도, 이미 진행한 "더보기" 커서를 덮어쓰지 않기 위함)
  useEffect(() => {
    if (!cursorInitRef.current && messagesQuery.data) {
      setOlderCursor(messagesQuery.data.page?.next_cursor);
      setHasMoreOlder(Boolean(messagesQuery.data.page?.has_next));
      cursorInitRef.current = true;
    }
  }, [messagesQuery.data]);

  async function handleLoadMore() {
    if (!olderCursor || loadingMore) return;
    setLoadingMore(true);
    const container = listRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    const prevScrollTop = container?.scrollTop ?? 0;
    try {
      const res = await chatApi.listMessages(roomId, { cursor: olderCursor, limit: 30 });
      setOlderPages((prev) => [...prev, res.data]);
      setOlderCursor(res.page?.next_cursor);
      setHasMoreOlder(Boolean(res.page?.has_next));
      // 스크롤 위치 보정: 위쪽에 메시지가 추가된 만큼 화면이 튀지 않도록 유지한다.
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight + prevScrollTop;
        }
      });
    } catch {
      // 실패해도 조용히 무시 — 버튼을 다시 눌러 재시도할 수 있다.
    } finally {
      setLoadingMore(false);
    }
  }

  const sendMutation = useMutation({
    mutationFn: (body: string) => chatApi.sendMessage(roomId, body),
    onSuccess: () => {
      setText('');
      setErrorText(null);
      queryClient.invalidateQueries({ queryKey: ['chat', roomId, 'messages'] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: (error) =>
      setErrorText(error instanceof ApiError ? error.message : '메시지를 보내지 못했어요'),
  });

  // 서버는 최신순으로 내려주므로(첫 페이지 + 더보기로 누적한 옛 페이지들) 화면에는
  // 오래된 것부터(위→아래) 표시한다.
  const messages = useMemo(
    () => [...(messagesQuery.data?.data ?? []), ...olderPages.flat()].reverse(),
    [messagesQuery.data, olderPages],
  );

  // 진입 + 새 메시지 도착 시 읽음 처리 + 맨 아래로 스크롤
  // 읽음 처리 성공 시 채팅 목록(['chats']) 캐시를 무효화해 안읽음 배지를 즉시 갱신한다.
  // (옛 메시지 "더보기"로 늘어난 개수는 제외 — 그때는 맨 아래로 스크롤하면 안 되므로
  //  최신 페이지 개수만 의존성으로 삼는다.)
  const latestCount = messagesQuery.data?.data.length ?? 0;
  useEffect(() => {
    if (roomId) {
      chatApi
        .markRead(roomId)
        .then(() => queryClient.invalidateQueries({ queryKey: ['chats'] }))
        .catch(() => {});
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [roomId, latestCount, queryClient]);

  const body = text.trim();
  const canSend = body.length > 0 && !sendMutation.isPending;

  function handleSend() {
    if (!canSend) return;
    sendMutation.mutate(body);
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* 헤더 */}
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => router.push('/dashboard/chat')}
          className="text-body-md text-primary-50"
          aria-label="뒤로"
        >
          ←
        </button>
        <h1 className="text-heading-lg text-primary">채팅</h1>
      </div>

      {/* 메시지 목록 */}
      <div ref={listRef} className="flex-1 overflow-y-auto rounded-lg bg-neutral-100 px-3 py-3">
        {messagesQuery.isLoading ? (
          <p className="text-body-sm text-primary-50 py-10 text-center">불러오는 중…</p>
        ) : messagesQuery.isError ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <p className="text-body-sm text-primary-50">대화를 불러오지 못했어요</p>
            <button
              onClick={() => messagesQuery.refetch()}
              className="border-primary-10 text-body-sm text-secondary rounded-lg border bg-white px-4 py-1.5"
            >
              다시 시도
            </button>
          </div>
        ) : messages.length === 0 ? (
          <p className="text-body-sm text-primary-50 py-10 text-center">
            아직 메시지가 없어요. 먼저 인사를 건네보세요.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {hasMoreOlder && (
              <li className="flex justify-center pb-1">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="border-primary-10 text-body-sm text-secondary rounded-lg border bg-white px-4 py-1.5 disabled:opacity-50"
                >
                  {loadingMore ? '불러오는 중…' : '이전 메시지 더보기'}
                </button>
              </li>
            )}
            {messages.map((message) => {
              // 사장님이 보낸 메시지(owner)는 오른쪽, 고객(user)은 왼쪽.
              const isMine = message.sender_type === 'owner';
              return (
                <li
                  key={message.id}
                  className={`flex items-end gap-1.5 ${isMine ? 'justify-end' : 'justify-start'}`}
                >
                  {isMine && (
                    <span className="text-primary-50 text-[11px]">
                      {formatTime(message.created_at)}
                    </span>
                  )}
                  <div
                    className={`text-body-sm max-w-[76%] rounded-2xl px-3.5 py-2 break-words whitespace-pre-wrap ${
                      isMine ? 'bg-secondary text-white' : 'text-primary bg-white'
                    }`}
                  >
                    {message.body}
                  </div>
                  {!isMine && (
                    <span className="text-primary-50 text-[11px]">
                      {formatTime(message.created_at)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 입력창 */}
      <div className="mt-2">
        {errorText && <p className="text-caption mb-1 text-[#E8604C]">{errorText}</p>}
        <div className="flex items-center gap-2">
          <input
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (errorText) setErrorText(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder="메시지를 입력하세요"
            disabled={sendMutation.isPending}
            className="border-primary-10 text-body-sm text-primary min-h-[40px] flex-1 rounded-lg border px-3 py-2 outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={`text-body-sm h-[40px] shrink-0 rounded-lg px-4 font-semibold text-white ${
              canSend ? 'bg-secondary' : 'bg-primary-10'
            }`}
          >
            {sendMutation.isPending ? '전송 중' : '보내기'}
          </button>
        </div>
      </div>
    </div>
  );
}
