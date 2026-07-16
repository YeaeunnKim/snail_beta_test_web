'use client';

/**
 * 폴더·미분류·샵 전체 공용 현황판. 값 하나짜리(가격·소요시간)는 ApplyPreview로 골라 적용하고,
 * 목록짜리(태그·옵션)는 현황에서 추가/제거한다. 모든 실제 적용은 applyToMany N번 루프를 거친다.
 */
import { useState } from 'react';
import type { Design } from '@/services';
import { designsApi } from '@/services';
import { applyToMany, type ApplyResult } from '../_lib/apply';
import { groupByValue } from '../_lib/standards';
import { formatWon } from '../_lib/design-helpers';
import { PRICE_INPUT_STEP, DURATION_STEP, clampPrice, clampDuration } from '../design-settings';
import { ApplyPreview, type PreviewCfg } from './apply-preview';

export function StandardsPanel({
  scopeLabel,
  designs,
  onClose,
  onDone,
}: {
  scopeLabel: string;
  designs: Design[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ApplyResult<Design> | null>(null);
  const [lastFn, setLastFn] = useState<((d: Design) => Promise<void>) | null>(null);
  const [preview, setPreview] = useState<PreviewCfg | null>(null);

  // 모든 일괄 작업의 단일 통로. 진행률·결과를 한 곳에서 보여주고, 실패 시 같은 fn으로 재시도한다.
  const runBulk = async (targets: Design[], fn: (d: Design) => Promise<void>) => {
    if (targets.length === 0) return;
    setLastFn(() => fn);
    setResult(null);
    setProgress({ done: 0, total: targets.length });
    const r = await applyToMany(targets, fn, (done, total) => setProgress({ done, total }));
    setProgress(null);
    setResult(r);
    onDone();
  };

  const openPrice = () =>
    setPreview({
      title: `「${scopeLabel}」 가격 일괄 변경`,
      unit: '원',
      step: PRICE_INPUT_STEP,
      clamp: clampPrice,
      format: formatWon,
      groupResult: groupByValue(designs, (d) => d.base_price),
      apply: (targets: Design[], value: number) =>
        runBulk(targets, async (d) => {
          await designsApi.updateDesign(d.id, { base_price: value });
        }),
    });

  const openDuration = () =>
    setPreview({
      title: `「${scopeLabel}」 소요시간 일괄 변경`,
      unit: '분',
      step: DURATION_STEP,
      clamp: clampDuration,
      format: (n) => `${n}분`,
      groupResult: groupByValue(designs, (d) => d.duration_minutes),
      apply: (targets: Design[], value: number) =>
        runBulk(targets, async (d) => {
          await designsApi.updateDesign(d.id, { duration_minutes: value });
        }),
    });

  const busy = progress !== null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-heading-md font-bold">「{scopeLabel}」 현황판</h2>
          <button onClick={onClose} className="px-1 text-primary-50" aria-label="닫기">
            ✕
          </button>
        </div>
        <p className="mt-1 text-caption text-primary-50">디자인 {designs.length}개</p>

        {/* 값 하나짜리 — 가격·소요시간 */}
        <section className="mt-4 space-y-2">
          <h3 className="text-body-sm font-semibold text-primary">기본 값 맞추기</h3>
          <div className="flex gap-2">
            <button
              onClick={openPrice}
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-caption font-semibold text-primary hover:bg-neutral-50"
            >
              가격 일괄 변경
            </button>
            <button
              onClick={openDuration}
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-caption font-semibold text-primary hover:bg-neutral-50"
            >
              소요시간 일괄 변경
            </button>
          </div>
        </section>

        {/* 태그 현황판 — Task 4에서 채운다 */}
        {/* 옵션 현황판 — Task 5에서 채운다 */}

        {/* 공용 진행/결과 푸터 */}
        {busy && (
          <p className="mt-4 text-caption text-primary-50">처리 중… {progress!.done}/{progress!.total}</p>
        )}
        {result && result.failed.length > 0 && (
          <div className="mt-4 rounded-md bg-danger-bg p-2">
            <p className="text-caption font-semibold text-danger">
              {result.ok.length}개 완료, {result.failed.length}개 실패
            </p>
            <button
              onClick={() => lastFn && runBulk(result.failed.map((f) => f.target), lastFn)}
              className="mt-1 rounded-md border border-danger/40 px-2.5 py-1 text-caption font-semibold text-danger"
            >
              실패한 것만 재시도
            </button>
          </div>
        )}
        {result && result.failed.length === 0 && result.ok.length > 0 && (
          <p className="mt-4 text-caption text-success">{result.ok.length}개 완료</p>
        )}

        {preview && <ApplyPreview cfg={preview} onClose={() => setPreview(null)} />}
      </div>
    </div>
  );
}
