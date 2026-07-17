'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designersApi, designsApi, uploadsApi } from '@/services';
import type { Design } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import {
  OPTION_KINDS,
  clampDuration,
  toOptionBody,
  DesignSettingsFields,
} from '../design-settings';
import type { OptionRow, OptionKind } from '../design-settings';
import type { EditPhoto } from './photo';
import { urlToObjectKey, MAX_EDIT_PHOTOS } from '../_lib/design-helpers';

/* ───────────── 디자인 수정 폼 ───────────── */

export function DesignEditForm({ design: d, onClose }: { design: Design; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(d.title);
  const [description, setDescription] = useState(d.description ?? '');
  const [price, setPrice] = useState(String(d.base_price));
  const [duration, setDuration] = useState(clampDuration(d.duration_minutes));
  const [tags, setTags] = useState<string[]>(d.owner_tags ?? []);
  const [err, setErr] = useState<string | null>(null);

  const designersQuery = useQuery({ queryKey: ['designers'], queryFn: () => designersApi.listDesigners() });
  const designers = designersQuery.data ?? [];
  const multiDesigner = designers.length >= 2;

  // designerId → 소요시간(분). 현재 이 디자인을 담당하는 디자이너로 초기화한다(다인샵 전용).
  const [picked, setPicked] = useState<Record<string, number>>(() =>
    Object.fromEntries((d.designers ?? []).map((dz) => [dz.id, clampDuration(dz.duration_minutes)])),
  );
  // designerId → 가격(원). 현재 담당 디자이너의 가격으로 초기화한다(다인샵 전용).
  const [pickedPrice, setPickedPrice] = useState<Record<string, number>>(() =>
    Object.fromEntries((d.designers ?? []).map((dz) => [dz.id, dz.base_price])),
  );

  // 추가옵션: 기존 옵션으로 초기화하고, 저장 시 원본과 비교해 추가/변경/삭제한다.
  const originalOptionsRef = useRef(d.options ?? []);
  const [options, setOptions] = useState<OptionRow[]>(() =>
    (d.options ?? []).map((o) => ({
      uid: crypto.randomUUID(),
      id: o.id,
      kind: (OPTION_KINDS.some((k) => k.value === o.kind) ? o.kind : 'extend') as OptionKind,
      name: o.name,
      priceDelta: o.price_delta,
      durationDelta: o.duration_delta_min ?? 0,
    })),
  );

  // 사진 편집: 기존 사진(URL→key 역추출) + 새 업로드를 통합 관리. index 0 = 대표사진.
  const [photos, setPhotos] = useState<EditPhoto[]>(() => {
    const imgs = [...(d.images ?? [])].sort((a, b) => Number(b.is_thumbnail) - Number(a.is_thumbnail));
    if (imgs.length > 0) {
      return imgs.map((i) => ({
        uid: i.id,
        key: urlToObjectKey(i.original_url),
        previewUrl: i.original_url,
        status: 'done' as const,
      }));
    }
    return d.thumbnail_url
      ? [{ uid: 'thumb', key: urlToObjectKey(d.thumbnail_url), previewUrl: d.thumbnail_url, status: 'done' as const }]
      : [];
  });
  const [photosDirty, setPhotosDirty] = useState(false);
  const photoUploading = photos.some((p) => p.status === 'uploading');

  const addPhotos = (list: FileList | null) => {
    if (!list) return;
    const room = MAX_EDIT_PHOTOS - photos.length;
    const files = Array.from(list)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, room);
    for (const file of files) {
      const uid = crypto.randomUUID();
      setPhotos((prev) => [...prev, { uid, key: '', previewUrl: URL.createObjectURL(file), status: 'uploading' }]);
      setPhotosDirty(true);
      uploadsApi
        .uploadFile(file, 'design')
        .then((r) =>
          setPhotos((prev) => prev.map((p) => (p.uid === uid ? { ...p, key: r.object_key, status: 'done' } : p))),
        )
        .catch((e) =>
          setPhotos((prev) =>
            prev.map((p) => (p.uid === uid ? { ...p, status: 'error', error: toUserMessage(e) } : p)),
          ),
        );
    }
  };
  const removePhoto = (uid: string) => {
    setPhotos((prev) => prev.filter((p) => p.uid !== uid));
    setPhotosDirty(true);
  };
  const makeThumbnail = (uid: string) => {
    setPhotos((prev) => {
      const t = prev.find((p) => p.uid === uid);
      if (!t) return prev;
      return [t, ...prev.filter((p) => p.uid !== uid)];
    });
    setPhotosDirty(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const designerIds = Object.keys(picked);
      const basePriceNum = Number(price) || 0;
      // 기본값과 다른 디자이너만 오버라이드로 전송(나머지는 기본값 사용) — 등록 폼과 동일한 규칙.
      const designerDurations = designerIds
        .filter((id) => picked[id] !== duration)
        .map((id) => ({ designer_id: id, duration_minutes: picked[id] }));
      const designerPrices = designerIds
        .filter((id) => (pickedPrice[id] ?? basePriceNum) !== basePriceNum)
        .map((id) => ({ designer_id: id, base_price: pickedPrice[id] ?? basePriceNum }));

      await designsApi.updateDesign(d.id, {
        title: title.trim(),
        description: description.trim() || null,
        base_price: basePriceNum,
        // 이달의 아트 인트로가(전용 할인가) 개념 제거 — 저장할 때마다 남아있던 인트로가도 지운다.
        intro_price: null,
        duration_minutes: clampDuration(duration),
        owner_tags: tags,
        // 사진을 바꿨을 때만 전체 세트를 전송(백엔드는 image_upload_keys를 통째로 교체).
        ...(photosDirty
          ? { image_upload_keys: photos.filter((p) => p.status === 'done').map((p) => p.key) }
          : {}),
        ...(multiDesigner
          ? { designer_ids: designerIds, designer_durations: designerDurations, designer_prices: designerPrices }
          : {}),
      });

      // 추가옵션 동기화: 삭제된 것 제거 → 이름 있는 줄은 추가/변경.
      const orig = originalOptionsRef.current;
      const keptIds = new Set(options.filter((o) => o.id).map((o) => o.id));
      for (const o of orig) {
        if (o.id && !keptIds.has(o.id)) await designsApi.deleteOption(d.id, o.id);
      }
      for (let i = 0; i < options.length; i += 1) {
        const r = options[i];
        const body = toOptionBody(r, i);
        if (r.id) {
          if (!r.name.trim()) {
            await designsApi.deleteOption(d.id, r.id); // 이름을 비우면 삭제
            continue;
          }
          const before = orig.find((o) => o.id === r.id);
          if (
            !before ||
            before.kind !== body.kind ||
            before.name !== body.name ||
            before.price_delta !== body.price_delta ||
            before.duration_delta_min !== body.duration_delta_min ||
            before.sort_order !== i
          ) {
            await designsApi.updateOption(d.id, r.id, body);
          }
        } else if (r.name.trim()) {
          const created = await designsApi.createOption(d.id, body);
          const optId = created.id;
          const uid = r.uid;
          // 생성된 옵션의 id를 로컬 상태에 반영 — 저장 재시도 시 create가 아닌 update 경로로 가도록(중복 생성 방지).
          setOptions((prev) => prev.map((o) => (o.uid === uid ? { ...o, id: optId } : o)));
        }
      }

    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
      onClose();
    },
    onError: (e) => setErr(toUserMessage(e)),
  });

  const attemptSave = () => {
    if (multiDesigner && Object.keys(picked).length === 0) {
      setErr('이 디자인을 할 수 있는 디자이너를 1명 이상 선택해주세요.');
      return;
    }
    if (photoUploading) {
      setErr('사진 업로드가 끝날 때까지 기다려주세요.');
      return;
    }
    if (photosDirty && photos.filter((p) => p.status === 'done').length === 0) {
      setErr('사진을 최소 1장 남겨주세요.');
      return;
    }
    setErr(null);
    save.mutate();
  };

  const inputCls =
    'w-full rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary';
  const labelCls = 'mb-1 block text-caption font-semibold text-primary-50';

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-secondary/30 bg-secondary/5 p-3">
      <div>
        <label className={labelCls}>제목 (관리용 · 고객 미노출)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
      </div>

      {/* 사진 편집 — 대표(첫 번째) + 상세. 삭제·추가·대표지정 가능 */}
      <div>
        <label className={labelCls}>
          사진 <span className="text-caption text-primary-50">첫 번째가 대표사진</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {photos.map((p, idx) => (
            <div key={p.uid} className="relative h-24 w-24 overflow-hidden rounded-md border border-neutral-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
              {idx === 0 && (
                <span className="absolute left-0 top-0 bg-secondary px-1.5 py-0.5 text-caption font-semibold text-white">
                  대표
                </span>
              )}
              {p.status === 'uploading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-caption text-white">
                  업로드 중…
                </div>
              )}
              {p.status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-600/70 px-1 text-center text-caption text-white">
                  {p.error ?? '실패'}
                </div>
              )}
              <button
                type="button"
                onClick={() => removePhoto(p.uid)}
                className="absolute right-0 top-0 bg-black/50 px-1 text-caption text-white"
                aria-label="사진 삭제"
              >
                ×
              </button>
              {idx !== 0 && p.status === 'done' && (
                <button
                  type="button"
                  onClick={() => makeThumbnail(p.uid)}
                  className="absolute inset-x-0 bottom-0 bg-black/50 py-0.5 text-center text-caption text-white hover:bg-black/70"
                >
                  대표로
                </button>
              )}
            </div>
          ))}
          {photos.length < MAX_EDIT_PHOTOS && (
            <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-neutral-300 text-primary-50 hover:border-secondary">
              <span className="text-2xl leading-none">+</span>
              <span className="mt-1 text-caption">사진 추가</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      </div>

      {/* 가격·디자이너·소요시간·설명·태그 (등록/일괄과 동일한 필드) */}
      <DesignSettingsFields
        designers={designers}
        value={{ price, duration, description, tags, picked, pickedPrice, options }}
        onChange={(p) => {
          if (p.price !== undefined) setPrice(p.price);
          if (p.duration !== undefined) setDuration(p.duration);
          if (p.description !== undefined) setDescription(p.description);
          if (p.tags !== undefined) setTags(p.tags);
          if (p.picked !== undefined) setPicked(p.picked);
          if (p.pickedPrice !== undefined) setPickedPrice(p.pickedPrice);
          if (p.options !== undefined) setOptions(p.options);
        }}
      />

      {err && <p className="text-caption text-danger">{err}</p>}

      <div className="flex gap-2">
        <button
          disabled={
            !title.trim() ||
            save.isPending ||
            photoUploading ||
            (multiDesigner && Object.keys(picked).length === 0)
          }
          onClick={attemptSave}
          className="rounded-md bg-secondary px-4 py-2 text-caption font-semibold text-white disabled:opacity-50"
        >
          {save.isPending ? '저장 중…' : '저장'}
        </button>
        <button
          onClick={onClose}
          className="rounded-md bg-neutral-100 px-4 py-2 text-caption font-semibold text-primary"
        >
          취소
        </button>
      </div>
    </div>
  );
}

