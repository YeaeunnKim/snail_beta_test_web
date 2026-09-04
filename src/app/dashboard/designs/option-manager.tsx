'use client';

/**
 * 옵션 관리 — 샵 전체/폴더/디자인 범위를 골라 옵션 프리셋을 만들고, 프리셋으로
 * 일괄 등록(신규/중복/덮어쓰기)하거나 일괄 삭제·초기화한다.
 *
 * 프리셋은 shop.option_presets(JSONB)에 저장되고, 프리셋 옵션마다 발급되는 uuid
 * 키가 design_options.template_key로 남아 "이 옵션이 어느 프리셋에서 왔는지"를
 * 추적한다. 이름을 바꿔도 연결이 끊기지 않는다. 프리셋을 지우면 연결은 고아로
 * 남는다(FK 아님) — 화면엔 "연결 끊김"으로 표시하고 일괄 작업 대상에서 제외한다.
 *
 * 베타 한정 실험. 정식 템플릿 테이블(FK)로의 승격은 운영자웹 재설계 때로 미룬다.
 * 설계: docs/superpowers/specs/2026-09-04-option-presets-design.md
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { designsApi, shopApi } from '@/services';
import type { Design, DesignFolder, DesignOption, OptionPreset, OptionPresetOption } from '@/services';
import { collectAll, pooledMap } from '@/lib/api-client';
import { toUserMessage } from '@/lib/error-messages';
import { useMyShop, MY_SHOP_KEY } from '@/hooks/use-my-shop';
import {
  MAX_DESIGN_OPTIONS,
  MAX_PRESET_OPTIONS,
  OPTION_DURATION_DEFAULT,
  OPTION_DURATION_STEP,
  OPTION_KINDS,
  OPTION_PRICE_DEFAULT,
  PRICE_STEP,
  Stepper,
  clampOptionDuration,
  seedOptionPreset,
} from './design-settings';
import type { OptionKind } from './design-settings';

type RegisterMode = 'missing-only' | 'all' | 'overwrite';

interface LinkedOption {
  design: Design;
  option: DesignOption;
}

function tally(results: boolean[]): { ok: number; fail: number } {
  const ok = results.filter(Boolean).length;
  return { ok, fail: results.length - ok };
}

/** 프리셋 옵션 하나가 적용된(template_key 일치) 모든 디자인의 옵션 행. */
function linkedOptionsByKey(designs: Design[], keys: Set<string>): LinkedOption[] {
  const out: LinkedOption[] = [];
  for (const design of designs) {
    for (const option of design.options ?? []) {
      if (option.template_key && keys.has(option.template_key)) out.push({ design, option });
    }
  }
  return out;
}

function presetLabelFor(templateKey: string | null | undefined, presets: OptionPreset[]): string | null {
  if (!templateKey) return null;
  for (const preset of presets) {
    if ((preset.options ?? []).some((o) => o.key === templateKey)) return preset.name;
  }
  return '연결 끊김';
}

/** overwrite 모드가 아니면 프리셋 옵션 전부가 새로 생성된다(중복 허용 모드이므로). */
function newCreateCount(design: Design, mode: RegisterMode, presetOptions: OptionPresetOption[]): number {
  if (mode !== 'overwrite') return presetOptions.length;
  const existingKeys = new Set((design.options ?? []).filter((o) => o.template_key).map((o) => o.template_key));
  return presetOptions.filter((p) => !existingKeys.has(p.key)).length;
}

