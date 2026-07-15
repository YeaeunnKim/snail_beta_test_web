'use client';

/**
 * 디자인 "설정 입력" 공유 모듈.
 *
 * 새 디자인 등록(CreateForm) · 대량 등록(BulkAddModal) · 디자인 수정(DesignEditForm)
 * · 디자인 정렬(sort 페이지)이 모두 ★완전히 동일한 설정 필드/유효성/디자인★을 쓰도록
 * 한 곳에 모아 재사용한다. designs/page.tsx 안에 있던 것을 그대로 추출한 것이라
 * 필드 구성·UX·유효성은 기존과 100% 동일하다(이달의 아트 인트로가 포함).
 */

import { useEffect, useState } from 'react';
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

/** 추가옵션 종류. 백엔드 DesignOptionKind(extend/removal/care)와 1:1. */
export const OPTION_KINDS = [
  { value: 'extend', label: '연장' },
  { value: 'removal', label: '제거' },
  { value: 'care', label: '케어' },
] as const;
export type OptionKind = (typeof OPTION_KINDS)[number]['value'];

/** 폼에서 편집하는 추가옵션 한 줄. id가 있으면 기존(수정 대상) 옵션. */
export interface OptionRow {
  uid: string;
  id?: string;
  kind: OptionKind;
  name: string;
  priceDelta: number;
}

/** 새 디자인/폴더 첫 등록 시 기본으로 깔아두는 3줄(연장·제거·케어, 각 5만원). */
export function defaultOptionRows(): OptionRow[] {
  return OPTION_KINDS.map((k) => ({
    uid: crypto.randomUUID(),
    kind: k.value,
    name: k.label,
    priceDelta: OPTION_PRICE_DEFAULT,
  }));
}

/** 디자인에 추가옵션들을 순서대로 생성한다(이름 빈 줄은 건너뜀). */
export async function createOptionsFor(designId: string, rows: OptionRow[]) {
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (!r.name.trim()) continue;
    await designsApi.createOption(designId, {
      kind: r.kind,
      name: r.name.trim(),
      price_delta: Math.max(0, Math.round(r.priceDelta) || 0),
      sort_order: i,
    });
  }
}

export const clampDuration = (n: number) => Math.max(DURATION_MIN, Math.min(DURATION_MAX, n));
export const clampPrice = (n: number) => Math.max(0, Math.round(n));

export interface DesignSettings {
  price: string;
  introPrice: string; // 이달의 아트 인트로가(비우면 정상가)
  duration: number;
  description: string;
  tags: string[];
  picked: Record<string, number>; // designerId → 소요시간(분). 다인샵에서 선택된 디자이너.
  pickedPrice: Record<string, number>; // designerId → 가격(원). picked와 같은 키를 유지.
  options: OptionRow[]; // 추가옵션(연장/제거/케어 등)
}

