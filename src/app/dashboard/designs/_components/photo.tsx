'use client';

import { useEffect } from 'react';

export interface PhotoItem {
  id: string;
  name: string;
  previewUrl: string;
  objectKey?: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

/** 디자인 수정 시 사진 편집용. 기존 사진(key는 URL에서 역추출)과 새 업로드를 함께 다룬다. */
export interface EditPhoto {
  uid: string;
  key: string; // object_key ('' = 업로드 중)
  previewUrl: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

/* ───────────── 사진 타일 ───────────── */

export function PhotoTile({ photo: p, onRemove, badge }: { photo: PhotoItem; onRemove: () => void; badge?: string }) {
  return (
    <div className="relative h-24 w-24 overflow-hidden rounded-md border border-neutral-200">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.previewUrl} alt={p.name} className="h-full w-full object-cover" />
      {badge && (
        <span className="absolute left-0 top-0 bg-secondary px-1.5 py-0.5 text-caption font-semibold text-white">
          {badge}
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
        onClick={onRemove}
        className="absolute right-0 top-0 bg-black/50 px-1 text-caption text-white"
        aria-label="삭제"
      >
        ×
      </button>
    </div>
  );
}

export function UploadTile({
  label,
  multiple,
  onFiles,
}: {
  label: string;
  multiple?: boolean;
  onFiles: (files: FileList | null) => void;
}) {
  return (
    <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-neutral-300 text-primary-50 hover:border-secondary">
      <span className="text-2xl leading-none">+</span>
      <span className="mt-1 text-caption">{label}</span>
      <input
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/* ───────────── 사진 확대 뷰(라이트박스) ───────────── */

/** 전체화면 사진 확대 뷰. 배경 클릭·ESC로 닫고, 좌우 버튼/화살표키로 넘긴다. */
export function Lightbox({
  urls,
  index,
  onIndex,
  onClose,
}: {
  urls: string[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (index == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onIndex((index - 1 + urls.length) % urls.length);
      else if (e.key === 'ArrowRight') onIndex((index + 1) % urls.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, urls.length, onIndex, onClose]);

  if (index == null || !urls[index]) return null;
  const many = urls.length > 1;
  const btnCls =
    'absolute grid h-11 w-11 place-items-center rounded-full bg-white/15 text-heading-md text-white hover:bg-white/25';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button type="button" onClick={onClose} aria-label="닫기" className={`${btnCls} right-4 top-4`}>
        ×
      </button>
      {many && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndex((index - 1 + urls.length) % urls.length);
          }}
          aria-label="이전 사진"
          className={`${btnCls} left-3`}
        >
          ‹
        </button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={urls[index]}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] max-w-[92vw] rounded-lg object-contain"
      />
      {many && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndex((index + 1) % urls.length);
          }}
          aria-label="다음 사진"
          className={`${btnCls} right-3`}
        >
          ›
        </button>
      )}
      {many && (
        <div className="absolute bottom-5 rounded-full bg-black/50 px-3 py-1 text-caption text-white">
          {index + 1} / {urls.length}
        </div>
      )}
    </div>
  );
}
