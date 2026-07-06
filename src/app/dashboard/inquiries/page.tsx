'use client';

/**
 * 문의 관리 — 앱 고객이 특정 디자인(또는 샵)에 남긴 문의 조회 + 답변.
 *
 *  - 목록: inquiriesApi.listMyShopInquiries (커서 페이지네이션 → collectAll로 전부).
 *  - design_id가 있으면 해당 디자인 썸네일/제목을 함께 보여준다.
 *  - 답변: inquiriesApi.reply(id, { body }) → status pending→answered.
 *  - 필터: 전체 / 미답변(pending)만.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designsApi, inquiriesApi } from '@/services';
import type { ShopInquiry } from '@/services';
import { collectAll } from '@/lib/api-client';
import { toUserMessage } from '@/lib/error-messages';

export default function InquiriesPage() {
  const [onlyPending, setOnlyPending] = useState(false);

  const q = useQuery({
    queryKey: ['inquiries'],
    queryFn: () => collectAll<ShopInquiry>((cursor) => inquiriesApi.listMyShopInquiries({ cursor, limit: 50 })),
  });

  const list = useMemo(() => {
    const all = q.data ?? [];
    return onlyPending ? all.filter((i) => i.status === 'pending') : all;
  }, [q.data, onlyPending]);

  const pendingCount = (q.data ?? []).filter((i) => i.status === 'pending').length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-heading-lg font-bold">문의 관리</h1>
        <p className="mt-1 text-body-sm text-primary-50">
          앱에서 고객이 디자인·샵에 대해 남긴 문의를 확인하고 답변할 수 있어요.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <FilterChip active={!onlyPending} onClick={() => setOnlyPending(false)}>
          전체
        </FilterChip>
        <FilterChip active={onlyPending} onClick={() => setOnlyPending(true)}>
          미답변 {pendingCount > 0 && <span className="ml-0.5 font-bold">{pendingCount}</span>}
        </FilterChip>
      </div>

      {q.isLoading ? (
        <p className="text-body-sm text-primary-50">불러오는 중…</p>
      ) : q.isError ? (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">{toUserMessage(q.error)}</p>
      ) : list.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-body-sm text-primary-50">
          {onlyPending ? '미답변 문의가 없어요.' : '아직 들어온 문의가 없어요.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((i) => (
            <InquiryCard key={i.id} inquiry={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

function InquiryCard({ inquiry: i }: { inquiry: ShopInquiry }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const replyM = useMutation({
    mutationFn: () => inquiriesApi.reply(i.id, { body: body.trim() }),
    onSuccess: () => {
      setError(null);
      setBody('');
      qc.invalidateQueries({ queryKey: ['inquiries'] });
    },
    onError: (e) => setError(toUserMessage(e)),
  });

  const answered = i.status === 'answered';
  const date = new Date(i.created_at).toLocaleString('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <li className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-caption font-bold ${
            answered ? 'bg-neutral-100 text-primary-50' : 'bg-secondary/10 text-secondary'
          }`}
        >
          {answered ? '답변 완료' : '미답변'}
        </span>
        <span className="text-caption text-primary-50">{date}</span>
      </div>

      {/* 문의 대상 디자인 */}
      {i.design_id && <DesignChip designId={i.design_id} />}

      {/* 고객 문의 본문 */}
      <div className="mt-3 rounded-xl rounded-tl-sm border border-neutral-200 bg-white px-3 py-2 text-body-sm leading-relaxed text-primary">
        {i.body}
      </div>

      {/* 답변 영역 */}
      {answered ? (
        <div className="mt-2 rounded-xl rounded-tr-sm bg-secondary/5 px-3 py-2.5">
          <div className="text-caption font-bold text-secondary">사장님 답변</div>
          <p className="mt-1 whitespace-pre-wrap text-body-sm leading-relaxed text-primary">
            {i.owner_reply}
          </p>
        </div>
      ) : (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="문의에 대한 답변을 적어주세요."
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
          />
          <div className="mt-2 flex items-center justify-between">
            {error ? <span className="text-caption text-danger">{error}</span> : <span />}
            <button
              disabled={replyM.isPending || !body.trim()}
              onClick={() => replyM.mutate()}
              className="rounded-lg bg-secondary px-4 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
            >
              답변 등록
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** 문의가 가리키는 디자인의 썸네일 + 제목 (관리용 제목). */
function DesignChip({ designId }: { designId: string }) {
  const q = useQuery({
    queryKey: ['design', designId],
    queryFn: () => designsApi.getDesign(designId),
  });
  const d = q.data;
  return (
    <div className="mt-3 flex items-center gap-2.5 rounded-lg bg-neutral-50 p-2">
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100">
        {d?.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.thumbnail_url} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 text-body-sm">
        <div className="text-caption text-primary-50">문의한 디자인</div>
        <div className="truncate font-medium text-primary">
          {q.isLoading ? '불러오는 중…' : (d?.title ?? '삭제된 디자인')}
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-body-sm font-semibold ${
        active ? 'border-secondary bg-secondary text-white' : 'border-neutral-300 text-primary'
      }`}
    >
      {children}
    </button>
  );
}
