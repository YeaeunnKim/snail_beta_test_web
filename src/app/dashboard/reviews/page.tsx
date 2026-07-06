'use client';

/**
 * 리뷰 관리 — 앱 고객이 남긴 리뷰 조회 + 답글.
 *
 *  - 내 샵 id는 shopApi.getMyShop()으로 얻어 reviewsApi.listReviewsForShop(shopId)에 넘긴다.
 *  - 각 리뷰에 답글을 1개 작성할 수 있다(수정 API는 아직 없음 → 작성 후 읽기 전용).
 *  - 필터: 전체 / 미답변만.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reviewsApi, shopApi } from '@/services';
import type { Review } from '@/services';
import { toUserMessage } from '@/lib/error-messages';

export default function ReviewsPage() {
  const [onlyUnanswered, setOnlyUnanswered] = useState(false);

  const shopQ = useQuery({ queryKey: ['shop', 'me'], queryFn: () => shopApi.getMyShop() });
  const shopId = shopQ.data?.id;

  const reviewsQ = useQuery({
    queryKey: ['reviews', shopId],
    queryFn: () => reviewsApi.listReviewsForShop(shopId as string, { limit: 50 }),
    enabled: !!shopId,
  });

  const reviews = useMemo(() => {
    const list = (reviewsQ.data ?? []) as Review[];
    return onlyUnanswered ? list.filter((r) => !r.reply) : list;
  }, [reviewsQ.data, onlyUnanswered]);

  const unansweredCount = ((reviewsQ.data ?? []) as Review[]).filter((r) => !r.reply).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-heading-lg font-bold">리뷰 관리</h1>
        <p className="mt-1 text-body-sm text-primary-50">
          앱에서 고객이 남긴 리뷰를 확인하고 답글을 남길 수 있어요.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <FilterChip active={!onlyUnanswered} onClick={() => setOnlyUnanswered(false)}>
          전체
        </FilterChip>
        <FilterChip active={onlyUnanswered} onClick={() => setOnlyUnanswered(true)}>
          미답변 {unansweredCount > 0 && <span className="ml-0.5 font-bold">{unansweredCount}</span>}
        </FilterChip>
      </div>

      {shopQ.isError ? (
        <ErrorBox msg={toUserMessage(shopQ.error)} />
      ) : reviewsQ.isLoading || shopQ.isLoading ? (
        <p className="text-body-sm text-primary-50">불러오는 중…</p>
      ) : reviewsQ.isError ? (
        <ErrorBox msg={toUserMessage(reviewsQ.error)} />
      ) : reviews.length === 0 ? (
        <EmptyBox msg={onlyUnanswered ? '미답변 리뷰가 없어요.' : '아직 등록된 리뷰가 없어요.'} />
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewCard({ review: r }: { review: Review }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const replyM = useMutation({
    mutationFn: () => reviewsApi.createReply(r.id, { body: body.trim() }),
    onSuccess: () => {
      setError(null);
      setBody('');
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
    onError: (e) => setError(toUserMessage(e)),
  });

  const date = new Date(r.created_at).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <li className="rounded-xl border border-neutral-200 bg-white p-4">
      {/* 헤더: 작성자 + 별점 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-neutral-100 text-body-sm font-bold text-primary-50">
            {r.author.profile_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.author.profile_image_url} alt="" className="h-full w-full object-cover" />
            ) : (
              r.author.nickname.slice(0, 1)
            )}
          </div>
          <div>
            <div className="text-body-sm font-semibold">{r.author.nickname}</div>
            <div className="text-caption text-primary-50">{date}</div>
          </div>
        </div>
        <Stars rating={r.rating} />
      </div>

      {/* 본문 */}
      {r.body && (
        <p className="mt-3 whitespace-pre-wrap text-body-sm leading-relaxed text-primary">{r.body}</p>
      )}

      {/* 사진 */}
      {r.images.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt=""
              className="h-20 w-20 rounded-lg border border-neutral-200 object-cover"
            />
          ))}
        </div>
      )}

      {r.like_count > 0 && (
        <div className="mt-2 text-caption text-primary-50">♥ 좋아요 {r.like_count}</div>
      )}

      {/* 답글 영역 */}
      {r.reply ? (
        <div className="mt-3 rounded-lg bg-secondary/5 px-3 py-2.5">
          <div className="text-caption font-semibold text-secondary">사장님 답글</div>
          <p className="mt-1 whitespace-pre-wrap text-body-sm leading-relaxed text-primary">
            {r.reply.body}
          </p>
        </div>
      ) : (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <textarea
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="고객 리뷰에 답글을 남겨보세요."
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
          />
          <div className="mt-2 flex items-center justify-between">
            {error ? <span className="text-caption text-danger">{error}</span> : <span />}
            <button
              disabled={replyM.isPending || !body.trim()}
              onClick={() => replyM.mutate()}
              className="rounded-lg bg-secondary px-4 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
            >
              답글 등록
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 text-body-sm" title={`${rating}점`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= rating ? 'text-amber-400' : 'text-neutral-200'}>
          ★
        </span>
      ))}
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

function ErrorBox({ msg }: { msg: string }) {
  return <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">{msg}</p>;
}
function EmptyBox({ msg }: { msg: string }) {
  return (
    <p className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-body-sm text-primary-50">
      {msg}
    </p>
  );
}
