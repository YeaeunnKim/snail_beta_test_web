'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designsApi } from '@/services';
import type { Design } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import { Lightbox } from './photo';
import { designImageUrls, formatWon } from '../_lib/design-helpers';
import { DesignEditForm } from './design-edit-form';

/* ───────────── 디자인 카드 ───────────── */

export function DesignCard({ design }: { design: Design }) {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState<number | null>(null); // null = 확대 뷰 닫힘
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const { data } = useQuery({
    queryKey: ['design', design.id],
    queryFn: () => designsApi.getDesign(design.id),
    initialData: design,
    refetchInterval: (q) => {
      const s = q.state.data?.ai_analysis_status;
      const active = s === 'pending' || s === 'in_progress';
      return active ? 3000 : false;
    },
  });
  const d = data ?? design;

  const reanalyze = useMutation({
    mutationFn: () => designsApi.reanalyze(d.id),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e) => setActionError(toUserMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => designsApi.deleteDesign(d.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['designs'] });
      qc.invalidateQueries({ queryKey: ['design-folders'] });
    },
    onError: (e) => setActionError(toUserMessage(e)),
  });

  // 디자인별 공개/비공개 전환. 공개 조건(백엔드 검증): 샵 공개 + 오너 승인 (AI 분석과 무관).
  // AI는 백그라운드로 계속 돌며 완료 시 검색 랭킹만 보강 — 공개(노출)를 막지 않는다.
  const publish = useMutation({
    mutationFn: (visibility: 'active' | 'hidden') => designsApi.changeVisibility(d.id, { visibility }),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e) => setActionError(toUserMessage(e)),
  });

  const zoomUrls = designImageUrls(d); // 확대 뷰에 넘길 사진 URL(대표 먼저)
  const photoCount = zoomUrls.length;

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start gap-3">
        {/* 대표 사진 — 클릭 시 상세 사진 펼침 */}
        <button
          type="button"
          onClick={() => photoCount > 0 && setZoomIndex(0)}
          disabled={photoCount === 0}
          className="relative h-28 w-28 shrink-0 overflow-hidden rounded-lg border border-neutral-200 disabled:cursor-default"
          title="사진 확대"
        >
          {d.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.thumbnail_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="block h-full w-full bg-neutral-100" />
          )}
          {photoCount > 0 && (
            <span className="absolute inset-x-0 bottom-0 bg-black/40 py-0.5 text-center text-caption font-semibold text-white">
              🔍 {photoCount}
            </span>
          )}
        </button>

        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{d.title}</p>
            <p className="mt-0.5 truncate text-caption text-primary-50">
              📁 {d.folder_name ?? '미분류'}
            </p>
            <p className="mt-0.5 text-body-sm text-primary-50">
              {d.intro_price != null && d.intro_price < d.base_price ? (
                <>
                  <span className="line-through">{formatWon(d.base_price)}</span>{' '}
                  <span className="font-semibold text-secondary">{formatWon(d.intro_price)}</span>
                </>
              ) : (
                formatWon(d.base_price)
              )}{' '}
              · 기본 {d.duration_minutes}분
            </p>
            {d.owner_tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {d.owner_tags.map((t) => (
                  <span key={`o-${t}`} className="rounded bg-secondary/10 px-2 py-0.5 text-caption text-secondary">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {!editing && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => {
                  setEditing(true);
                  setConfirmDel(false);
                  setActionError(null);
                }}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary hover:bg-neutral-50"
              >
                수정
              </button>
              {confirmDel ? (
                <span className="inline-flex items-center gap-1.5 text-caption text-primary-50">
                  삭제할까요?
                  <button
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                    className="rounded-md bg-danger-bg px-2.5 py-1.5 text-caption font-semibold text-danger disabled:opacity-50"
                  >
                    {remove.isPending ? '삭제 중…' : '삭제 확인'}
                  </button>
                  <button
                    onClick={() => setConfirmDel(false)}
                    className="rounded-md bg-neutral-100 px-2.5 py-1.5 text-caption font-semibold text-primary"
                  >
                    취소
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDel(true)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:bg-neutral-50"
                >
                  삭제
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 앱 노출(디자인별 공개) — 샵 공개와 별개로 디자인마다 공개해야 앱 피드에 노출된다.
          공개는 AI 분석과 무관(백엔드가 노출을 AI에서 분리). AI가 아직/실패여도 바로 공개할 수 있고,
          AI는 백그라운드로 돌며 완료 시 검색 랭킹만 보강한다. */}
      {!editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-caption text-primary-50">👁 앱 노출</span>
          {d.visibility === 'active' ? (
            <span className="rounded-full bg-success-bg px-2 py-0.5 text-caption font-semibold text-success">
              공개 중
            </span>
          ) : (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-semibold text-primary-50">
              비공개
            </span>
          )}
          {d.visibility === 'active' ? (
            <button
              onClick={() => publish.mutate('hidden')}
              disabled={publish.isPending}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:bg-neutral-50 disabled:opacity-50"
            >
              {publish.isPending ? '처리 중…' : '비공개로 전환'}
            </button>
          ) : (
            <button
              onClick={() => publish.mutate('active')}
              disabled={publish.isPending}
              className="rounded-md bg-secondary px-3 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
            >
              {publish.isPending ? '처리 중…' : '앱에 공개'}
            </button>
          )}
          {d.visibility !== 'active' && (
            <span className="text-caption text-primary-50">· 샵도 공개 상태여야 앱에 노출돼요</span>
          )}
          {(d.ai_analysis_status === 'pending' || d.ai_analysis_status === 'in_progress') && (
            <span className="text-caption text-primary-50">· AI 분석 중(공개엔 영향 없어요)</span>
          )}
        </div>
      )}

      {d.ai_analysis_status === 'failed' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="rounded-md bg-danger-bg p-2 text-caption text-danger">
            {d.ai_error_message ?? 'AI 분석에 실패했습니다.'}
          </div>
          {!editing && (
            <button
              onClick={() => reanalyze.mutate()}
              disabled={reanalyze.isPending}
              className="rounded-md bg-secondary px-3 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
            >
              {reanalyze.isPending ? '요청 중…' : '재분석'}
            </button>
          )}
        </div>
      )}

      {editing && <DesignEditForm design={d} onClose={() => setEditing(false)} />}

      {actionError && <p className="mt-2 text-caption text-danger">{actionError}</p>}

      {/* 사진 확대 뷰 — 수정 중에도 대표/상세 사진을 크게 볼 수 있다 */}
      <Lightbox urls={zoomUrls} index={zoomIndex} onIndex={setZoomIndex} onClose={() => setZoomIndex(null)} />
    </li>
  );
}
