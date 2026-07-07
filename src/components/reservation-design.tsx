'use client';

/**
 * 예약 상세에서 공용으로 쓰는 조각들.
 *  - ReservationDesignBlock: 대표 썸네일(클릭 시 등록된 상세 사진 펼침) + 제목 + 태그
 *    (가격·소요시간·선택 옵션은 예약 상세의 별도 정보 그룹에서 보여준다)
 *  - InquiryThread: 고객 요청사항 + 사장님 답변(읽기 전용)
 *
 * 예약 응답엔 디자인 요약(썸네일 1장)만 있어, 상세 사진·태그는 getDesign으로 채운다.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { designsApi } from '@/services';
import type { Reservation } from '@/services';

export function ReservationDesignBlock({ reservation }: { reservation: Reservation }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['design', reservation.design_id],
    queryFn: () => designsApi.getDesign(reservation.design_id),
  });
  const design = q.data;
  const images = design?.images ?? [];

  const thumb = reservation.design?.thumbnail_url ?? design?.thumbnail_url ?? null;
  const title = reservation.design?.title ?? design?.title ?? '시술';
  const ownerTags = design?.owner_tags ?? [];
  const photoCount = images.length || (thumb ? 1 : 0);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-neutral-200"
          title="사진 보기"
        >
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="block h-full w-full bg-neutral-100" />
          )}
          <span className="absolute inset-x-0 bottom-0 bg-black/40 py-0.5 text-center text-caption font-semibold text-white">
            {open ? '접기' : `사진 ${photoCount}`}
          </span>
        </button>
        <div className="min-w-0">
          <p className="truncate font-medium">{title}</p>
          {ownerTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {ownerTags.map((t) => (
                <span key={t} className="rounded bg-secondary/10 px-2 py-0.5 text-caption text-secondary">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3">
          {q.isLoading ? (
            <p className="text-caption text-primary-50">사진 불러오는 중…</p>
          ) : images.length === 0 ? (
            <p className="text-caption text-primary-50">등록된 사진이 없어요.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={img.id}
                  src={img.original_url}
                  alt=""
                  className={`h-20 w-20 rounded-xl border object-cover ${
                    img.is_thumbnail ? 'border-secondary' : 'border-neutral-200'
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
  if (!req && !reply) return <p className="text-body-sm text-primary-50">남긴 요청사항이 없어요.</p>;
  return (
    <div className="flex flex-col gap-2">
      {req && (
        <div className="max-w-[85%] self-start rounded-xl rounded-tl-sm border border-neutral-200 bg-white px-3 py-2 text-body-sm leading-relaxed">
          {req}
          <div className="mt-1 text-caption text-primary-50">고객 · {reservation.user?.nickname ?? ''}</div>
        </div>
      )}
      {reply && (
        <div className="max-w-[85%] self-end rounded-xl rounded-tr-sm bg-secondary/10 px-3 py-2 text-body-sm leading-relaxed text-[#a33566]">
          {reply}
          <div className="mt-1 text-right text-caption text-secondary/70">사장님 답변</div>
        </div>
      )}
    </div>
  );
}
