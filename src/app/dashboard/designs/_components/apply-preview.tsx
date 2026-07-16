'use client';

/**
 * 값 하나짜리(가격·소요시간·옵션 delta) 일괄 변경 미리보기.
 * groupByValue 결과를 받아 "값이 같던 무리"만 기본 체크하고, 따로 수정된 무리는 체크 해제로 둔다.
 * 동점이라 base가 없으면 전부 해제로 시작한다 — 사장님이 직접 고른다.
 */
import { useState } from 'react';
import type { Design } from '@/services';
import { Stepper } from '../design-settings';
import type { GroupResult } from '../_lib/standards';

export interface PreviewCfg {
  title: string;
  unit: string;
  step: number;
  clamp: (n: number) => number;
  format: (n: number) => string;
  groupResult: GroupResult<number>;
  apply: (targets: Design[], value: number) => void;
}

export function ApplyPreview({ cfg, onClose }: { cfg: PreviewCfg; onClose: () => void }) {
  const { base, groups } = cfg.groupResult;
  const [value, setValue] = useState<number>(base?.value ?? groups[0]?.value ?? 0);
  const [checked, setChecked] = useState<Set<number>>(() => (base ? new Set([base.value]) : new Set()));

  const toggle = (v: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  const total = groups.reduce((s, g) => s + g.designs.length, 0);
  const selected = groups.filter((g) => checked.has(g.value)).flatMap((g) => g.designs);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-heading-sm font-bold">{cfg.title}</h3>
          <button onClick={onClose} className="px-1 text-primary-50" aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="mt-3">
          <label className="text-caption text-primary-50">새 값</label>
          <Stepper value={value} step={cfg.step} suffix={cfg.unit} onChange={(v) => setValue(cfg.clamp(v))} />
        </div>

        <p className="mt-4 text-caption text-primary-50">적용 대상 {total}개 중</p>
        {!base && (
          <p className="mt-1 text-caption text-danger">기준이 갈려요 — 적용할 무리를 직접 고르세요.</p>
        )}

        <ul className="mt-2 space-y-1.5">
          {groups.map((g) => {
            const isBase = base?.value === g.value;
            return (
              <li key={g.value}>
                <label
                  className={`flex items-center gap-2 rounded-md border p-2 text-body-sm ${
                    isBase ? 'border-neutral-200' : 'border-warning/40 bg-warning-bg/40'
                  }`}
                >
                  <input type="checkbox" checked={checked.has(g.value)} onChange={() => toggle(g.value)} />
                  <span className="flex-1">
                    {isBase ? '값이 같던 ' : '따로 수정된 '}
                    {g.designs.length}개 · {cfg.format(g.value)}
                    {!isBase && ' ⚠'}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <button
          onClick={() => {
            cfg.apply(selected, value);
            onClose();
          }}
          disabled={selected.length === 0}
          className="mt-4 w-full rounded-lg bg-secondary py-2.5 font-semibold text-white disabled:opacity-50"
        >
          {selected.length}개에 적용
        </button>
      </div>
    </div>
  );
}
