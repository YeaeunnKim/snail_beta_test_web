'use client';

/**
 * 시간표 관리 — 디자이너별 주간 스케줄.
 *
 * 스케줄은 디자이너 단위(ScheduleEntry)이며 조회 GET이 없어, 진입 시 샵 영업시간으로
 * 기본값을 시드하고 저장(PUT /designers/{id}/schedule) 시 덮어쓴다.
 *  - 에브리타임 스타일 주간 그리드(영업/점심/휴무 블록 시각화)
 *  - 요일별 영업시간 + 점심·쉬는시간 + 휴무 편집
 *  - 예약 수락/거절은 예약 화면(/dashboard/reservations)에서 처리
 *
 * 하단 "추가 설정"(소요시간 디폴트·하루 최대 인원·최대 근무시간)은 백엔드 저장 위치가
 * 없어 입력 UI만 두고 비활성(연동 예정)으로 표시한다.
 */
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { designersApi } from '@/services';
import type { Shop } from '@/services';
import { useMyShop } from '@/hooks/use-my-shop';
import { toUserMessage } from '@/lib/error-messages';
import { TIME_RE, WEEKDAYS } from '@/lib/weekday';
import { seedScheduleFromHours, toMinutes } from '@/lib/schedule';

const GRID_START = 8 * 60; // 08:00
const GRID_END = 23 * 60; // 23:00
const GRID_SPAN = GRID_END - GRID_START;
const GRID_PX = 320;

const scheduleSchema = z
  .object({
    entries: z.array(
      z.object({
        weekday: z.number(),
        is_day_off: z.boolean(),
        start_time: z.string().optional().or(z.literal('')),
        end_time: z.string().optional().or(z.literal('')),
        break_start_time: z.string().optional().or(z.literal('')),
        break_end_time: z.string().optional().or(z.literal('')),
      }),
    ),
  })
  .superRefine((v, ctx) => {
    const ok = (t?: string) => !!t && TIME_RE.test(t);
    v.entries.forEach((e, i) => {
      if (e.is_day_off) return;
      if (!ok(e.start_time)) ctx.addIssue({ code: 'custom', path: ['entries', i, 'start_time'], message: '시작 시간' });
      if (!ok(e.end_time)) ctx.addIssue({ code: 'custom', path: ['entries', i, 'end_time'], message: '종료 시간' });
      if (ok(e.start_time) && ok(e.end_time) && e.start_time! >= e.end_time!)
        ctx.addIssue({ code: 'custom', path: ['entries', i, 'end_time'], message: '종료가 시작보다 늦어야 함' });

      const bs = !!e.break_start_time;
      const be = !!e.break_end_time;
      if (bs !== be)
        ctx.addIssue({ code: 'custom', path: ['entries', i, 'break_end_time'], message: '점심 시작/종료 모두 입력' });
      if (bs && be) {
        if (e.break_start_time! >= e.break_end_time!)
          ctx.addIssue({ code: 'custom', path: ['entries', i, 'break_end_time'], message: '점심 종료>시작' });
        else if (
          ok(e.start_time) &&
          ok(e.end_time) &&
          (e.break_start_time! < e.start_time! || e.break_end_time! > e.end_time!)
        )
          ctx.addIssue({ code: 'custom', path: ['entries', i, 'break_start_time'], message: '점심은 영업시간 내' });
      }
    });
  });

type ScheduleForm = z.infer<typeof scheduleSchema>;

export default function DesignersPage() {
  const { data: shop } = useMyShop();
  const designersQuery = useQuery({
    queryKey: ['designers'],
    queryFn: () => designersApi.listDesigners(),
  });
  const designers = designersQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 첫 디자이너 자동 선택
  useEffect(() => {
    const list = designersQuery.data;
    if (!selectedId && list && list.length > 0) setSelectedId(list[0].id);
  }, [designersQuery.data, selectedId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">시간표 관리</h1>
        <p className="mt-1 text-sm text-neutral-500">디자이너별 주간 영업시간·점심·휴무를 설정합니다.</p>
      </div>

      <QuickAddDesigner onAdded={() => designersQuery.refetch()} />

      {designersQuery.isLoading ? (
        <p className="text-sm text-neutral-400">불러오는 중…</p>
      ) : designers.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          등록된 디자이너가 없습니다. 위에서 디자이너를 추가해주세요.
        </p>
      ) : (
        <>
          {/* 디자이너 선택 */}
          <div className="flex flex-wrap gap-2">
            {designers.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={`rounded-full border px-4 py-1.5 text-sm ${
                  selectedId === d.id
                    ? 'border-secondary bg-secondary text-white'
                    : 'border-neutral-300 text-neutral-600'
                }`}
              >
                {d.name}
              </button>
            ))}
          </div>

          {selectedId && (
            <ScheduleEditor
              key={selectedId}
              designerId={selectedId}
              businessHours={shop?.business_hours}
            />
          )}
        </>
      )}

      <ExtraSettingsCard />
    </div>
  );
}

