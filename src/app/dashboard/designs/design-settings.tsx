'use client';

/**
 * 디자인 "설정 입력" 공유 모듈.
 *
 * 새 디자인 등록(CreateForm) · 대량 등록(BulkAddModal) · 디자인 수정(DesignEditForm)
 * 이 모두 ★완전히 동일한 설정 필드/유효성/디자인★을 쓰도록
 * 한 곳에 모아 재사용한다. designs/page.tsx 안에 있던 것을 그대로 추출한 것이라
 * 필드 구성·UX·유효성은 기존과 100% 동일하다(이달의 아트 인트로가 포함).
 */

import { useEffect, useRef, useState } from 'react';
import { designsApi } from '@/services';
import type { Design, Designer } from '@/services';

export const MAX_OWNER_TAGS = 10;
export const TAG_MAXLEN = 40;
export const DURATION_MIN = 30;
export const DURATION_MAX = 600;
export const DURATION_STEP = 10;
export const PRICE_STEP = 5000; // 디자이너별 가격 · 추가옵션 가격 +/- 단위(원)
export const PRICE_INPUT_STEP = 1000; // 정상가 · 인트로가 입력칸 화살표 +/- 단위(원)
export const OPTION_PRICE_DEFAULT = 50000; // 추가옵션 기본 추가금액(원)
export const OPTION_DURATION_DEFAULT = 30; // 추가옵션 기본 추가시간(분)
export const OPTION_DURATION_STEP = 30; // 추가옵션 시간 +/- 단위(분)
export const OPTION_DURATION_MAX = 600; // 추가옵션 추가시간 상한(분)

// 옵션의 시간은 기본 소요시간에 "더해지는" 값(가격이 price_delta인 것과 같다).
// 그래서 최소 30분인 clampDuration을 쓰면 안 되고 0분(추가시간 없음)을 허용해야 한다.
export const clampOptionDuration = (n: number) =>
  Math.max(0, Math.min(OPTION_DURATION_MAX, Math.round(n) || 0));

/** 추가옵션 종류. 백엔드 DesignOptionKind(extend/removal/care)와 1:1. */
export const OPTION_KINDS = [
  { value: 'extend', label: '연장' },
  { value: 'removal', label: '제거' },
  { value: 'care', label: '케어' },
] as const;
export type OptionKind = (typeof OPTION_KINDS)[number]['value'];

/**
 * 자주 쓰이는 옵션 이름 프리셋. 눌러서 이름만 채워 넣는 시작점이고, 저장되면 평범한
 * design_options row라 이후 이름·금액·시간 전부 자유롭게 고칠 수 있다(별도 테이블 아님).
 */
export const COMMON_OPTION_PRESETS = [
  { kind: 'removal', name: '자샵 제거' },
  { kind: 'removal', name: '타샵 제거' },
  { kind: 'removal', name: '연장 제거' },
  { kind: 'care', name: '리페어' },
  { kind: 'extend', name: '랩핑' },
  { kind: 'extend', name: '전체 연장' },
  { kind: 'extend', name: '부분 연장(개수 요청사항에 기재)' },
] as const satisfies readonly { kind: OptionKind; name: string }[];

/** 폼에서 편집하는 추가옵션 한 줄. id가 있으면 기존(수정 대상) 옵션. */
export interface OptionRow {
  uid: string;
  id?: string;
  kind: OptionKind;
  name: string;
  priceDelta: number;
  durationDelta: number; // 기본 소요시간에 더해지는 시간(분)
}

/** 새 디자인/폴더 첫 등록 시 기본으로 깔아두는 3줄(연장·제거·케어, 각 5만원 · 30분). */
export function defaultOptionRows(): OptionRow[] {
  return OPTION_KINDS.map((k) => ({
    uid: crypto.randomUUID(),
    kind: k.value,
    name: k.label,
    priceDelta: OPTION_PRICE_DEFAULT,
    durationDelta: OPTION_DURATION_DEFAULT,
  }));
}

/** OptionRow → 백엔드 옵션 페이로드. 생성/수정이 같은 형태라 한 곳에서 만든다. */
export function toOptionBody(r: OptionRow, sortOrder: number) {
  return {
    kind: r.kind,
    name: r.name.trim(),
    price_delta: Math.max(0, Math.round(r.priceDelta) || 0),
    duration_delta_min: clampOptionDuration(r.durationDelta),
    sort_order: sortOrder,
  };
}

