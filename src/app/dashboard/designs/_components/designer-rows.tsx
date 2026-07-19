'use client';

/**
 * 디자인 카드의 디자이너별 가격·소요시간 줄.
 * 백엔드 계약상 designer_prices/designer_durations는 "기본값과 다른 것만" 보내되
 * designer_ids 전체 목록을 항상 함께 보내야 한다.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { designsApi } from '@/services';
import type { Design } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import { Stepper, PRICE_STEP, DURATION_STEP, clampPrice, clampDuration } from '../design-settings';
import { formatWon } from '../_lib/design-helpers';
import { useDebouncedSave } from '../_lib/use-debounced-save';

type DesignerRow = { id: string; base_price: number; duration_minutes: number };
type DraftMap = Record<string, Partial<{ base_price: number; duration_minutes: number }>>;

export function DesignerRows({ design: d, editMode }: { design: Design; editMode: boolean }) {
  const qc = useQueryClient();
  const designers = d.designers ?? [];
  const [err, setErr] = useState<string | null>(null);
  // 편집 중인 디자이너별 값(낙관적). 비어 있으면 서버 값을 쓴다.
  // 카드 기본 가격·시간 편집과 같은 이유로 draft를 우선해 서버 폴링이 편집 중 값을 덮지 않게 한다.
  const [draft, setDraft] = useState<DraftMap>({});

  const save = useMutation({
    mutationFn: (rows: DesignerRow[]) =>
      designsApi.updateDesign(d.id, {
        designer_ids: rows.map((r) => r.id),
        // 기본값과 다른 것만 전송 — 기존 저장 규칙과 동일
        designer_prices: rows.filter((r) => r.base_price !== d.base_price)
          .map((r) => ({ designer_id: r.id, base_price: r.base_price })),
        designer_durations: rows.filter((r) => r.duration_minutes !== d.duration_minutes)
          .map((r) => ({ designer_id: r.id, duration_minutes: r.duration_minutes })),
      }),
    onSuccess: () => {
      setErr(null);
      setDraft({});
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e) => {
      setDraft({}); // 롤백 — 서버 값으로 되돌린다
      setErr(toUserMessage(e));
    },
  });

  // ± 연타를 800ms로 묶어 PATCH 1회만 보낸다(카드 기본 가격/시간 편집과 동일 패턴).
  const debouncedSave = useDebouncedSave<DesignerRow[]>((rows) => save.mutate(rows));

  if (designers.length < 2) return null;

  // draft를 반영한 실효 값. 표시·저장·custom 판정 모두 이걸 기준으로 한다.
  const eff = (x: DesignerRow): DesignerRow => ({
    id: x.id,
    base_price: draft[x.id]?.base_price ?? x.base_price,
    duration_minutes: draft[x.id]?.duration_minutes ?? x.duration_minutes,
  });

  const patchRow = (id: string, next: Partial<{ base_price: number; duration_minutes: number }>) => {
    const nextDraft: DraftMap = { ...draft, [id]: { ...draft[id], ...next } };
    setDraft(nextDraft);
    // 최신 draft를 반영한 전체 rows로 저장(designer_ids는 항상 전체 목록).
    const rows = designers.map((x) => ({
      id: x.id,
      base_price: nextDraft[x.id]?.base_price ?? x.base_price,
      duration_minutes: nextDraft[x.id]?.duration_minutes ?? x.duration_minutes,
    }));
    debouncedSave(rows);
  };

  return (
    <div className="mt-2 space-y-1.5 rounded-md bg-neutral-50 p-2">
      <div className="flex items-center justify-between text-caption text-primary-50">
        <span>기본</span>
        <span className="tabular-nums">{formatWon(d.base_price)} · {d.duration_minutes}분</span>
      </div>
      {designers.map((x) => {
        const e = eff(x);
        const custom = e.base_price !== d.base_price || e.duration_minutes !== d.duration_minutes;
        return (
          <div key={x.id} className="flex items-center justify-between gap-2 text-caption">
            <span className="truncate">{x.name}</span>
            {editMode ? (
              <div className="flex shrink-0 items-center gap-1">
                <Stepper
                  value={e.base_price}
                  step={PRICE_STEP}
                  suffix="원"
                  ariaLabel={`${x.name} 가격`}
                  onChange={(v) => patchRow(x.id, { base_price: clampPrice(v) })}
                />
                <Stepper
                  value={e.duration_minutes}
                  step={DURATION_STEP}
                  suffix="분"
                  ariaLabel={`${x.name} 소요시간`}
                  onChange={(v) => patchRow(x.id, { duration_minutes: clampDuration(v) })}
                />
                {custom && (
                  <button
                    type="button"
                    onClick={() => patchRow(x.id, { base_price: d.base_price, duration_minutes: d.duration_minutes })}
                    className="rounded-md bg-neutral-200 px-2 py-1 text-caption font-semibold text-primary"
                  >
                    기본으로
                  </button>
                )}
              </div>
            ) : (
              <span className="shrink-0 tabular-nums text-primary-50">
                {formatWon(e.base_price)} · {e.duration_minutes}분 {custom ? '따로' : '기본'}
              </span>
            )}
          </div>
        );
      })}
      {err && <p className="text-caption text-danger">{err}</p>}
    </div>
  );
}
