'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designsApi } from '@/services';
import type { Design } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import { Lightbox } from './photo';
import { designImageUrls, formatWon } from '../_lib/design-helpers';
import { useDebouncedSave } from '../_lib/use-debounced-save';
import { priceRange, durationRange } from '../_lib/designer-values';
import { DesignEditForm } from './design-edit-form';
import { DesignerRows } from './designer-rows';
import { Stepper, TagInput, PRICE_INPUT_STEP, DURATION_STEP, clampPrice, clampDuration } from '../design-settings';

/* ───────────── 디자인 카드 ───────────── */

export function DesignCard({
  design,
  editMode,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: {
  design: Design;
  editMode: boolean;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState<number | null>(null); // null = 확대 뷰 닫힘
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [moveErr, setMoveErr] = useState<string | null>(null);

  // 인라인 편집 중인 값(낙관적). null이면 서버 값을 그대로 쓴다.
  const [draftPrice, setDraftPrice] = useState<number | null>(null);
  const [draftDuration, setDraftDuration] = useState<number | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  // 태그는 ± 스테퍼처럼 연타 대상이 아니라서(× 클릭·Enter 등록 모두 단발 동작) 디바운스 없이 즉시 저장한다.
  const [draftTags, setDraftTags] = useState<string[] | null>(null);

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

  // 디자이너별 가격·소요시간 범위 — 전부 같으면 단일 표시, 다르면 "min~max ▾"로 펼침 토글.
  const pr = priceRange(d);
  const dr = durationRange(d);
  const [showDesigners, setShowDesigners] = useState(false);
  const hasVariance = !pr.uniform || !dr.uniform;

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

  // 폴더 이동용 — 폴더 목록(부모와 동일 캐시 재사용) + 이동 뮤테이션. 수정 ON일 때만 사용.
  const foldersQuery = useQuery({ queryKey: ['design-folders'], queryFn: () => designsApi.listFolders() });
  const folders = foldersQuery.data ?? [];
  const move = useMutation({
    mutationFn: (folderId: string) => designsApi.updateDesign(d.id, { folder_id: folderId || null }),
    onSuccess: () => {
      setMoveErr(null);
      qc.invalidateQueries({ queryKey: ['designs'] });
      qc.invalidateQueries({ queryKey: ['design-folders'] });
      qc.invalidateQueries({ queryKey: ['design', d.id] });
    },
    onError: (e) => setMoveErr(toUserMessage(e)),
  });

  // 카드 인라인 가격·소요시간 편집 — ± 연타를 800ms 디바운스로 묶어 PATCH 1회만 보낸다.
  // 서버 폴링(refetchInterval)이 편집 중인 값을 덮어쓰지 않도록 draft가 있으면 draft를 우선 보여준다.
  const patch = useMutation({
    mutationFn: (body: { base_price?: number; duration_minutes?: number }) =>
      designsApi.updateDesign(d.id, body),
    // 가격·시간은 각자 디바운스라 뮤테이션을 공유해도 요청엔 한 필드만 담긴다.
    // 방금 저장한 필드의 draft만 정리해야, 겹쳐 편집 중인 다른 필드 draft가 날아가지 않는다.
    onSuccess: (_data, vars) => {
      setSaveErr(null);
      if (vars.base_price !== undefined) setDraftPrice(null);
      if (vars.duration_minutes !== undefined) setDraftDuration(null);
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e, vars) => {
      // 롤백 — 실패한 필드의 draft만 버리고 서버 값으로 되돌린다
      if (vars.base_price !== undefined) setDraftPrice(null);
      if (vars.duration_minutes !== undefined) setDraftDuration(null);
      setSaveErr(toUserMessage(e));
    },
  });

  const savePrice = useDebouncedSave<number>((v) => patch.mutate({ base_price: v }));
  const saveDuration = useDebouncedSave<number>((v) => patch.mutate({ duration_minutes: v }));

  const shownPrice = draftPrice ?? d.base_price;
  const shownDuration = draftDuration ?? d.duration_minutes;

  // 카드 인라인 태그 편집 — × 삭제·Enter 등록 모두 그 자리에서 바로 PATCH 1건을 보낸다(디바운스 없음).
  const patchTags = useMutation({
    mutationFn: (owner_tags: string[]) => designsApi.updateDesign(d.id, { owner_tags }),
    onSuccess: () => {
      setSaveErr(null);
      setDraftTags(null);
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e) => {
      setDraftTags(null); // 롤백 — 서버 값(d.owner_tags)으로 되돌아간다
      setSaveErr(toUserMessage(e));
    },
  });

  const shownTags = draftTags ?? d.owner_tags;

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

  if (selectMode) {
    return (
      <li>
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={selected}
          className={`flex w-full items-center gap-3 rounded-lg border p-4 text-left transition ${
            selected ? 'border-secondary bg-secondary/5' : 'border-neutral-200 bg-white hover:bg-neutral-50'
          }`}
        >
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-caption font-bold ${
              selected ? 'border-secondary bg-secondary text-white' : 'border-neutral-300 bg-white text-transparent'
            }`}
            aria-hidden
          >
            ✓
          </span>
          <span className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-neutral-200">
            {d.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.thumbnail_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="block h-full w-full bg-neutral-100" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{d.title}</span>
            <span className="block truncate text-caption text-primary-50">
              📁 {d.folder_name ?? '미분류'} · {d.visibility === 'active' ? '공개 중' : '비공개'}
            </span>
          </span>
        </button>
      </li>
    );
  }

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
            {editMode ? (
              <select
                value={d.folder_id ?? ''}
                onChange={(e) => move.mutate(e.target.value)}
                disabled={move.isPending}
                className="mt-0.5 rounded-md border border-neutral-300 bg-white px-2 py-1 text-caption outline-none focus:border-secondary disabled:opacity-50"
                aria-label="폴더 이동"
              >
                <option value="">미분류</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-0.5 truncate text-caption text-primary-50">📁 {d.folder_name ?? '미분류'}</p>
            )}
            {editMode && move.isPending && <p className="mt-0.5 text-caption text-primary-50">이동 중…</p>}
            {editMode && moveErr && <p className="mt-0.5 text-caption text-danger">{moveErr}</p>}
            {editMode ? (
              <div className="mt-1 flex flex-col gap-1.5">
                <Stepper
                  value={shownPrice}
                  step={PRICE_INPUT_STEP}
                  suffix="원"
                  ariaLabel="가격"
                  onChange={(v) => {
                    const next = clampPrice(v);
                    setDraftPrice(next);
                    savePrice(next);
                  }}
                />
                <Stepper
                  value={shownDuration}
                  step={DURATION_STEP}
                  suffix="분"
                  ariaLabel="소요시간"
                  onChange={(v) => {
                    const next = clampDuration(v);
                    setDraftDuration(next);
                    saveDuration(next);
                  }}
                />
                {saveErr && <span className="text-caption text-danger">{saveErr}</span>}
              </div>
            ) : (
              <p className="mt-0.5 text-body-sm text-primary-50">
                {pr.uniform ? (
                  formatWon(d.base_price)
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowDesigners((v) => !v)}
                    className="text-body-sm text-primary-50"
                  >
                    {formatWon(pr.min)}~{formatWon(pr.max)} {showDesigners ? '▴' : '▾'}
                  </button>
                )}
                {' · '}
                {dr.uniform ? `${d.duration_minutes}분` : `${dr.min}~${dr.max}분`}
              </p>
            )}
            {(showDesigners || (editMode && hasVariance)) && <DesignerRows design={d} editMode={editMode} />}
            {editMode ? (
              <div className="mt-2">
                <TagInput
                  tags={shownTags}
                  onChange={(next) => {
                    setDraftTags(next);
                    patchTags.mutate(next);
                  }}
                />
              </div>
            ) : (
              d.owner_tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {d.owner_tags.map((t) => (
                    <span key={`o-${t}`} className="rounded bg-secondary/10 px-2 py-0.5 text-caption text-secondary">
                      #{t}
                    </span>
                  ))}
                </div>
              )
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