/** 디자인에 추가옵션들을 순서대로 생성한다(이름 빈 줄은 건너뜀). */
export async function createOptionsFor(designId: string, rows: OptionRow[]) {
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (!r.name.trim()) continue;
    await designsApi.createOption(designId, toOptionBody(r, i));
  }
}

export const clampDuration = (n: number) => Math.max(DURATION_MIN, Math.min(DURATION_MAX, n));
export const clampPrice = (n: number) => Math.max(0, Math.round(n));

export interface DesignSettings {
  price: string;
  duration: number;
  description: string;
  tags: string[];
  // 디자이너별로 다르게 적용할지. 꺼져 있으면 등록된 모든 디자이너가 동일한 정상가·소요시간으로
  // 이 디자인을 하고, picked/pickedPrice는 저장 시 무시된다(디자인 세부 화면과 동일한 규칙).
  perDesigner: boolean;
  picked: Record<string, number>; // designerId → 소요시간(분). perDesigner일 때만 쓰인다.
  pickedPrice: Record<string, number>; // designerId → 가격(원). picked와 같은 키를 유지.
}

export function defaultBulkSettings(): DesignSettings {
  return {
    price: '',
    duration: 120,
    description: '',
    tags: [],
    perDesigner: false,
    picked: {},
    pickedPrice: {},
  };
}

export function loadBulkSettings(key: string, designers: Designer[]): DesignSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as DesignSettings;
    const ids = new Set(designers.map((d) => d.id));
    const picked: Record<string, number> = {};
    for (const [k, v] of Object.entries(s.picked ?? {})) if (ids.has(k)) picked[k] = v;
    const pickedPrice: Record<string, number> = {};
    for (const [k, v] of Object.entries(s.pickedPrice ?? {})) if (ids.has(k)) pickedPrice[k] = v;
    return {
      price: s.price ?? '',
      duration: s.duration ?? 120,
      description: s.description ?? '',
      tags: s.tags ?? [],
      perDesigner: s.perDesigner ?? false,
      picked,
      pickedPrice,
    };
  } catch {
    return null;
  }
}

export function saveBulkSettings(key: string, s: DesignSettings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* 무시 */
  }
}