/** 아니오/네 확인 바. 취소가 왼쪽, 확인이 오른쪽으로 고정한다. */
function ConfirmBar({
  message,
  confirmLabel,
  onCancel,
  onConfirm,
  busy,
  tone = 'default',
  children,
}: {
  message: React.ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
  tone?: 'default' | 'danger';
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`space-y-3 rounded-md border p-3 ${
        tone === 'danger' ? 'border-danger/40 bg-danger/5' : 'border-secondary/40 bg-secondary/5'
      }`}
    >
      <div className="text-caption text-primary">{message}</div>
      {children}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-neutral-300 px-4 py-2 text-body-sm text-primary disabled:opacity-50"
        >
          아니오
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`rounded-md px-4 py-2 text-body-sm font-semibold text-white disabled:opacity-50 ${
            tone === 'danger' ? 'bg-danger' : 'bg-secondary'
          }`}
        >
          {busy ? '처리 중…' : confirmLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * 프리셋 한 개 편집기. 저장 시 값이 바뀐 기존 옵션이 있으면(신규 프리셋이거나
 * 이름만 바꾼 경우는 제외) 적용된 디자인에 반영할지 확인 바를 띄운다.
 */
function PresetEditor({
  preset,
  isNew,
  existingPresets,
  allDesigns,
  onCancel,
  onSaved,
}: {
  preset: OptionPreset;
  isNew: boolean;
  existingPresets: OptionPreset[];
  allDesigns: Design[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(preset.name);
  const [options, setOptions] = useState<OptionPresetOption[]>(preset.options ?? []);
  const [saving, setSaving] = useState(false);
  const [propagating, setPropagating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyAdjusted, setApplyAdjusted] = useState(false);
  const [confirm, setConfirm] = useState<{
    unchanged: LinkedOption[];
    adjusted: LinkedOption[];
    nextByKey: Map<string, OptionPresetOption>;
    nextPresets: OptionPreset[];
  } | null>(null);

  const updateRow = (key: string, patch: Partial<OptionPresetOption>) =>
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  const removeRow = (key: string) => setOptions((prev) => prev.filter((o) => o.key !== key));
  const addRow = () =>
    setOptions((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        kind: 'extend',
        name: '',
        price_delta: OPTION_PRICE_DEFAULT,
        duration_delta_min: OPTION_DURATION_DEFAULT,
        sort_order: prev.length,
      },
    ]);

  async function commitSave(nextPresets: OptionPreset[]) {
    await shopApi.updateMyShop({ option_presets: nextPresets });
    qc.invalidateQueries({ queryKey: MY_SHOP_KEY });
  }

  async function handleSaveClick() {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('프리셋 이름을 입력하세요.');
      return;
    }
    const cleanOptions = options.filter((o) => o.name.trim());
    if (cleanOptions.length === 0) {
      setError('옵션을 하나 이상 추가하세요.');
      return;
    }

    const nextPreset: OptionPreset = { id: preset.id, name: trimmedName, options: cleanOptions };
    const nextPresets = isNew
      ? [...existingPresets, nextPreset]
      : existingPresets.map((p) => (p.id === preset.id ? nextPreset : p));

    const oldByKey = new Map((preset.options ?? []).map((o) => [o.key, o]));
    const changedKeys = new Set<string>();
    for (const opt of cleanOptions) {
      const old = oldByKey.get(opt.key);
      if (!old) continue;
      const changed =
        old.kind !== opt.kind ||
        old.name !== opt.name ||
        (old.price_delta ?? 0) !== (opt.price_delta ?? 0) ||
        (old.duration_delta_min ?? 0) !== (opt.duration_delta_min ?? 0);
      if (changed) changedKeys.add(opt.key);
    }

    if (isNew || changedKeys.size === 0) {
      setSaving(true);
      try {
        await commitSave(nextPresets);
        onSaved();
      } catch (e) {
        setError(toUserMessage(e));
      } finally {
        setSaving(false);
      }
      return;
    }

    const nextByKey = new Map(cleanOptions.filter((o) => changedKeys.has(o.key)).map((o) => [o.key, o]));
    const linked = linkedOptionsByKey(allDesigns, changedKeys);
    const unchanged: LinkedOption[] = [];
    const adjusted: LinkedOption[] = [];
    for (const item of linked) {
      const old = oldByKey.get(item.option.template_key as string);
      if (!old) continue;
      const matchesOld =
        item.option.kind === old.kind &&
        item.option.name === old.name &&
        item.option.price_delta === (old.price_delta ?? 0) &&
        item.option.duration_delta_min === (old.duration_delta_min ?? 0);
      (matchesOld ? unchanged : adjusted).push(item);
    }

    if (unchanged.length === 0 && adjusted.length === 0) {
      setSaving(true);
      try {
        await commitSave(nextPresets);
        onSaved();
      } catch (e) {
        setError(toUserMessage(e));
      } finally {
        setSaving(false);
      }
      return;
    }

    setApplyAdjusted(false);
    setConfirm({ unchanged, adjusted, nextByKey, nextPresets });
  }

  async function skipPropagateAndSave() {
    if (!confirm) return;
    setSaving(true);
    setError(null);
    try {
      await commitSave(confirm.nextPresets);
      onSaved();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function runPropagate() {
    if (!confirm) return;
    setPropagating(true);
    setError(null);
    try {
      await commitSave(confirm.nextPresets);
      const targets = [...confirm.unchanged, ...(applyAdjusted ? confirm.adjusted : [])];
      const results = await pooledMap(targets, 6, async (t) => {
        const next = confirm.nextByKey.get(t.option.template_key as string);
        if (!next) return false;
        try {
          await designsApi.updateOption(t.design.id, t.option.id, {
            kind: next.kind,
            name: next.name,
            price_delta: next.price_delta ?? 0,
            duration_delta_min: next.duration_delta_min ?? 0,
          });
          return true;
        } catch {
          return false;
        }
      });
      const { fail } = tally(results);
      if (fail > 0) setError(`프리셋은 저장됐지만 ${fail}개 디자인 반영에 실패했습니다.`);
      onSaved();
    } catch (e) {
      setError(toUserMessage(e));
    } finally {
      setPropagating(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-neutral-200 p-3">
      <div>
        <label className="mb-1 block text-caption font-semibold text-primary-50">프리셋 이름</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 기본 세트"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
        />
      </div>

      <div className="space-y-2">
        {options.map((o) => (
          <div key={o.key} className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 p-2">
            <select
              value={o.kind}
              onChange={(e) => updateRow(o.key, { kind: e.target.value as OptionKind })}
              className="rounded-md border border-neutral-300 px-2 py-2 text-body-sm outline-none focus:border-secondary"
            >
              {OPTION_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <input
              value={o.name}
              onChange={(e) => updateRow(o.key, { name: e.target.value })}
              placeholder="옵션 이름"
              className="min-w-[5rem] flex-1 rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
            />
            <Stepper
              value={o.price_delta ?? 0}
              onChange={(v) => updateRow(o.key, { price_delta: Math.max(0, v) })}
              step={PRICE_STEP}
              suffix="원"
              ariaLabel="가격"
            />
            <Stepper
              value={o.duration_delta_min ?? 0}
              onChange={(v) => updateRow(o.key, { duration_delta_min: clampOptionDuration(v) })}
              step={OPTION_DURATION_STEP}
              suffix="분"
              ariaLabel="소요시간"
            />
            <button
              type="button"
              onClick={() => removeRow(o.key)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-neutral-300 text-primary-50 hover:bg-neutral-50"
              aria-label="옵션 삭제"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addRow}
        disabled={options.length >= MAX_PRESET_OPTIONS}
        className="rounded-md border border-secondary px-3 py-1.5 text-caption font-semibold text-secondary disabled:opacity-50"
      >
        + 옵션 추가
      </button>

      {error && <p className="text-caption text-red-600">{error}</p>}

      {confirm ? (
        <ConfirmBar
          message={
            <>
              이 프리셋이 적용된 디자인이 있습니다 — 그대로 {confirm.unchanged.length}개, 개별 조정됨{' '}
              {confirm.adjusted.length}개.
            </>
          }
          confirmLabel="네, 갱신합니다"
          busy={saving || propagating}
          onCancel={() => void skipPropagateAndSave()}
          onConfirm={() => void runPropagate()}
        >
          <label className="flex items-center gap-2 text-caption text-primary-50">
            <input type="checkbox" checked readOnly disabled />
            프리셋과 값이 같던 {confirm.unchanged.length}개를 새 값으로 갱신
          </label>
          {confirm.adjusted.length > 0 && (
            <label className="flex items-center gap-2 text-caption text-primary">
              <input
                type="checkbox"
                checked={applyAdjusted}
                onChange={(e) => setApplyAdjusted(e.target.checked)}
              />
              개별 조정된 {confirm.adjusted.length}개도 덮어쓰기
            </label>
          )}
        </ConfirmBar>
      ) : (
        <div className="flex gap-2 border-t border-neutral-200 pt-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-neutral-300 px-4 py-2 text-body-sm text-primary"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleSaveClick()}
            disabled={saving}
            className="rounded-md bg-secondary px-4 py-2 text-body-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 옵션 관리 — 샵 전체/폴더/디자인 범위를 골라 옵션 프리셋을 만들고, 프리셋으로
 * 일괄 등록·삭제·초기화하거나 기존 옵션을 그 자리에서 수정·삭제한다.
 */
export function OptionManager({
  folders,
  onClose,
  onDone,
}: {
  folders: DesignFolder[];
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const shopQuery = useMyShop();
  const allDesignsQuery = useQuery({
    queryKey: ['designs', 'all-for-options'],
    queryFn: () => collectAll<Design>((cursor) => designsApi.listDesigns({ limit: 50, cursor })),
  });
  const allDesigns = useMemo(() => allDesignsQuery.data ?? [], [allDesignsQuery.data]);
  const presets = useMemo(() => shopQuery.data?.option_presets ?? [], [shopQuery.data]);

  // 프리셋이 하나도 없으면(첫 진입) 기존 COMMON_OPTION_PRESETS로 "기본 세트"를 1회 시드한다.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !shopQuery.data) return;
    if ((shopQuery.data.option_presets?.length ?? 0) > 0) return;
    seededRef.current = true;
    void shopApi
      .updateMyShop({ option_presets: [seedOptionPreset()] })
      .then(() => qc.invalidateQueries({ queryKey: MY_SHOP_KEY }));
  }, [shopQuery.data, qc]);

  const refetchAll = async () => {
    await allDesignsQuery.refetch();
    onDone();
  };

  // --- 범위 선택 (등록/현재 옵션 목록 공용) ---
  const [scopeType, setScopeType] = useState<'shop' | 'folder' | 'design'>('shop');
  const [scopeFolderId, setScopeFolderId] = useState('');
  const [scopeDesignId, setScopeDesignId] = useState('');
  const scopedDesigns = useMemo(() => {
    if (scopeType === 'folder') return allDesigns.filter((d) => d.folder_id === scopeFolderId);
    if (scopeType === 'design') return allDesigns.filter((d) => d.id === scopeDesignId);
    return allDesigns;
  }, [allDesigns, scopeType, scopeFolderId, scopeDesignId]);

  // --- 프리셋 관리 ---
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [creatingPreset, setCreatingPreset] = useState<OptionPreset | null>(null);
  const [deletingPresetId, setDeletingPresetId] = useState<string | null>(null);
  const [presetActionError, setPresetActionError] = useState<string | null>(null);

  async function duplicatePreset(preset: OptionPreset) {
    setPresetActionError(null);
    try {
      const copy: OptionPreset = {
        id: crypto.randomUUID(),
        name: `${preset.name} 사본`,
        options: (preset.options ?? []).map((o) => ({ ...o, key: crypto.randomUUID() })),
      };
      await shopApi.updateMyShop({ option_presets: [...presets, copy] });
      qc.invalidateQueries({ queryKey: MY_SHOP_KEY });
    } catch (e) {
      setPresetActionError(toUserMessage(e));
    }
  }

  async function confirmDeletePreset() {
    if (!deletingPresetId) return;
    setPresetActionError(null);
    try {
      await shopApi.updateMyShop({ option_presets: presets.filter((p) => p.id !== deletingPresetId) });
      qc.invalidateQueries({ queryKey: MY_SHOP_KEY });
    } catch (e) {
      setPresetActionError(toUserMessage(e));
    } finally {
      setDeletingPresetId(null);
    }
  }

  // --- 일괄등록 ---
  const [registerPresetId, setRegisterPresetId] = useState('');
  const registerPreset = presets.find((p) => p.id === registerPresetId) ?? null;
  const [mode, setMode] = useState<RegisterMode>('missing-only');
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ ok: number; fail: number } | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  async function applyToDesigns() {
    if (!registerPreset) return;
    setApplying(true);
    setApplyError(null);
    setApplyResult(null);
    try {
      const presetOptions = registerPreset.options ?? [];
      const targets =
        mode === 'missing-only' ? scopedDesigns.filter((d) => (d.options?.length ?? 0) === 0) : scopedDesigns;

      const overLimit = targets.filter(
        (d) => (d.options?.length ?? 0) + newCreateCount(d, mode, presetOptions) > MAX_DESIGN_OPTIONS,
      );
      if (overLimit.length > 0) {
        const names = overLimit
          .slice(0, 3)
          .map((d) => d.title)
          .join(', ');
        setApplyError(
          `디자인 ${overLimit.length}개가 옵션 상한(${MAX_DESIGN_OPTIONS}개)을 넘겨 적용을 중단했어요: ${names}${
            overLimit.length > 3 ? ' 외' : ''
          }`,
        );
        return;
      }

      const results = await pooledMap(targets, 6, async (design) => {
        try {
          const existingByKey = new Map(
            (design.options ?? [])
              .filter((o) => o.template_key)
              .map((o) => [o.template_key as string, o] as const),
          );
          const baseSort = design.options?.length ?? 0;
          for (let i = 0; i < presetOptions.length; i += 1) {
            const p = presetOptions[i];
            const existing = mode === 'overwrite' ? existingByKey.get(p.key) : undefined;
            if (existing) {
              await designsApi.updateOption(design.id, existing.id, {
                kind: p.kind,
                name: p.name,
                price_delta: p.price_delta ?? 0,
                duration_delta_min: p.duration_delta_min ?? 0,
              });
            } else {
              await designsApi.createOption(design.id, {
                kind: p.kind,
                name: p.name,
                price_delta: p.price_delta ?? 0,
                duration_delta_min: p.duration_delta_min ?? 0,
                sort_order: baseSort + i,
                template_key: p.key,
              });
            }
          }
          return true;
        } catch {
          return false;
        }
      });
      setApplyResult(tally(results));
      await refetchAll();
    } catch (e) {
      setApplyError(toUserMessage(e));
    } finally {
      setApplying(false);
    }
  }

  // --- 일괄삭제 ---
  const [deleteScopeType, setDeleteScopeType] = useState<'shop' | 'folder'>('shop');
  const [deleteFolderId, setDeleteFolderId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<'preset' | 'all'>('preset');
  const [deletePresetId, setDeletePresetId] = useState('');
  const [deletePreview, setDeletePreview] = useState<LinkedOption[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ ok: number; fail: number } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteScopedDesigns = useMemo(() => {
    if (deleteScopeType === 'folder') return allDesigns.filter((d) => d.folder_id === deleteFolderId);
    return allDesigns;
  }, [allDesigns, deleteScopeType, deleteFolderId]);

  function previewDelete() {
    const out: LinkedOption[] = [];
    for (const design of deleteScopedDesigns) {
      for (const option of design.options ?? []) {
        if (deleteTarget === 'all' || option.template_key === deletePresetId) out.push({ design, option });
      }
    }
    setDeletePreview(out);
    setDeleteResult(null);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deletePreview) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const results = await pooledMap(deletePreview, 6, async (t) => {
        try {
          await designsApi.deleteOption(t.design.id, t.option.id);
          return true;
        } catch {
          return false;
        }
      });
      setDeleteResult(tally(results));
      setDeletePreview(null);
      await refetchAll();
    } catch (e) {
      setDeleteError(toUserMessage(e));
    } finally {
      setDeleting(false);
    }
  }

  // --- 초기화 (강한 버튼) ---
  const [resetScopeType, setResetScopeType] = useState<'shop' | 'folder'>('shop');
  const [resetFolderId, setResetFolderId] = useState('');
  const [resetPresetId, setResetPresetId] = useState('');
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{ ok: number; fail: number } | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const resetScopedDesigns = useMemo(() => {
    if (resetScopeType === 'folder') return allDesigns.filter((d) => d.folder_id === resetFolderId);
    return allDesigns;
  }, [allDesigns, resetScopeType, resetFolderId]);
  const resetPreset = presets.find((p) => p.id === resetPresetId) ?? null;
  const resetAllOptions = useMemo(
    () => resetScopedDesigns.flatMap((d): LinkedOption[] => (d.options ?? []).map((option) => ({ design: d, option }))),
    [resetScopedDesigns],
  );
  const resetManualCount = resetAllOptions.filter((t) => !t.option.template_key).length;

  async function confirmReset() {
    if (!resetPreset) return;
    setResetting(true);
    setResetError(null);
    try {
      const deleteResults = await pooledMap(resetAllOptions, 6, async (t) => {
        try {
          await designsApi.deleteOption(t.design.id, t.option.id);
          return true;
        } catch {
          return false;
        }
      });
      const presetOptions = resetPreset.options ?? [];
      const createResults = await pooledMap(resetScopedDesigns, 6, async (design) => {
        try {
          for (let i = 0; i < presetOptions.length; i += 1) {
            const p = presetOptions[i];
            await designsApi.createOption(design.id, {
              kind: p.kind,
              name: p.name,
              price_delta: p.price_delta ?? 0,
              duration_delta_min: p.duration_delta_min ?? 0,
              sort_order: i,
              template_key: p.key,
            });
          }
          return true;
        } catch {
          return false;
        }
      });
      const merged = tally([...deleteResults, ...createResults]);
      setResetResult(merged);
      setResetConfirming(false);
      await refetchAll();
    } catch (e) {
      setResetError(toUserMessage(e));
    } finally {
      setResetting(false);
    }
  }

  // --- 현재 옵션(디자인별) 수정/삭제 ---
  const [rowError, setRowError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function patchOption(
    designId: string,
    optionId: string,
    body: { kind?: OptionKind; name?: string; price_delta?: number; duration_delta_min?: number },
  ) {
    const key = `${designId}:${optionId}`;
    setSavingKey(key);
    setRowError(null);
    try {
      await designsApi.updateOption(designId, optionId, body);
      await allDesignsQuery.refetch();
    } catch (e) {
      setRowError(toUserMessage(e));
    } finally {
      setSavingKey(null);
    }
  }

  async function removeOption(designId: string, optionId: string) {
    const key = `${designId}:${optionId}`;
    setSavingKey(key);
    setRowError(null);
    try {
      await designsApi.deleteOption(designId, optionId);
      await allDesignsQuery.refetch();
    } catch (e) {
      setRowError(toUserMessage(e));
    } finally {
      setSavingKey(null);
    }
  }

  const designsWithOptions = scopedDesigns.filter((d) => (d.options?.length ?? 0) > 0);
  const totalOptionCount = designsWithOptions.reduce((s, d) => s + (d.options?.length ?? 0), 0);

  return (
    <div className="space-y-6 rounded-lg border border-neutral-200 bg-white p-4">
      <div>
        <h2 className="text-body-sm font-semibold text-primary">옵션 관리</h2>
        <p className="mt-1 text-caption text-primary-50">
          프리셋을 만들어 두면 가격·소요시간을 한 번에 관리할 수 있어요. 프리셋을 고치면 이미 적용된
          디자인에도 반영할지 물어봅니다.
        </p>
      </div>

      {/* 범위 선택 */}
      <div className="space-y-2">
        <label className="flex flex-wrap items-center gap-2 text-body-sm text-primary">
          <input type="radio" checked={scopeType === 'shop'} onChange={() => setScopeType('shop')} />
          샵 전체
        </label>
        <label className="flex flex-wrap items-center gap-2 text-body-sm text-primary">
          <input type="radio" checked={scopeType === 'folder'} onChange={() => setScopeType('folder')} />
          폴더 선택
          {scopeType === 'folder' && (
            <select
              value={scopeFolderId}
              onChange={(e) => setScopeFolderId(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-caption"
            >
              <option value="">폴더를 고르세요</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="flex flex-wrap items-center gap-2 text-body-sm text-primary">
          <input type="radio" checked={scopeType === 'design'} onChange={() => setScopeType('design')} />
          디자인 선택
          {scopeType === 'design' && (
            <select
              value={scopeDesignId}
              onChange={(e) => setScopeDesignId(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1 text-caption"
            >
              <option value="">디자인을 고르세요</option>
              {allDesigns.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          )}
        </label>
        <p className="text-caption text-primary-50">
          {allDesignsQuery.isLoading ? '디자인 불러오는 중…' : `대상 디자인 ${scopedDesigns.length}개`}
        </p>
      </div>

      {/* 프리셋 관리 */}
      <div className="space-y-2 border-t border-neutral-200 pt-4">
        <p className="text-body-sm font-semibold text-primary">프리셋</p>
        {presetActionError && <p className="text-caption text-red-600">{presetActionError}</p>}
        {shopQuery.isLoading ? (
          <p className="text-caption text-primary-50">불러오는 중…</p>
        ) : (
          <div className="space-y-2">
            {presets.map((preset) => (
              <div key={preset.id}>
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 p-2">
                  <span className="flex-1 text-body-sm text-primary">
                    {preset.name} ({(preset.options ?? []).length}개)
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingPresetId(preset.id)}
                    className="rounded-md border border-neutral-300 px-3 py-1 text-caption text-primary hover:bg-neutral-50"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => void duplicatePreset(preset)}
                    className="rounded-md border border-neutral-300 px-3 py-1 text-caption text-primary hover:bg-neutral-50"
                  >
                    복제
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingPresetId(preset.id)}
                    className="rounded-md border border-neutral-300 px-3 py-1 text-caption text-danger hover:bg-neutral-50"
                  >
                    삭제
                  </button>
                </div>
                {deletingPresetId === preset.id && (
                  <div className="mt-2">
                    <ConfirmBar
                      tone="danger"
                      message={<>프리셋 &quot;{preset.name}&quot;을 삭제할까요? 이미 적용된 옵션은 남아있어요.</>}
                      confirmLabel="네, 삭제합니다"
                      onCancel={() => setDeletingPresetId(null)}
                      onConfirm={() => void confirmDeletePreset()}
                    />
                  </div>
                )}
                {editingPresetId === preset.id && (
                  <div className="mt-2">
                    <PresetEditor
                      preset={preset}
                      isNew={false}
                      existingPresets={presets}
                      allDesigns={allDesigns}
                      onCancel={() => setEditingPresetId(null)}
                      onSaved={() => {
                        setEditingPresetId(null);
                        void refetchAll();
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
            {creatingPreset && (
              <PresetEditor
                preset={creatingPreset}
                isNew
                existingPresets={presets}
                allDesigns={allDesigns}
                onCancel={() => setCreatingPreset(null)}
                onSaved={() => {
                  setCreatingPreset(null);
                  void refetchAll();
                }}
              />
            )}
            {!creatingPreset && (
              <button
                type="button"
                onClick={() => setCreatingPreset({ id: crypto.randomUUID(), name: '새 프리셋', options: [] })}
                className="rounded-md border border-secondary px-3 py-1.5 text-caption font-semibold text-secondary"
              >
                + 새 프리셋
              </button>
            )}
          </div>
        )}
      </div>

      {/* 일괄등록 */}
      <div className="space-y-2 border-t border-neutral-200 pt-4">
        <p className="text-body-sm font-semibold text-primary">프리셋으로 일괄 등록</p>
        <select
          value={registerPresetId}
          onChange={(e) => setRegisterPresetId(e.target.value)}
          className="w-full rounded-md border border-neutral-300 px-2 py-2 text-body-sm"
        >
          <option value="">프리셋을 고르세요</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({(p.options ?? []).length}개)
            </option>
          ))}
        </select>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-caption text-primary">
            <input type="radio" checked={mode === 'missing-only'} onChange={() => setMode('missing-only')} />
            옵션이 하나도 없는 디자인만
          </label>
          <label className="flex items-center gap-2 text-caption text-primary">
            <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} />
            대상 전체에 추가 (기존 옵션은 그대로 두고 뒤에 덧붙임 — 중복될 수 있어요)
          </label>
          <label className="flex items-center gap-2 text-caption text-primary">
            <input type="radio" checked={mode === 'overwrite'} onChange={() => setMode('overwrite')} />
            대상 전체 덮어쓰기 (이 프리셋에서 온 옵션만 최신 값으로 갱신, 없으면 새로 추가)
          </label>
        </div>
        {applyError && <p className="text-caption text-red-600">{applyError}</p>}
        {applyResult && (
          <p className="text-caption text-secondary">
            디자인 {applyResult.ok + applyResult.fail}개 중 {applyResult.ok}개 성공
            {applyResult.fail > 0 ? `, ${applyResult.fail}개 실패` : ''}.
          </p>
        )}
        <button
          type="button"
          onClick={() => void applyToDesigns()}
          disabled={applying || !registerPreset || scopedDesigns.length === 0}
          className="rounded-md bg-secondary px-4 py-2 text-body-sm font-semibold text-white disabled:opacity-50"
        >
          {applying ? '적용 중…' : '적용'}
        </button>
      </div>

      {/* 일괄삭제 */}
      <div className="space-y-2 border-t border-neutral-200 pt-4">
        <p className="text-body-sm font-semibold text-primary">옵션 일괄 삭제</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-caption text-primary">
            <input type="radio" checked={deleteScopeType === 'shop'} onChange={() => setDeleteScopeType('shop')} />
            샵 전체
          </label>
          <label className="flex items-center gap-2 text-caption text-primary">
            <input type="radio" checked={deleteScopeType === 'folder'} onChange={() => setDeleteScopeType('folder')} />
            폴더
            {deleteScopeType === 'folder' && (
              <select
                value={deleteFolderId}
                onChange={(e) => setDeleteFolderId(e.target.value)}
                className="rounded-md border border-neutral-300 px-2 py-1 text-caption"
              >
                <option value="">폴더를 고르세요</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-caption text-primary">
            <input type="radio" checked={deleteTarget === 'preset'} onChange={() => setDeleteTarget('preset')} />
            선택한 프리셋에서 온 것만
            {deleteTarget === 'preset' && (
              <select
                value={deletePresetId}
                onChange={(e) => setDeletePresetId(e.target.value)}
                className="rounded-md border border-neutral-300 px-2 py-1 text-caption"
              >
                <option value="">프리셋을 고르세요</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className="flex items-center gap-2 text-caption text-primary">
            <input type="radio" checked={deleteTarget === 'all'} onChange={() => setDeleteTarget('all')} />
            전부 (손으로 만든 옵션 포함)
          </label>
        </div>
        {deleteError && <p className="text-caption text-red-600">{deleteError}</p>}
        {deleteResult && (
          <p className="text-caption text-secondary">
            옵션 {deleteResult.ok + deleteResult.fail}개 중 {deleteResult.ok}개 삭제 완료
            {deleteResult.fail > 0 ? `, ${deleteResult.fail}개 실패` : ''}.
          </p>
        )}
        {deletePreview ? (
          <ConfirmBar
            tone="danger"
            message={
              <>
                디자인 {new Set(deletePreview.map((t) => t.design.id)).size}개에서 옵션 {deletePreview.length}개가
                삭제됩니다.
              </>
            }
            confirmLabel="네, 삭제합니다"
            busy={deleting}
            onCancel={() => setDeletePreview(null)}
            onConfirm={() => void confirmDelete()}
          />
        ) : (
          <button
            type="button"
            onClick={previewDelete}
            disabled={
              (deleteScopeType === 'folder' && !deleteFolderId) || (deleteTarget === 'preset' && !deletePresetId)
            }
            className="rounded-md border border-danger px-4 py-2 text-body-sm font-semibold text-danger disabled:opacity-50"
          >
            미리보기
          </button>
        )}
      </div>

      {/* 초기화 (강한 버튼) */}
      <div className="space-y-2 border-t border-neutral-200 pt-4">
        <p className="text-body-sm font-semibold text-primary">전부 삭제하고 프리셋으로 초기화</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-caption text-primary">
            <input type="radio" checked={resetScopeType === 'shop'} onChange={() => setResetScopeType('shop')} />
            샵 전체
          </label>
          <label className="flex items-center gap-2 text-caption text-primary">
            <input type="radio" checked={resetScopeType === 'folder'} onChange={() => setResetScopeType('folder')} />
            폴더
            {resetScopeType === 'folder' && (
              <select
                value={resetFolderId}
                onChange={(e) => setResetFolderId(e.target.value)}
                className="rounded-md border border-neutral-300 px-2 py-1 text-caption"
              >
                <option value="">폴더를 고르세요</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <select
            value={resetPresetId}
            onChange={(e) => setResetPresetId(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-caption"
          >
            <option value="">다시 깔 프리셋을 고르세요</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {resetError && <p className="text-caption text-red-600">{resetError}</p>}
        {resetResult && (
          <p className="text-caption text-secondary">
            작업 {resetResult.ok + resetResult.fail}건 중 {resetResult.ok}건 성공
            {resetResult.fail > 0 ? `, ${resetResult.fail}건 실패` : ''}.
          </p>
        )}
        {resetConfirming && resetPreset ? (
          <ConfirmBar
            tone="danger"
            message={
              <>
                {resetScopeType === 'folder'
                  ? `'${folders.find((f) => f.id === resetFolderId)?.name ?? ''}' 폴더`
                  : '샵 전체'}
                의 디자인 {resetScopedDesigns.length}개에서 옵션 {resetAllOptions.length}개를 전부 삭제하고 &apos;
                {resetPreset.name}&apos; {(resetPreset.options ?? []).length}개로 다시 깝니다.
                {resetManualCount > 0 && <> 손으로 만든 옵션 {resetManualCount}개도 함께 삭제됩니다.</>} 되돌릴 수
                없습니다.
              </>
            }
            confirmLabel="네, 초기화합니다"
            busy={resetting}
            onCancel={() => setResetConfirming(false)}
            onConfirm={() => void confirmReset()}
          />
        ) : (
          <button
            type="button"
            onClick={() => setResetConfirming(true)}
            disabled={!resetPreset || (resetScopeType === 'folder' && !resetFolderId)}
            className="rounded-md border border-danger px-4 py-2 text-body-sm font-semibold text-danger disabled:opacity-50"
          >
            이 범위 옵션 전부 삭제하고 프리셋으로 초기화
          </button>
        )}
      </div>

      {/* 기존 옵션 수정/삭제 */}
      <div className="space-y-3 border-t border-neutral-200 pt-4">
        <p className="text-body-sm font-semibold text-primary">현재 옵션 ({totalOptionCount}개)</p>
        {rowError && <p className="text-caption text-red-600">{rowError}</p>}
        {allDesignsQuery.isLoading ? (
          <p className="text-caption text-primary-50">불러오는 중…</p>
        ) : designsWithOptions.length === 0 ? (
          <p className="text-caption text-primary-50">이 범위엔 옵션이 있는 디자인이 없어요.</p>
        ) : (
          <div className="space-y-4">
            {designsWithOptions.map((design) => (
              <div key={design.id} className="rounded-md border border-neutral-200 p-3">
                <p className="mb-2 text-caption font-semibold text-primary">{design.title}</p>
                <div className="space-y-2">
                  {(design.options ?? []).map((option) => {
                    const key = `${design.id}:${option.id}`;
                    const saving = savingKey === key;
                    const label = presetLabelFor(option.template_key, presets);
                    return (
                      <div key={option.id} className="flex flex-wrap items-center gap-2">
                        <select
                          value={option.kind}
                          onChange={(e) =>
                            void patchOption(design.id, option.id, { kind: e.target.value as OptionKind })
                          }
                          disabled={saving}
                          className="rounded-md border border-neutral-300 px-2 py-1 text-caption"
                        >
                          {OPTION_KINDS.map((k) => (
                            <option key={k.value} value={k.value}>
                              {k.label}
                            </option>
                          ))}
                        </select>
                        <input
                          key={`${option.id}-${option.name}`}
                          defaultValue={option.name}
                          onBlur={(e) => {
                            const next = e.target.value.trim();
                            if (next && next !== option.name) {
                              void patchOption(design.id, option.id, { name: next });
                            }
                          }}
                          disabled={saving}
                          className="min-w-[6rem] flex-1 rounded-md border border-neutral-300 px-2 py-1 text-caption"
                        />
                        <div className="flex items-center gap-1.5">
                          <span className="shrink-0 text-caption text-primary-50">+</span>
                          <Stepper
                            value={option.price_delta}
                            onChange={(v) =>
                              void patchOption(design.id, option.id, { price_delta: Math.max(0, v) })
                            }
                            step={PRICE_STEP}
                            suffix="원"
                            ariaLabel="추가금액"
                          />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="shrink-0 text-caption text-primary-50">+</span>
                          <Stepper
                            value={option.duration_delta_min}
                            onChange={(v) =>
                              void patchOption(design.id, option.id, {
                                duration_delta_min: clampOptionDuration(v),
                              })
                            }
                            step={OPTION_DURATION_STEP}
                            suffix="분"
                            ariaLabel="추가시간"
                          />
                        </div>
                        {label && (
                          <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-caption text-primary-50">
                            {label}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void removeOption(design.id, option.id)}
                          disabled={saving}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-neutral-300 text-primary-50 hover:bg-neutral-50"
                          aria-label="옵션 삭제"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-neutral-200 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-neutral-300 px-4 py-2 text-body-sm text-primary"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
