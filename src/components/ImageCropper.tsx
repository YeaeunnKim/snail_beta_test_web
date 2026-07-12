'use client';

/**
 * 브라우저 Canvas + Pointer Events만으로 동작하는 최소 이미지 크롭 도구.
 *
 * work-order 20 제약: 외부 라이브러리(react-easy-crop/cropperjs 등) 의존성 금지.
 * 접근성/폴리시는 최소 수준으로 두고, 정확한 크롭 결과 Blob 산출을 핵심으로 한다.
 * (드래그로 박스 이동 + 우측 하단 손잡이로 크기 조절, 확정 시 canvas로 잘라 Blob 반환)
 */
import { useEffect, useRef, useState } from 'react';

interface CropRect {
  /** 아래 값들은 모두 "화면에 표시된(css px)" 이미지 기준 좌표 — 확정 시 natural 픽셀로 환산한다. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_SIZE = 24; // 최소 크롭 박스 크기(css px)
const HANDLE_SIZE = 18;

export interface ImageCropperProps {
  /** 크롭할 원본 파일 */
  file: File;
  /** 크롭 확정 시 결과 Blob과 함께 호출 */
  onCropped: (blob: Blob) => void;
  /** 전체 취소(모달 닫기 등) */
  onCancel: () => void;
  /** 지정 시 "크롭 없이 원본 사용" 버튼을 노출한다(일괄 등록처럼 스킵 가능해야 하는 흐름용). */
  onSkip?: () => void;
  /** 크롭 박스 가로:세로 고정 비율(미지정 시 자유 비율) */
  aspect?: number;
  /** 상단에 노출할 안내 타이틀(예: "사진 2/5 크롭") */
  title?: string;
}

/** 값을 [0, bounds] 범위로 자르고, 박스 크기가 최소값 미만/이미지 범위 초과가 되지 않도록 보정한다. */
function clampRect(r: CropRect, bounds: { w: number; h: number }): CropRect {
  let w = Math.max(MIN_SIZE, Math.min(r.w, bounds.w));
  let h = Math.max(MIN_SIZE, Math.min(r.h, bounds.h));
  let x = Math.max(0, Math.min(r.x, bounds.w - w));
  let y = Math.max(0, Math.min(r.y, bounds.h - h));
  return { x, y, w, h };
}

export function ImageCropper({ file, onCropped, onCancel, onSkip, aspect, title }: ImageCropperProps) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<CropRect | null>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize'; startX: number; startY: number; startRect: CropRect } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 파일 → object URL. 언마운트/파일 변경 시 반드시 해제(메모리 누수 방지).
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    setDisplaySize({ w, h });
    // 초기 크롭 박스: 이미지 중앙에 80% 크기(aspect 지정 시 비율 유지).
    const ratio = aspect ?? w / h;
    let boxW = w * 0.8;
    let boxH = ratio > 0 ? boxW / ratio : h * 0.8;
    if (boxH > h * 0.8) {
      boxH = h * 0.8;
      boxW = ratio > 0 ? boxH * ratio : boxW;
    }
    setRect(clampRect({ x: (w - boxW) / 2, y: (h - boxH) / 2, w: boxW, h: boxH }, { w, h }));
  };

  const onPointerDownBox = (e: React.PointerEvent) => {
    if (!rect) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { mode: 'move', startX: e.clientX, startY: e.clientY, startRect: rect };
  };

  const onPointerDownHandle = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!rect) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { mode: 'resize', startX: e.clientX, startY: e.clientY, startRect: rect };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !displaySize) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.mode === 'move') {
      setRect(clampRect({ ...drag.startRect, x: drag.startRect.x + dx, y: drag.startRect.y + dy }, displaySize));
    } else {
      let w = drag.startRect.w + dx;
      let h = aspect ? w / aspect : drag.startRect.h + dy;
      setRect(clampRect({ ...drag.startRect, w, h }, displaySize));
    }
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const confirm = async () => {
    const img = imgRef.current;
    if (!img || !rect || !displaySize) return;
    setBusy(true);
    setError(null);
    try {
      // 화면 표시 좌표 → natural(원본) 픽셀 좌표로 환산.
      const scaleX = img.naturalWidth / displaySize.w;
      const scaleY = img.naturalHeight / displaySize.h;
      const sx = Math.round(rect.x * scaleX);
      const sy = Math.round(rect.y * scaleY);
      const sw = Math.max(1, Math.round(rect.w * scaleX));
      const sh = Math.max(1, Math.round(rect.h * scaleY));

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas context 생성에 실패했습니다.');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type || 'image/png'));
      if (!blob) throw new Error('크롭 이미지를 생성하지 못했습니다.');
      onCropped(blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : '크롭에 실패했습니다.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4">
        <p className="mb-1 text-body-sm font-semibold text-primary">{title ?? '사진 크롭'}</p>
        <p className="mb-3 text-caption text-primary-50">
          박스를 끌어 위치를 옮기고, 우측 하단 손잡이로 크기를 조절한 뒤 확정하세요.
        </p>
        <div
          className="relative mx-auto touch-none select-none"
          style={displaySize ? { width: displaySize.w, height: displaySize.h } : undefined}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {imgUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={imgUrl}
              alt=""
              onLoad={onImgLoad}
              draggable={false}
              className="block max-h-[60vh] max-w-full select-none"
            />
          )}
          {rect && (
            <div
              onPointerDown={onPointerDownBox}
              className="absolute cursor-move border-2 border-secondary bg-secondary/10"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            >
              <div
                onPointerDown={onPointerDownHandle}
                className="absolute rounded-full border-2 border-white bg-secondary"
                style={{
                  right: -HANDLE_SIZE / 2,
                  bottom: -HANDLE_SIZE / 2,
                  width: HANDLE_SIZE,
                  height: HANDLE_SIZE,
                  cursor: 'nwse-resize',
                }}
              />
            </div>
          )}
        </div>
        {error && <p className="mt-2 text-caption text-danger">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={busy || !rect}
            className="flex-1 rounded-md bg-secondary py-2.5 text-body-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? '처리 중…' : '크롭 확정'}
          </button>
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              disabled={busy}
              className="rounded-md border border-neutral-300 px-3 py-2.5 text-body-sm font-semibold text-primary disabled:opacity-50"
            >
              원본 그대로
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-neutral-300 px-3 py-2.5 text-body-sm font-semibold text-primary-50 disabled:opacity-50"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