export function defaultBulkSettings(): DesignSettings {
  return {
    price: '',
    introPrice: '',
    duration: 120,
    description: '',
    tags: [],
    picked: {},
    pickedPrice: {},
    options: defaultOptionRows(),
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
    const options: OptionRow[] = Array.isArray(s.options)
      ? s.options.map((o) => ({
          uid: crypto.randomUUID(),
          kind: (OPTION_KINDS.some((k) => k.value === o.kind) ? o.kind : 'extend') as OptionKind,
          name: o.name ?? '',
          priceDelta: Math.max(0, Math.round(o.priceDelta) || 0),
        }))
      : defaultOptionRows();
    return {
      price: s.price ?? '',
      introPrice: s.introPrice ?? '',
      duration: s.duration ?? 120,
      description: s.description ?? '',
      tags: s.tags ?? [],
      picked,
      pickedPrice,
      options,
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
}: {
  designers: Designer[];
  value: DesignSettings;
  onChange: (patch: Partial<DesignSettings>) => void;
}) {
  const multiDesigner = designers.length >= 2;
  const { price, introPrice, duration, description, tags, picked, pickedPrice, options } = value;
  const basePrice = clampPrice(Number(price) || 0);
  const introNum = Number(introPrice);
  const introPct =
    introPrice.trim() !== '' && basePrice > 0 && introNum > 0 && introNum < basePrice
      ? Math.round((1 - introNum / basePrice) * 100)
      : null;
  const labelCls = 'mb-1 block text-caption font-semibold text-primary-50';
  const fieldCls =
    'w-full rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary';

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
  // 정상가를 바꾸면 인트로가도 같은 값으로 따라 채운다.
  // 단 인트로가가 정상가와 다르게 들어가 있으면(사장님이 할인가를 직접 넣은 상태) 건드리지 않는다.
  // "손댔는지"를 별도 플래그로 들고 있지 않고 현재 값만으로 판정하므로,
  // 이전 설정 불러오기로 할인가가 채워진 경우에도 자동으로 보존된다.
  const setPrice = (next: string) => {
    const introFollowsPrice = introPrice.trim() === '' || introPrice === price;
    onChange(introFollowsPrice ? { price: next, introPrice: next } : { price: next });
  };

  const setDesignerDuration = (id: string, minutes: number) =>
    onChange({ picked: { ...picked, [id]: clampDuration(minutes) } });
  const setDesignerPrice = (id: string, won: number) =>
    onChange({ pickedPrice: { ...pickedPrice, [id]: Math.max(0, won) } });

  return (
    <>
      <div className={multiDesigner ? '' : 'flex flex-wrap gap-3'}>
        <div className={multiDesigner ? '' : 'min-w-[8rem] flex-1'}>
          <label className={labelCls}>
            정상가(원) <span className="text-danger">*</span>
          </label>
          <input
            type="number"
            min={0}
            step={PRICE_INPUT_STEP}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={fieldCls}
          />
        </div>
        <div className={multiDesigner ? 'mt-3' : 'min-w-[8rem] flex-1'}>
          <label className={labelCls}>이달의 아트 인트로가(원)</label>
          <input
            type="number"
            min={0}
            step={PRICE_INPUT_STEP}
            value={introPrice}
            onChange={(e) => onChange({ introPrice: e.target.value })}
            placeholder="비우면 정상가"
            className={fieldCls}
          />
          {introPct !== null && (
            <p className="mt-1 text-caption font-semibold text-secondary">정상가 대비 {introPct}% 할인</p>
          )}
        </div>
        {!multiDesigner && (
          <div>
            <label className={labelCls}>기본 소요시간</label>
            <Stepper value={duration} onChange={(v) => onChange({ duration: clampDuration(v) })} suffix="분" />
          </div>
        )}
      </div>

      {multiDesigner && (
        <div>
          <label className={labelCls}>
            디자이너별 소요시간 · 가격 <span className="text-danger">*</span>
          </label>
          <p className="mb-2 text-caption text-primary-50">
            체크한 디자이너만 이 디자인을 할 수 있어요. 소요시간·가격을 디자이너별로 다르게 조정할 수 있어요. 미조정 시
            기본값(소요시간 {duration}분 · 가격 {basePrice.toLocaleString('ko-KR')}원).
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

      <OptionsField options={options} onChange={(next) => onChange({ options: next })} />
    </>
  );
}

/** 추가옵션 편집기: 연장/제거/케어 + 이름 + 추가금액을 줄 단위로 관리. 앱에서 옵션 선택 시 가격에 반영된다. */
export function OptionsField({ options, onChange }: { options: OptionRow[]; onChange: (next: OptionRow[]) => void }) {
  const labelCls = 'mb-1 block text-caption font-semibold text-primary-50';
  const update = (uid: string, patch: Partial<OptionRow>) =>
    onChange(options.map((o) => (o.uid === uid ? { ...o, ...patch } : o)));
  const remove = (uid: string) => onChange(options.filter((o) => o.uid !== uid));
  const add = () =>
    onChange([
      ...options,
      { uid: crypto.randomUUID(), kind: 'extend', name: '', priceDelta: OPTION_PRICE_DEFAULT },
    ]);

  return (
    <div>
      <label className={labelCls}>추가옵션</label>
      <p className="mb-2 text-caption text-primary-50">
        연장·제거·케어 등 추가 시술과 추가금액이에요. 고객이 앱에서 옵션을 고르면 그만큼 가격이 올라갑니다.
      </p>
      <div className="space-y-2">
        {options.map((o) => (
          <div key={o.uid} className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 p-2">
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
              className="min-w-[7rem] flex-1 rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
            />
            <div className="flex items-center gap-1.5">
              <span className="text-caption text-primary-50">+</span>
              <Stepper
                value={o.priceDelta}
                onChange={(v) => update(o.uid, { priceDelta: Math.max(0, v) })}
                step={PRICE_STEP}
                suffix="원"
                ariaLabel="추가금액 직접 입력"
              />
            </div>
            <button
              type="button"
              onClick={() => remove(o.uid)}
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
        onClick={add}
        className="mt-2 rounded-md border border-secondary px-3 py-1.5 text-caption font-semibold text-secondary"
      >
        + 옵션 추가
      </button>
    </div>
  );
}
