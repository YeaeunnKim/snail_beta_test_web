'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { designsApi, uploadsApi } from '@/services';
import type { Design, Designer } from '@/services';
import { collectAll } from '@/lib/api-client';
import { toUserMessage } from '@/lib/error-messages';
import {
  clampDuration,
  defaultBulkSettings,
  loadBulkSettings,
  saveBulkSettings,
  nextDesignNumber,
  toOptionBody,
  DesignSettingsFields,
} from '../design-settings';
import type { DesignSettings } from '../design-settings';
import { ImageCropper } from '@/components/ImageCropper';
import { PhotoTile, UploadTile } from './photo';
import type { PhotoItem } from './photo';
import { FolderField } from './folder-field';
import { Field, inputCls } from './field';
import { MAX_DETAIL_PHOTOS } from '../_lib/design-helpers';

export function CreateForm({
  designers,
  onCreated,
  defaultFolderId = '',
}: {
  designers: Designer[];
  onCreated: () => void;
  defaultFolderId?: string;
}) {
  const [thumbnail, setThumbnail] = useState<PhotoItem | null>(null);
  const [details, setDetails] = useState<PhotoItem[]>([]);
  const [cropFile, setCropFile] = useState<File | null>(null); // 대표 사진 선택 직후 크롭 대기 중인 원본 파일
  const [folderId, setFolderId] = useState<string>(defaultFolderId); // '' = 미선택(필수)
  const [title, setTitle] = useState('');
  // 제목을 사장님이 직접 고쳤는지. 고친 뒤에는 폴더를 바꿔도 자동제목으로 덮어쓰지 않는다.
  const [titleTouched, setTitleTouched] = useState(false);
  const [settings, setSettings] = useState<DesignSettings>(() => defaultBulkSettings());
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 등록 도중 일부 실패(옵션 등) 후 재시도할 때 디자인을 다시 만들지 않도록 보관.
  const createdIdRef = useRef<string | null>(null);
  // 이 폴더에 저장된 이전 공통설정(있으면 "불러오기" 배너 노출) — 반복 등록 편의.
  const [folderPreset, setFolderPreset] = useState<DesignSettings | null>(null);

  const uploading =
    thumbnail?.status === 'uploading' || details.some((p) => p.status === 'uploading');

  // 폴더를 고르면 그 폴더의 이전 설정이 있는지 확인한다.
  useEffect(() => {
    if (!folderId) {
      setFolderPreset(null);
      return;
    }
    setFolderPreset(loadBulkSettings(`snail_bulk_settings:${folderId}`, designers));
  }, [folderId, designers]);

  // 제목 자동생성: 선택한 폴더의 기존 디자인에서 다음 순번을 구해 "폴더명_001" 형식으로 채운다.
  // 폴더 안 일괄 업로드(BulkForm)와 동일한 규칙이라 순번이 폴더 기준으로 누적된다.
  const foldersQuery = useQuery({ queryKey: ['design-folders'], queryFn: () => designsApi.listFolders() });
  const selectedFolder = (foldersQuery.data ?? []).find((f) => f.id === folderId);
  const folderDesignsQuery = useQuery({
    queryKey: ['designs', 'folder', folderId || 'none', 'for-title'],
    queryFn: () =>
      collectAll<Design>((cursor) => designsApi.listDesigns({ folder_id: folderId, limit: 50, cursor })),
    enabled: !!folderId,
  });
  const autoTitle =
    selectedFolder && folderDesignsQuery.data
      ? `${selectedFolder.name}_${String(nextDesignNumber(selectedFolder.name, folderDesignsQuery.data)).padStart(3, '0')}`
      : '';

  // 사장님이 제목을 직접 고치기 전까지는 자동제목을 따라간다.
  useEffect(() => {
    if (!titleTouched) setTitle(autoTitle);
  }, [autoTitle, titleTouched]);

  // --- 사진 업로드 헬퍼 ---
  const startUpload = (file: File, onDone: (item: PhotoItem) => void) => {
    const id = crypto.randomUUID();
    const base: PhotoItem = {
      id,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
    };
    onDone(base);
    uploadsApi
      .uploadFile(file, 'design')
      .then((r) => updatePhoto(id, { status: 'done', objectKey: r.object_key }))
      .catch((e) => updatePhoto(id, { status: 'error', error: toUserMessage(e) }));
  };

  const updatePhoto = (id: string, patch: Partial<PhotoItem>) => {
    setThumbnail((t) => (t && t.id === id ? { ...t, ...patch } : t));
    setDetails((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  // 대표 사진은 바로 업로드하지 않고 먼저 크롭 스텝을 거친다(work order 20 · 등록 확장).
  const pickThumbnail = (file: File | undefined) => {
    if (!file) return;
    setCropFile(file);
  };
  const handleThumbnailCropped = (blob: Blob) => {
    if (!cropFile) return;
    const cropped = new File([blob], cropFile.name, { type: blob.type || cropFile.type });
    setCropFile(null);
    startUpload(cropped, (item) => setThumbnail(item));
  };
  const handleThumbnailCropSkip = () => {
    if (!cropFile) return;
    const original = cropFile;
    setCropFile(null);
    startUpload(original, (item) => setThumbnail(item));
  };
  const addDetails = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_DETAIL_PHOTOS - details.length;
    for (const file of Array.from(files).slice(0, room)) {
      startUpload(file, (item) => setDetails((list) => [...list, item].slice(0, MAX_DETAIL_PHOTOS)));
    }
  };
  const removeDetail = (id: string) => setDetails((list) => list.filter((it) => it.id !== id));

  // 제목은 비워두면 자동제목으로 등록된다(필수 아님).
  const effectiveTitle = title.trim() || autoTitle;

  const onSubmit = async () => {
    setFormError(null);
    if (!folderId) {
      setFormError('폴더를 선택하거나 새로 만들어주세요.');
      return;
    }
    if (!effectiveTitle) {
      setFormError('제목을 불러오는 중이에요. 잠시 후 다시 시도해주세요.');
      return;
    }
    if (!thumbnail || thumbnail.status !== 'done' || !thumbnail.objectKey) {
      setFormError('대표 스네일 사진 1장을 등록해주세요.');
      return;
    }
    const price = Number(settings.price);
    if (settings.price.trim() === '' || !Number.isFinite(price) || price < 0) {
      setFormError('가격을 입력해주세요.');
      return;
    }
    const multiDesigner = designers.length >= 2;
    let designerIds: string[];
    if (multiDesigner) {
      designerIds = Object.keys(settings.picked);
      if (designerIds.length === 0) {
        setFormError('이 디자인을 할 수 있는 디자이너를 1명 이상 선택해주세요.');
        return;
      }
    } else {
      if (designers.length === 0) {
        setFormError('먼저 디자이너 탭에서 디자이너를 등록해주세요.');
        return;
      }
      designerIds = [designers[0].id];
    }

    const detailKeys = details.filter((p) => p.status === 'done' && p.objectKey).map((p) => p.objectKey!);
    // 대표 사진이 image_upload_keys[0] → 썸네일로 사용된다.
    const imageKeys = [thumbnail.objectKey, ...detailKeys];

    // 기본값과 다른 디자이너만 오버라이드로 전송(다인샵 전용).
    const designerDurations = multiDesigner
      ? designerIds
          .filter((id) => settings.picked[id] !== settings.duration)
          .map((id) => ({ designer_id: id, duration_minutes: settings.picked[id] }))
      : [];
    const designerPrices = multiDesigner
      ? designerIds
          .filter((id) => (settings.pickedPrice[id] ?? price) !== price)
          .map((id) => ({ designer_id: id, base_price: settings.pickedPrice[id] ?? price }))
      : [];

    setSubmitting(true);
    try {
      // 이미 디자인 생성까지는 성공했던 재시도라면 새로 만들지 않고 같은 디자인에 이어서 진행.
      let designId = createdIdRef.current;
      if (!designId) {
        const created = await designsApi.createDesign({
          title: effectiveTitle,
          description: settings.description.trim() || null,
          base_price: price,
          intro_price: settings.introPrice.trim() ? Number(settings.introPrice) : null,
          duration_minutes: clampDuration(settings.duration),
          designer_ids: designerIds,
          designer_durations: designerDurations,
          designer_prices: designerPrices,
          folder_id: folderId || null,
          image_upload_keys: imageKeys,
          owner_tags: settings.tags,
        });
        designId = created.id;
        createdIdRef.current = designId;
      }
      // 옵션 생성: 이미 생성된 옵션(id 보유)은 갱신, 나머지만 생성 — 재시도 시 중복 생성 방지.
      for (let i = 0; i < settings.options.length; i += 1) {
        const r = settings.options[i];
        if (!r.name.trim()) continue;
        const body = toOptionBody(r, i);
        if (r.id) {
          await designsApi.updateOption(designId, r.id, body);
        } else {
          const created = await designsApi.createOption(designId, body);
          const optId = created.id;
          const uid = r.uid;
          setSettings((prev) => ({
            ...prev,
            options: prev.options.map((o) => (o.uid === uid ? { ...o, id: optId } : o)),
          }));
        }
      }
      if (folderId) saveBulkSettings(`snail_bulk_settings:${folderId}`, settings);
      onCreated();
    } catch (e) {
      setFormError(toUserMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {cropFile && (
        <ImageCropper
          file={cropFile}
          title="대표 사진 크롭"
          onCropped={handleThumbnailCropped}
          onSkip={handleThumbnailCropSkip}
          onCancel={() => setCropFile(null)}
        />
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-5 rounded-lg border border-neutral-200 bg-white p-5"
        noValidate
      >
        <h2 className="text-body-sm font-semibold text-primary">새 디자인 등록</h2>

      {/* 대표 사진 */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          <label className="text-body-sm font-medium">대표 스네일 사진</label>
          <span className="text-danger">*</span>
        </div>
        <p className="mb-2 text-caption text-primary-50">
          고객에게 <strong className="text-primary-50">썸네일</strong>로 노출되는 사진입니다. 1장 필수.
        </p>
        <div className="flex flex-wrap gap-2">
          {thumbnail ? (
            <PhotoTile photo={thumbnail} onRemove={() => setThumbnail(null)} badge="대표" />
          ) : (
            <UploadTile label="대표 사진" onFiles={(f) => pickThumbnail(f?.[0])} />
          )}
        </div>
      </div>

      {/* 상세 사진 */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          <label className="text-body-sm font-medium">상세 사진</label>
          <span className="text-caption text-primary-50">선택 · 최대 {MAX_DETAIL_PHOTOS}장</span>
        </div>
        <p className="mb-2 text-caption text-primary-50">손 후기 사진 등 자유롭게 추가할 수 있어요.</p>
        <div className="flex flex-wrap gap-2">
          {details.map((p) => (
            <PhotoTile key={p.id} photo={p} onRemove={() => removeDetail(p.id)} />
          ))}
          {details.length < MAX_DETAIL_PHOTOS && (
            <UploadTile label="추가" multiple onFiles={(f) => addDetails(f)} />
          )}
        </div>
      </div>

      {/* 제목 (관리용) */}
      <Field
        label="제목 (관리용)"
        hint="폴더를 고르면 자동으로 지어집니다. 직접 고쳐도 되고, 비우면 자동 제목으로 등록돼요. 사장님 관리용 이름이라 고객에게는 노출되지 않습니다."
      >
        <input
          className={inputCls}
          value={title}
          onChange={(e) => {
            setTitleTouched(true);
            setTitle(e.target.value);
          }}
          placeholder={autoTitle || '폴더를 먼저 선택하세요'}
        />
      </Field>

      {/* 폴더 */}
      <FolderField value={folderId} onChange={setFolderId} />
      {folderPreset && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-secondary/10 px-3 py-2 text-caption text-primary">
          <span className="flex-1">이 폴더에 저장된 이전 설정(가격·디자이너·태그·추가옵션)이 있어요.</span>
          <button
            type="button"
            onClick={() => {
              setSettings(folderPreset);
              setFolderPreset(null);
            }}
            className="rounded-md bg-secondary px-3 py-1.5 font-semibold text-white"
          >
            이전 설정 불러오기
          </button>
          <button
            type="button"
            onClick={() => setFolderPreset(null)}
            className="px-2 py-1 font-semibold text-primary-50"
          >
            닫기
          </button>
        </div>
      )}

      {designers.length === 0 && (
        <p className="text-caption text-primary-50">
          등록된 디자이너가 없습니다.{' '}
          <Link href="/dashboard/designers" className="text-secondary underline">
            디자이너
          </Link>{' '}
          탭에서 먼저 추가하세요.
        </p>
      )}

      {/* 가격·디자이너별 소요시간/가격·설명·태그·추가옵션 (더미·수정 폼과 동일) */}
      <DesignSettingsFields
        designers={designers}
        value={settings}
        onChange={(p) => setSettings((prev) => ({ ...prev, ...p }))}
      />

      {formError && <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">{formError}</p>}

      <button
        type="submit"
        disabled={submitting || uploading}
        className="rounded-md bg-secondary px-5 py-2 text-body-sm font-semibold text-white disabled:opacity-50"
      >
        {submitting ? '등록 중…' : uploading ? '사진 업로드 중…' : '디자인 등록'}
      </button>
      </form>
    </>
  );
}
