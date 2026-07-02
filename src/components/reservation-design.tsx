'use client';

/**
 * 예약 상세에서 공용으로 쓰는 조각들.
 *  - ReservationDesignBlock: 대표 썸네일(클릭 시 등록된 상세 사진 펼침) + 선택 옵션(연장/제거/케어)
 *  - InquiryThread: 고객 요청사항 + 사장님 답변(읽기 전용)
 *
 * 예약 응답엔 디자인 요약(썸네일 1장)만 있어, 상세 사진·옵션은 getDesign으로 채운다.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { designsApi } from '@/services';
import type { Reservation } from '@/services';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

const OPTION_META: Record<string, { label: string; bg: string; tx: string }> = {
  extend: { label: '연장', bg: '#eae6fd', tx: '#5a4fc0' },
  removal: { label: '제거', bg: '#fde7ec', tx: '#b12544' },
  care: { label: '케어', bg: '#e1f5ee', tx: '#0f6e56' },
};

export function ReservationDesignBlock({ reservation }: { reservation: Reservation }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['design', reservation.design_id],
    queryFn: () => designsApi.getDesign(reservation.design_id),
  });
  const design = q.data;
  const images = design?.images ?? [];
  const selected = new Set(reservation.selected_option_ids ?? []);
  const options = (design?.options ?? []).filter((o) => selected.has(o.id));

  const thumb = reservation.design?.thumbnail_url ?? design?.thumbnail_url ?? null;
  const title = reservation.design?.title ?? design?.title ?? '시술';
  const duration = reservation.design?.duration_minutes ?? design?.duration_minutes;

  return (
    <div>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-neutral-200"
          title="사진 보기"
        >
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="block h-full w-full bg-neutral-100" />
          )}
          <span className="absolute inset-x-0 bottom-0 bg-black/40 py-0.5 text-center text-[9px] font-medium text-white">
            {open ? '접기' : '사진'}
          </span>
        </button>
        <div className="min-w-0 text-sm">
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-neutral-400">
            {duration != null && `약 ${duration}분 · `}
            {won(reservation.total_price)}
          </div>
          {options.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {options.map((o) => {
                const meta = OPTION_META[o.kind] ?? { label: o.kind, bg: '#f0eee9', tx: '#8f8c85' };
                return (
                  <span
                    key={o.id}
                    className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                    style={{ background: meta.bg, color: meta.tx }}
                    title={o.name}
                  >
                    {meta.label}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3">
          {q.isLoading ? (
            <p className="text-xs text-neutral-400">사진 불러오는 중…</p>
          ) : images.length === 0 ? (
            <p className="text-xs text-neutral-400">등록된 사진이 없어요.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={img.id}
                  src={img.original_url}
                  alt=""
                  className={`h-20 w-20 rounded-xl border object-cover ${
                    img.is_thumbnail ? 'border-brand' : 'border-neutral-200'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function InquiryThread({ reservation }: { reservation: Reservation }) {
  const req = reservation.user_request;
  const reply = reservation.owner_reply;
  if (!req && !reply) return <p className="text-[13px] text-neutral-400">남긴 요청사항이 없어요.</p>;
  return (
    <div className="flex flex-col gap-2">
      {req && (
        <div className="max-w-[85%] self-start rounded-xl rounded-tl-sm border border-neutral-200 bg-white px-3 py-2 text-[13px] leading-relaxed">
          {req}
          <div className="mt-1 text-[10.5px] text-neutral-400">고객 · {reservation.user?.nickname ?? ''}</div>
        </div>
      )}
      {reply && (
        <div className="max-w-[85%] self-end rounded-xl rounded-tr-sm bg-brand/10 px-3 py-2 text-[13px] leading-relaxed text-[#a33566]">
          {reply}
          <div className="mt-1 text-right text-[10.5px] text-brand/70">사장님 답변</div>
        </div>
      )}
    </div>
  );
}