/** 간단 디자이너 추가 (이름만) */
function QuickAddDesigner({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (n: string) => designersApi.createDesigner({ name: n }),
    onSuccess: () => {
      setName('');
      setError(null);
      onAdded();
    },
    onError: (e) => setError(toUserMessage(e)),
  });

  return (
    <div className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="디자이너 이름 추가"
        className="w-48 rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-secondary"
      />
      <button
        onClick={() => name.trim() && mutation.mutate(name.trim())}
        disabled={mutation.isPending || !name.trim()}
        className="rounded-md border border-secondary px-3 py-2 text-sm font-medium text-secondary disabled:opacity-50"
      >
        추가
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

function ScheduleEditor({
  designerId,
  businessHours,
}: {
  designerId: string;
  businessHours?: Shop['business_hours'];
}) {
  const seed = useMemo(() => seedScheduleFromHours(businessHours), [businessHours]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ScheduleForm>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: { entries: seed },
  });
  const entries = watch('entries');

  // 디자이너 변경 시 시드로 리셋 (스케줄 GET이 없으므로 영업시간 기준)
  useEffect(() => {
    reset({ entries: seed });
    setSavedAt(null);
    setSubmitError(null);
  }, [seed, reset]);

  const onSubmit = async (values: ScheduleForm) => {
    setSubmitError(null);
    setSavedAt(null);
    try {
      await designersApi.setSchedule(designerId, {
        entries: values.entries.map((e) => ({
          weekday: e.weekday,
          is_day_off: e.is_day_off,
          start_time: e.is_day_off ? null : e.start_time || null,
          end_time: e.is_day_off ? null : e.end_time || null,
          break_start_time: e.is_day_off ? null : e.break_start_time || null,
          break_end_time: e.is_day_off ? null : e.break_end_time || null,
        })),
      });
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
    } catch (e) {
      setSubmitError(toUserMessage(e));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <p className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3 text-xs text-neutral-500">
        현재 저장된 스케줄은 불러올 수 없어 <strong>샵 영업시간 기준 기본값</strong>을 표시합니다. 저장하면 이 값으로
        덮어씁니다.
      </p>

      {/* 에타 스타일 주간 그리드 */}
      <WeeklyGrid entries={entries} />

      {/* 요일별 편집 */}
      <div className="space-y-2">
        {WEEKDAYS.map((w, i) => {
          const off = entries?.[i]?.is_day_off;
          const err = errors.entries?.[i];
          return (
            <div key={w.value} className="rounded-md border border-neutral-200 p-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-6 font-medium">{w.label}</span>
                <label className="flex items-center gap-1 text-xs text-neutral-500">
                  <input type="checkbox" {...register(`entries.${i}.is_day_off` as const)} />
                  휴무
                </label>
                <span className="text-xs text-neutral-400">영업</span>
                <input type="time" disabled={off} className={timeCls} {...register(`entries.${i}.start_time` as const)} />
                <span className="text-neutral-400">~</span>
                <input type="time" disabled={off} className={timeCls} {...register(`entries.${i}.end_time` as const)} />
                <span className="ml-2 text-xs text-neutral-400">점심</span>
                <input type="time" disabled={off} className={timeCls} {...register(`entries.${i}.break_start_time` as const)} />
                <span className="text-neutral-400">~</span>
                <input type="time" disabled={off} className={timeCls} {...register(`entries.${i}.break_end_time` as const)} />
              </div>
              {err && (
                <p className="mt-1 text-xs text-red-600">
                  {err.start_time?.message ||
                    err.end_time?.message ||
                    err.break_start_time?.message ||
                    err.break_end_time?.message}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {submitError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>}
      {savedAt && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">저장되었습니다. ({savedAt})</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-secondary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? '저장 중…' : '스케줄 저장'}
      </button>
    </form>
  );
}

/** 에브리타임 스타일 주간 시각화 (읽기 전용, 폼 상태 반영) */
function WeeklyGrid({ entries }: { entries: ScheduleForm['entries'] }) {
  const hourMarks: number[] = [];
  for (let h = 8; h <= 23; h += 2) hourMarks.push(h);

  return (
    <div className="flex rounded-lg border border-neutral-200 bg-white p-3">
      {/* 시간 축 */}
      <div className="relative w-10 shrink-0" style={{ height: GRID_PX }}>
        {hourMarks.map((h) => (
          <span
            key={h}
            className="absolute right-1 -translate-y-1/2 text-[10px] text-neutral-400"
            style={{ top: `${((h * 60 - GRID_START) / GRID_SPAN) * 100}%` }}
          >
            {h}시
          </span>
        ))}
      </div>
      {/* 요일 컬럼 */}
      <div className="grid flex-1 grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => {
          const e = entries?.[i];
          return (
            <div key={w.value} className="flex flex-col">
              <span className="mb-1 text-center text-xs font-medium text-neutral-500">{w.label}</span>
              <div className="relative flex-1 rounded bg-neutral-50" style={{ height: GRID_PX }}>
                {e && <DayBlocks entry={e} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayBlocks({ entry }: { entry: ScheduleForm['entries'][number] }) {
  if (entry.is_day_off) {
    return (
      <div className="absolute inset-0 flex items-center justify-center rounded bg-neutral-200/60 text-[10px] text-neutral-500">
        휴무
      </div>
    );
  }
  const start = toMinutes(entry.start_time);
  const end = toMinutes(entry.end_time);
  if (start == null || end == null || end <= start) return null;

  const pct = (min: number) => ((min - GRID_START) / GRID_SPAN) * 100;
  const workTop = pct(start);
  const workH = pct(end) - workTop;

  const bs = toMinutes(entry.break_start_time);
  const be = toMinutes(entry.break_end_time);
  const hasBreak = bs != null && be != null && be > bs && bs >= start && be <= end;

  return (
    <>
      <div
        className="absolute inset-x-0.5 rounded bg-secondary/70"
        style={{ top: `${workTop}%`, height: `${workH}%` }}
      />
      {hasBreak && (
        <div
          className="absolute inset-x-0.5 rounded bg-amber-300/90"
          style={{ top: `${pct(bs)}%`, height: `${pct(be) - pct(bs)}%` }}
          title="점심·쉬는시간"
        />
      )}
    </>
  );
}

/**
 * 추가 설정.
 *  - 운영 한도(하루 최대 인원·근무시간): 백엔드 구현 예정 → 입력은 활성화하되 저장 API는 TODO.
 *  - 시술 소요시간 디폴트: 백엔드 스키마 확인 예정 → UI만 유지(비활성).
 */
function ExtraSettingsCard() {
  // TODO(backend): 운영 한도 저장/조회 API 연결 (백엔드 구현 예정). 현재 입력값은 전송되지 않는다.
  const [maxPeople, setMaxPeople] = useState('');
  const [maxHours, setMaxHours] = useState('');

  return (
    <section className="space-y-5 rounded-lg border border-neutral-200 bg-white p-5">
      {/* 운영 한도 — 입력 활성, 저장은 TODO */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-neutral-700">운영 한도</h2>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
            저장 연동 예정
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <ActiveNumber label="하루 최대 인원" placeholder="예: 8" value={maxPeople} onChange={setMaxPeople} />
          <ActiveNumber
            label="하루 최대 근무시간(시간)"
            placeholder="예: 9"
            value={maxHours}
            onChange={setMaxHours}
          />
        </div>
      </div>

      {/* 시술 소요시간 디폴트 — UI만 유지 */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-neutral-700">시술 소요시간 디폴트</h2>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
            스키마 확인 예정
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Disabled label="디자인 기본(분)" placeholder="예: 120" />
          <Disabled label="제거(분)" placeholder="예: 30" />
          <Disabled label="연장(분)" placeholder="예: 30" />
        </div>
      </div>
    </section>
  );
}

function ActiveNumber({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-neutral-600">{label}</label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-secondary"
      />
    </div>
  );
}

function Disabled({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-neutral-500">{label}</label>
      <input
        type="number"
        disabled
        placeholder={placeholder}
        className="w-full cursor-not-allowed rounded-md border border-neutral-200 bg-neutral-100 px-3 py-2 text-sm text-neutral-400"
      />
    </div>
  );
}

const timeCls =
  'rounded-md border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-secondary disabled:bg-neutral-100';
