'use client';

/**
 * 시간 입력 한 칸. 09:00~22:00을 30분 단위로 보여주는 드롭다운 목록(datalist)과
 * 키보드 직접 입력을 함께 지원한다. blur/Enter 시 30분 격자에 맞춰 보정한다.
 */
import { useEffect, useId, useState } from 'react';
import { TIME_OPTIONS, snapToGrid } from '@/lib/business-hours';

export function TimeSelect({
  value,
  onChange,
  disabled,
  ariaLabel = '시간 입력',
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const listId = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  const commit = () => {
    const snapped = snapToGrid(text, value);
    setText(snapped);
    if (snapped !== value) onChange(snapped);
  };

  return (
    <>
      <input
        list={listId}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        inputMode="numeric"
        aria-label={ariaLabel}
        className="w-24 rounded-md border border-neutral-300 px-2 py-2 text-body-sm outline-none focus:border-secondary disabled:bg-neutral-100 disabled:text-primary-50"
      />
      <datalist id={listId}>
        {TIME_OPTIONS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </>
  );
}
