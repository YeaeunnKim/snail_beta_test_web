'use client';

/**
 * 문의 — 앱 고객이 남긴 문의 보기 + 답변 (모바일).
 *
 * 세그먼트 2개:
 *  - 미답변(pending)  : 고객 문의에 답변을 작성해 보낸다(pending → answered).
 *  - 답변완료(answered): 내가 보낸 답변을 읽기 전용으로 확인.
 *
 * design_id가 있으면 어떤 디자인에 대한 문의인지 썸네일/제목을 함께 보여준다.
 * 답변을 보내면 ['inquiries'] 쿼리를 무효화해 목록/개수를 갱신한다.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designsApi, inquiriesApi } from '@/services';
import type { ShopInquiry } from '@/services';
import { collectAll } from '@/lib/api-client';
import { dateTimeLabel } from '@/lib/reservation-format';
import { toUserMessage } from '@/lib/error-messages';

type Seg = 'pending' | 'answered';

const SEGMENTS: { key: Seg; label: string }[] = [
  { key: 'pending', label: '미답변' },
  { key: 'answered', label: '답변완료' },
];

export default function InquiriesPage() {
  const [seg, setSeg] = useState<Seg>('pending');

  const inquiriesQuery = useQuery({
    queryKey: ['inquiries'],
    queryFn: () =>
      collectAll<ShopInquiry>((cursor) => inquiriesApi.listMyShopInquiries({ cursor, limit: 50 })),
  });
  const all = useMemo(() => inquiriesQuery.data ?? [], [inquiriesQuery.data]);

  const counts = useMemo(() => {
    const c: Record<Seg, number> = { pending: 0, answered: 0 };
    for (const q of all) {
      if (q.status === 'pending') c.pending += 1;
      else if (q.status === 'answered') c.answered += 1;
    }
    return c;
  }, [all]);

  const list = useMemo(() => {
    const rows = all.filter((q) => q.status === seg);
    // 미답변은 오래된 문의 먼저(빨리 답해야 하니), 답변완료는 최근 답변 먼저
    rows.sort((a, b) =>
      seg === 'pending'
        ? a.created_at.localeCompare(b.created_at)
        : b.created_at.localeCompare(a.created_at),
    );
    return rows;
  }, [all, seg]);

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-heading-lg font-bold text-primary">문의</h1>
        <p className="mt-1 text-body-sm text-primary-50">앱 고객이 남긴 문의를 확인하고 답변하세요.</p>
      </div>

      {/* 세그먼트 */}
      <div className="flex gap-1 rounded-xl bg-neutral-100 p-1">
        {SEGMENTS.map((s) => {
          const on = seg === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setSeg(s.key)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-caption font-semibold ${
                on ? 'bg-white text-primary shadow-sm' : 'text-primary-50'
              }`}
            >
              {s.label}
              {counts[s.key] > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-caption font-bold ${
                    s.key === 'pending' ? 'bg-secondary text-white' : 'bg-neutral-200 text-primary'
                  }`}
                >
                  {counts[s.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 목록 */}
      {inquiriesQuery.isLoading ? (
        <p className="py-10 text-center text-body-sm text-primary-50">불러오는 중…</p>
      ) : inquiriesQuery.isError ? (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">
          {toUserMessage(inquiriesQuery.error)}
        </p>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 p-12 text-center text-body-sm text-primary-50">
          {seg === 'pending' ? '답변을 기다리는 문의가 없어요.' : '답변한 문의가 없어요.'}
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.map((q) => (
            <InquiryCard key={q.id} inquiry={q} />
          ))}
        </div>
      )}
    </div>
  );
}

function InquiryCard({ inquiry }: { inquiry: ShopInquiry }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 어떤 디자인에 대한 문의인지 — design_id가 있을 때만 불러와 썸네일/제목을 붙인다.
  const designQuery = useQuery({
    queryKey: ['design', inquiry.design_id],
    queryFn: () => designsApi.getDesign(inquiry.design_id as string),
    enabled: !!inquiry.design_id,
  });

  const send = useMutation({
    mutationFn: (body: string) => inquiriesApi.reply(inquiry.id, { body }),
    onSuccess: () => {
      setError(null);
      setReply('');
      qc.invalidateQueries({ queryKey: ['inquiries'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => setError(toUserMessage(e)),
  });

  const canSend = reply.trim().length > 0 && !send.isPending;

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3.5">
      {/* 헤더: 상태 배지 + 접수 시각 */}
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2.5 py-1 text-caption font-bold ${
            inquiry.status === 'pending' ? 'bg-secondary text-white' : 'bg-success-bg text-success'
          }`}
        >
          {inquiry.status === 'pending' ? '미답변' : '답변완료'}
        </span>
        <span className="text-caption text-primary-50">{dateTimeLabel(inquiry.created_at)}</span>
      </div>

      {/* 어떤 디자인 문의인지 */}
      {inquiry.design_id && (
        <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2">
          {designQuery.data?.thumbnail_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={designQuery.data.thumbnail_url}
              alt=""
              className="h-9 w-9 shrink-0 rounded-md object-cover"
            />
          )}
          <span className="min-w-0 truncate text-caption font-semibold text-primary">
            {designQuery.isLoading ? '디자인 불러오는 중…' : (designQuery.data?.title ?? '디자인 문의')}
          </span>
        </div>
      )}

      {/* 고객 문의 내용 */}
      <p className="mt-2.5 whitespace-pre-wrap break-words rounded-lg bg-neutral-50 px-3 py-2.5 text-body-sm text-primary">
        {inquiry.body}
      </p>

      {/* 답변 영역 */}
      {inquiry.status === 'answered' ? (
        <div className="mt-2.5 rounded-lg border border-neutral-200 px-3 py-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-caption font-bold text-primary">내 답변</span>
            {inquiry.owner_replied_at && (
              <span className="text-caption text-primary-50">
                {dateTimeLabel(inquiry.owner_replied_at)}
              </span>
            )}
          </div>
          <p className="whitespace-pre-wrap break-words text-body-sm text-primary">
            {inquiry.owner_reply}
          </p>
        </div>
      ) : (
        <div className="mt-2.5">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="답변을 입력하세요"
            rows={3}
            className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-body-sm text-primary outline-none focus:border-secondary"
          />
          {error && <p className="mt-1 text-caption text-danger">{error}</p>}
          <button
            onClick={() => send.mutate(reply.trim())}
            disabled={!canSend}
            className={`mt-2 w-full rounded-lg py-2 text-body-sm font-bold ${
              canSend ? 'bg-secondary text-white' : 'bg-neutral-200 text-primary-50'
            }`}
          >
            {send.isPending ? '보내는 중…' : '답변 보내기'}
          </button>
        </div>
      )}
    </div>
  );
}