/** 폴더 내 기존 디자인 제목(폴더명_NNN)에서 다음 번호를 구한다. */
export function nextDesignNumber(folderName: string, designs: Design[]): number {
  const esc = folderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc}_(\\d+)$`);
  let max = 0;
  for (const d of designs) {
    const m = d.title?.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/** 사장님 태그 입력기: 단어 입력→Enter로 등록, X로 삭제, 최대 10개. */
export function TagInput({ tags, onChange }: { tags: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim().replace(/^#/, '').slice(0, TAG_MAXLEN);
    if (!v) return;
    if (tags.includes(v)) {
      setDraft('');
      return;
    }
    if (tags.length >= MAX_OWNER_TAGS) return;
    onChange([...tags, v]);
    setDraft('');
  };
  const remove = (t: string) => onChange(tags.filter((x) => x !== t));

  return (
    <div className="rounded-md border border-neutral-300 p-2 focus-within:border-secondary">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-secondary/10 py-1 pl-2.5 pr-1 text-caption text-secondary"
          >
            #{t}
            <button
              type="button"
              onClick={() => remove(t)}
              aria-label={`${t} 삭제`}
              className="grid h-4 w-4 place-items-center rounded-full text-secondary/70 hover:bg-secondary/20"
            >
              ×
            </button>
          </span>
        ))}
        {tags.length < MAX_OWNER_TAGS && (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                add();
              } else if (e.key === 'Backspace' && !draft && tags.length > 0) {
                remove(tags[tags.length - 1]);
              }
            }}
            onBlur={add}
            placeholder={tags.length === 0 ? '단어 입력 후 Enter (예: 심플)' : ''}
            maxLength={TAG_MAXLEN}
            className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-body-sm outline-none"
          />
        )}
      </div>
      <p className="mt-1 px-1 text-caption text-primary-50">
        {tags.length}/{MAX_OWNER_TAGS} · Enter로 등록, X로 삭제
      </p>
    </div>
  );
}

/** +/- 스텝퍼. 직접 입력도 가능(blur/Enter에 확정). */
export function Stepper({
  value,
  onChange,
  suffix,
  step = DURATION_STEP,
  ariaLabel = '직접 입력',
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
  ariaLabel?: string;
}) {
  // 직접 입력용 로컬 문자열 상태. +/- 또는 외부 값 변경 시 동기화하고, 입력은 blur/Enter에 확정한다.
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const n = parseInt(text, 10);
    if (Number.isFinite(n)) onChange(n);
    else setText(String(value));
  };

  return (
    <div className="flex items-center rounded-md border border-neutral-300">
      <button
        type="button"
        onClick={() => onChange(value - step)}
        className="grid h-8 w-8 place-items-center text-primary-50 hover:bg-neutral-100"
        aria-label="감소"
      >
        −
      </button>
      <div className="flex items-center">
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-16 bg-transparent text-center text-body-sm tabular-nums outline-none"
          aria-label={ariaLabel}
        />
        {suffix && <span className="pr-1.5 text-body-sm text-primary-50">{suffix}</span>}
      </div>
      <button
        type="button"
        onClick={() => onChange(value + step)}
        className="grid h-8 w-8 place-items-center text-primary-50 hover:bg-neutral-100"
        aria-label="증가"
      >
        +
      </button>
    </div>
  );
}

/** 정상가·인트로가·디자이너/소요시간·설명·태그 필드. 제목/사진은 포함하지 않는다. */
export function DesignSettingsFields({
  designers,
  value,
  onChange,
  priceRequired = true,
  priceDisabled = false,
  priceHint,
}: {
  designers: Designer[];
  value: DesignSettings;
  onChange: (patch: Partial<DesignSettings>) => void;
  /** false면 정상가 라벨의 필수(*) 표시를 뺀다 — 대량등록에서 파일명으로 전부 개별 가격이 인식된 경우용. */
  priceRequired?: boolean;
  /** true면 정상가 입력칸 자체를 비활성화한다 — 선택한 사진 전체의 가격이 파일명에서 인식된 경우용. */
  priceDisabled?: boolean;
  /** 정상가 입력칸 아래에 보여줄 안내 문구(예: 파일명 인식 개수 안내). */
  priceHint?: string;
}) {
  const multiDesigner = designers.length >= 2;
  const { price, duration, description, tags, perDesigner, picked, pickedPrice } = value;
  const basePrice = clampPrice(Number(price) || 0);
  const labelCls = 'mb-1 block text-caption font-semibold text-primary-50';
  const fieldCls =
    'w-full rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-primary-50';

  const toggleDesigner = (id: string) => {
    const nextPicked = { ...picked };
    const nextPrice = { ...pickedPrice };
    if (id in nextPicked) {
      delete nextPicked[id];
      delete nextPrice[id];
    } else {
      nextPicked[id] = duration;
      nextPrice[id] = basePrice;
    }
    onChange({ picked: nextPicked, pickedPrice: nextPrice });
  };

  const setDesignerDuration = (id: string, minutes: number) =>
    onChange({ picked: { ...picked, [id]: clampDuration(minutes) } });
  const setDesignerPrice = (id: string, won: number) =>
    onChange({ pickedPrice: { ...pickedPrice, [id]: Math.max(0, won) } });

  return (
    <>
      <div>
        <label className={labelCls}>
          정상가(원) {priceRequired && <span className="text-danger">*</span>}
        </label>
        <input
          type="number"
          min={0}
          step={PRICE_INPUT_STEP}
          value={price}
          disabled={perDesigner || priceDisabled}
          onChange={(e) => onChange({ price: e.target.value })}
          className={fieldCls}
        />
        {priceHint && <p className="mt-1 text-caption text-primary-50">{priceHint}</p>}
      </div>

      <div>
        <label className={labelCls}>소요 시간(분)</label>
        <input
          type="number"
          min={DURATION_MIN}
          max={DURATION_MAX}
          step={DURATION_STEP}
          value={duration}
          disabled={perDesigner}
          onChange={(e) => onChange({ duration: Number(e.target.value) })}
          onBlur={(e) => onChange({ duration: clampDuration(Number(e.target.value)) })}
          className={fieldCls}
        />
      </div>

      {multiDesigner && (
        <div>
          <label className="flex items-center gap-2 text-body-sm text-primary">
            <input
              type="checkbox"
              checked={perDesigner}
              onChange={(e) => onChange({ perDesigner: e.target.checked })}
            />
            디자이너별로 다르게 적용
          </label>
          {perDesigner && (
            <div className="mt-2 space-y-2">
              <p className="text-caption text-primary-50">
                체크한 디자이너만 이 디자인을 할 수 있어요. 소요시간·가격을 디자이너별로 다르게 조정할 수 있어요.
                미조정 시 기본값(소요시간 {duration}분 · 가격 {basePrice.toLocaleString('ko-KR')}원).
              </p>
              <div className="space-y-2">
                {designers.map((dz) => {
                  const checked = dz.id in picked;
                  return (
                    <div
                      key={dz.id}
                      className={`flex flex-wrap items-center gap-3 rounded-md border p-2 ${
                        checked ? 'border-secondary/40 bg-secondary/5' : 'border-neutral-200'
                      }`}
                    >
                      <label className="flex items-center gap-2 text-caption font-semibold">
                        <input type="checkbox" checked={checked} onChange={() => toggleDesigner(dz.id)} />
                        {dz.name}
                      </label>
                      {checked && (
                        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-caption text-primary-50">시간</span>
                            <Stepper
                              value={picked[dz.id]}
                              onChange={(v) => setDesignerDuration(dz.id, v)}
                              suffix="분"
                              ariaLabel="소요시간 직접 입력"
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-caption text-primary-50">가격</span>
                            <Stepper
                              value={pickedPrice[dz.id] ?? basePrice}
                              onChange={(v) => setDesignerPrice(dz.id, v)}
                              step={PRICE_STEP}
                              suffix="원"
                              ariaLabel="가격 직접 입력"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <label className={labelCls}>설명 (앱 미노출 · 메모용)</label>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => onChange({ description: e.target.value })}
          className={fieldCls}
        />
      </div>

      <div>
        <label className={labelCls}>사장님 태그</label>
        <TagInput tags={tags} onChange={(t) => onChange({ tags: t })} />
      </div>
    </>
  );
}

/** 배열에서 한 항목을 다른 자리로 옮긴 새 배열. */
function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * 추가옵션 편집기: 연장/제거/케어 + 이름 + 추가금액 + 추가시간을 줄 단위로 관리.
 * 앱에서 옵션을 고르면 그만큼 가격과 소요시간이 올라간다. 줄 순서는 sort_order로 저장된다.
 *
 * 순서 변경은 ⋮⋮ 핸들을 잡고 끄는 방식이다. Pointer Events라 노트북(클릭한 채 끌기)과
 * 모바일(꾹 누르고 끌기)이 같은 코드로 동작한다. 핸들에만 걸어 둔 이유는 이름 입력칸을
 * 드래그로 오인식하지 않게 하기 위해서다.
 */
export function OptionsField({ options, onChange }: { options: OptionRow[]; onChange: (next: OptionRow[]) => void }) {
  const labelCls = 'mb-1 block text-caption font-semibold text-primary-50';
  const [dragUid, setDragUid] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const update = (uid: string, patch: Partial<OptionRow>) =>
    onChange(options.map((o) => (o.uid === uid ? { ...o, ...patch } : o)));
  const remove = (uid: string) => onChange(options.filter((o) => o.uid !== uid));
  const add = () =>
    onChange([
      ...options,
      {
        uid: crypto.randomUUID(),
        kind: 'extend',
        name: '',
        priceDelta: OPTION_PRICE_DEFAULT,
        durationDelta: OPTION_DURATION_DEFAULT,
      },
    ]);
  const addPreset = (preset: (typeof COMMON_OPTION_PRESETS)[number]) =>
    onChange([
      ...options,
      {
        uid: crypto.randomUUID(),
        kind: preset.kind,
        name: preset.name,
        priceDelta: OPTION_PRICE_DEFAULT,
        durationDelta: OPTION_DURATION_DEFAULT,
      },
    ]);

  const startDrag = (e: React.PointerEvent, uid: string) => {
    e.preventDefault(); // 드래그 중 텍스트 선택/스크롤 방지
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragUid(uid);
  };
  const endDrag = () => setDragUid(null);

  // 끌고 있는 줄이 이웃 줄의 중간선을 넘어가면 그 자리와 맞바꾼다.
  const onDragMove = (e: React.PointerEvent, uid: string) => {
    if (dragUid !== uid) return;
    const from = options.findIndex((o) => o.uid === uid);
    if (from < 0) return;
    for (let i = 0; i < options.length; i += 1) {
      if (i === from) continue;
      const el = rowRefs.current.get(options[i].uid);
      if (!el) continue;
      const box = el.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      const passedDown = i > from && e.clientY > middle;
      const passedUp = i < from && e.clientY < middle;
      if (passedDown || passedUp) {
        onChange(moveItem(options, from, i));
        return;
      }
    }
  };

  return (
    <div>
      <label className={labelCls}>추가옵션</label>
      <p className="mb-2 text-caption text-primary-50">
        연장·제거·케어 등 추가 시술이에요. 고객이 앱에서 옵션을 고르면 그만큼 가격과 소요시간이 올라갑니다. ⋮⋮ 를 잡고
        끌어 순서를 바꿀 수 있어요.
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {COMMON_OPTION_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => addPreset(preset)}
            className="rounded-full border border-neutral-300 px-3 py-1 text-caption text-primary-50 hover:border-secondary hover:text-secondary"
          >
            + {preset.name}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {options.map((o) => (
          <div
            key={o.uid}
            ref={(el) => {
              if (el) rowRefs.current.set(o.uid, el);
              else rowRefs.current.delete(o.uid);
            }}
            className={`rounded-md border p-2 ${
              dragUid === o.uid ? 'border-secondary bg-secondary/5' : 'border-neutral-200'
            }`}
          >
            {/* 윗줄: 순서 핸들 · 종류 · 이름 · 삭제 */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onPointerDown={(e) => startDrag(e, o.uid)}
                onPointerMove={(e) => onDragMove(e, o.uid)}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className="grid h-8 w-5 shrink-0 cursor-grab touch-none select-none place-items-center rounded text-primary-50 hover:bg-neutral-100 active:cursor-grabbing"
                aria-label="옵션 순서 변경 — 잡고 위아래로 끌기"
                title="잡고 위아래로 끌어 순서를 바꿔요"
              >
                ⋮⋮
              </button>
              <select
                value={o.kind}
                onChange={(e) => update(o.uid, { kind: e.target.value as OptionKind })}
                className="rounded-md border border-neutral-300 px-2 py-2 text-body-sm outline-none focus:border-secondary"
                aria-label="옵션 종류"
              >
                {OPTION_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input
                value={o.name}
                onChange={(e) => update(o.uid, { name: e.target.value })}
                placeholder="옵션 이름 (예: 길이 연장)"
                className="min-w-[5rem] flex-1 rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
              />
              <button
                type="button"
                onClick={() => remove(o.uid)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-neutral-300 text-primary-50 hover:bg-neutral-50"
                aria-label="옵션 삭제"
              >
                ×
              </button>
            </div>
            {/* 아랫줄: 추가금액 · 추가시간 (핸들 너비만큼 들여쓴다) */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 pl-7">
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-caption text-primary-50">추가금액 +</span>
                <Stepper
                  value={o.priceDelta}
                  onChange={(v) => update(o.uid, { priceDelta: Math.max(0, v) })}
                  step={PRICE_STEP}
                  suffix="원"
                  ariaLabel="추가금액 직접 입력"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-caption text-primary-50">추가시간 +</span>
                <Stepper
                  value={o.durationDelta}
                  onChange={(v) => update(o.uid, { durationDelta: clampOptionDuration(v) })}
                  step={OPTION_DURATION_STEP}
                  suffix="분"
                  ariaLabel="추가시간 직접 입력"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="mt-2 rounded-md border border-secondary px-3 py-1.5 text-caption font-semibold text-secondary"
      >
        + 옵션 추가
      </button>
    </div>
  );
}
