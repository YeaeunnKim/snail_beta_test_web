'use client';

/**
 * 영업시간 편집기. 기본 영업시간(base) + 요일별 조정(휴무 포함).
 * 기본 시간을 바꾸면 "직전 base와 같던" 요일만 따라 바뀌고, 개별 조정한 요일은 유지한다.
 */
import { WEEKDAYS } from '@/lib/weekday';
import type { BusinessHoursValue } from '@/lib/business-hours';
import { TimeSelect } from './time-select';

const WD_LABEL: Record<number, string> = Object.fromEntries(WEEKDAYS.map((w) => [w.value, w.label]));

export function BusinessHoursField({
  value,
  onChange,
}: {
  value: BusinessHoursValue;
  onChange: (v: BusinessHoursValue) => void;
}) {
  const setBase = (patch: Partial<{ open: string; close: string }>) => {
    const nextBase = { ...value.base, ...patch };
    // 직전 base와 같던(=개별 조정 안 한) 열린 요일만 새 base로 따라오게 한다.
    const days = value.days.map((d) => {
      if (d.closed) return d;
      const open = d.open === value.base.open ? nextBase.open : d.open;
      const close = d.close === value.base.close ? nextBase.close : d.close;
      return { ...d, open, close };
    });
    onChange({ base: nextBase, days });
  };

  const setDay = (weekday: number, patch: Partial<{ open: string; close: string; closed: boolean }>) =>
    onChange({
      ...value,
      days: value.days.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)),
    });

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-caption font-semibold text-primary-50">기본 영업시간</label>
        <div className="flex items-center gap-2">
          <TimeSelect value={value.base.open} onChange={(v) => setBase({ open: v })} ariaLabel="기본 여는 시간" />
          <span className="text-primary-50">~</span>
          <TimeSelect value={value.base.close} onChange={(v) => setBase({ close: v })} ariaLabel="기본 닫는 시간" />
        </div>
        <p className="mt-1 text-caption text-primary-50">
          기본 시간을 정하면 아래 요일에 자동 적용돼요. 요일별로 다르면 아래에서 조정하세요.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-caption font-semibold text-primary-50">요일별 조정</label>
        <div className="space-y-1.5">
          {value.days.map((d) => (
            <div key={d.weekday} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-center text-body-sm font-semibold text-primary">
                {WD_LABEL[d.weekday]}
              </span>
              {d.closed ? (
                <span className="flex-1 text-body-sm text-primary-50">휴무</span>
              ) : (
                <div className="flex flex-1 items-center gap-2">
                  <TimeSelect
                    value={d.open}
                    onChange={(v) => setDay(d.weekday, { open: v })}
                    ariaLabel={`${WD_LABEL[d.weekday]}요일 여는 시간`}
                  />
                  <span className="text-primary-50">~</span>
                  <TimeSelect
                    value={d.close}
                    onChange={(v) => setDay(d.weekday, { close: v })}
                    ariaLabel={`${WD_LABEL[d.weekday]}요일 닫는 시간`}
                  />
                </div>
              )}
              <label className="ml-auto flex shrink-0 items-center gap-1 text-caption font-semibold text-primary-50">
                <input
                  type="checkbox"
                  checked={d.closed}
                  onChange={(e) => setDay(d.weekday, { closed: e.target.checked })}
                />
                휴무
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
