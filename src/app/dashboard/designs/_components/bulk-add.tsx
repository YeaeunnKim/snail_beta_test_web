'use client';

import { useRef, useState } from 'react';
import { designsApi, uploadsApi } from '@/services';
import type { Designer } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import {
  clampDuration,
  createOptionsFor,
  defaultBulkSettings,
  loadBulkSettings,
  saveBulkSettings,
  DesignSettingsFields,
} from '../design-settings';
import type { DesignSettings } from '../design-settings';

/* ───────────── 일괄 등록 (드롭존 + 공통설정 모달) ───────────── */

/** 폴더 안에서 여러 사진을 한번에 올리는 드롭존. */
export function BulkDropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [drag, setDrag] = useState(false);
  const pick = (list: FileList | null) => {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (imgs.length) onFiles(imgs);
  };
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        pick(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-6 text-center transition ${
        drag ? 'border-secondary bg-secondary/5' : 'border-neutral-300 hover:border-secondary'
      }`}
    >
      <span className="text-2xl">🖼️</span>
      <span className="text-body-sm font-semibold text-primary">사진 여러 장 한번에 올리기</span>
      <span className="text-caption text-primary-50">
        컴퓨터에서 끌어다 놓거나, 눌러서 갤러리에서 여러 장 선택하세요. 각 사진이 대표사진인 디자인이 만들어져요.
      </span>
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/** 일괄 등록 모달: 공통설정 입력 → 사진마다 디자인 1개씩 생성(제목 자동번호). */
export function BulkAddModal({
  folderId,
  folderName,
  files,
  startNumber,
  designers,
  onClose,
  onCreated,
}: {
  folderId: string;
  folderName: string;
  files: File[];
  startNumber: number;
  designers: Designer[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const multiDesigner = designers.length >= 2;
  const storageKey = `snail_bulk_settings:${folderId}`;

  const savedRef = useRef<DesignSettings | null | undefined>(undefined);
  if (savedRef.current === undefined) savedRef.current = loadBulkSettings(storageKey, designers);
  const hasSaved = !!savedRef.current;

  const [step, setStep] = useState<'confirm' | 'form'>(hasSaved ? 'confirm' : 'form');
  const [settings, setSettings] = useState<DesignSettings>(() => savedRef.current ?? defaultBulkSettings());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const pad = (n: number) => String(n).padStart(3, '0');
  const titlePreview =
    files.length === 1
      ? `${folderName}_${pad(startNumber)}`
      : `${folderName}_${pad(startNumber)} ~ ${folderName}_${pad(startNumber + files.length - 1)}`;

  const runCreate = async (s: DesignSettings) => {
    setErr(null);
    const price = Number(s.price);
    if (!Number.isFinite(price) || price < 0 || s.price.trim() === '') {
      setErr('가격을 입력해주세요.');
      setStep('form');
      return;
    }
    let designerIds: string[];
    if (multiDesigner) {
      designerIds = Object.keys(s.picked);
      if (designerIds.length === 0) {
        setErr('디자이너를 1명 이상 선택해주세요.');
        setStep('form');
        return;
      }
    } else {
      if (designers.length === 0) {
        setErr('먼저 디자이너 탭에서 디자이너를 등록해주세요.');
        setStep('form');
        return;
      }
      designerIds = [designers[0].id];
    }
    const designerDurations = multiDesigner
      ? designerIds
          .filter((id) => s.picked[id] !== s.duration)
          .map((id) => ({ designer_id: id, duration_minutes: s.picked[id] }))
      : [];
    // 기본가격과 다른 디자이너만 오버라이드로 전송(다인샵 전용).
    const designerPrices = multiDesigner
      ? designerIds
          .filter((id) => (s.pickedPrice[id] ?? price) !== price)
          .map((id) => ({ designer_id: id, base_price: s.pickedPrice[id] ?? price }))
      : [];

    saveBulkSettings(storageKey, s);

    setProgress({ done: 0, total: files.length });
    const failed: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const title = `${folderName}_${pad(startNumber + i)}`;
      try {
        const up = await uploadsApi.uploadFile(files[i], 'design');
        const created = await designsApi.createDesign({
          title,
          description: s.description.trim() || null,
          base_price: price,
          intro_price: null,
          duration_minutes: clampDuration(s.duration),
          designer_ids: designerIds,
          designer_durations: designerDurations,
          designer_prices: designerPrices,
          folder_id: folderId,
          image_upload_keys: [up.object_key],
          owner_tags: s.tags,
        });
        await createOptionsFor(created.id, s.options);
      } catch (e) {
        failed.push(`${title}: ${toUserMessage(e)}`);
      }
      setProgress({ done: i + 1, total: files.length });
    }

    onCreated(); // 성공분 즉시 반영
    if (failed.length === 0) {
      onClose();
    } else {
      setFailures(failed);
      setProgress(null);
    }
  };

  const running = progress !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={running ? undefined : onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-heading-md font-bold">여러 디자인 한번에 등록</h2>
        <p className="mt-1 text-body-sm text-primary-50">
          사진 <strong className="text-primary">{files.length}장</strong> → 「{folderName}」 폴더에 디자인 {files.length}개
          <br />
          제목: <span className="font-semibold text-primary">{titlePreview}</span> (자동)
        </p>

        {/* 등록 진행 중 */}
        {running ? (
          <div className="mt-5">
            <p className="text-body-sm font-semibold text-primary">
              등록 중… {progress!.done}/{progress!.total}
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
              <div
                className="h-full bg-secondary transition-all"
                style={{ width: `${(progress!.done / progress!.total) * 100}%` }}
              />
            </div>
          </div>
        ) : failures.length > 0 ? (
          /* 일부 실패 결과 */
          <div className="mt-5 space-y-3">
            <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">
              {files.length - failures.length}개 등록 완료, {failures.length}개 실패:
            </p>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-caption text-danger">
              {failures.map((f, i) => (
                <li key={i}>• {f}</li>
              ))}
            </ul>
            <button
              onClick={onClose}
              className="w-full rounded-md bg-secondary py-2.5 text-body-sm font-semibold text-white"
            >
              닫기
            </button>
          </div>
        ) : step === 'confirm' ? (
          /* 이전 공통설정 유지? */
          <div className="mt-5 space-y-3">
            <p className="rounded-md bg-secondary/10 px-3 py-2 text-body-sm text-primary">
              이전에 저장한 공통설정(가격·디자이너·태그 등)을 그대로 쓸까요?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => runCreate(savedRef.current!)}
                className="flex-1 rounded-md bg-secondary py-2.5 text-body-sm font-semibold text-white"
              >
                예, 바로 등록
              </button>
              <button
                onClick={() => setStep('form')}
                className="flex-1 rounded-md border border-neutral-300 py-2.5 text-body-sm font-semibold text-primary"
              >
                아니요, 설정 바꾸기
              </button>
            </div>
            <button onClick={onClose} className="w-full py-1 text-caption text-primary-50">
              취소
            </button>
          </div>
        ) : (
          /* 공통설정 입력 폼 (개별 수정 팝업과 동일한 필드) */
          <div className="mt-5 space-y-3">
            <p className="rounded-md bg-secondary/10 px-3 py-2 text-caption text-primary">
              여기서 정한 값은 이번에 올리는 모든 디자인에 공통 적용돼요. 등록 후 디자인을 하나씩 눌러 개별로 수정할 수 있어요.
            </p>
            <DesignSettingsFields
              designers={designers}
              value={settings}
              onChange={(p) => setSettings((prev) => ({ ...prev, ...p }))}
            />
            {err && <p className="text-caption text-danger">{err}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => runCreate(settings)}
                className="flex-1 rounded-md bg-secondary py-2.5 text-body-sm font-semibold text-white"
              >
                {files.length}개 등록
              </button>
              <button
                onClick={onClose}
                className="rounded-md border border-neutral-300 px-4 py-2.5 text-body-sm font-semibold text-primary"
              >
                취소
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
