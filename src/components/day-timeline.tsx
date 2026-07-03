'use client';

/**
 * 디자이너 일(day) 타임라인 — 디자이너 행 × 시간축 막대.
 *
 * 일정 탭의 일 뷰에서 쓰던 렌더링을 공용 컴포넌트로 뽑았다. 세 곳에서 재사용한다:
 *  - 일정 탭(일 뷰)         : 전체 디자이너 + 클릭 시 상세 시트
 *  - 홈(오늘 일정)          : <TodayTimeline> — 오늘 전체 디자이너, 필터 칩 포함
 *  - 예약 상세(방문일 일정) : <DesignerDayTimeline> — 담당 디자이너 1명, 해당 예약 강조
 *
 * 상태 표현은 일정 탭과 동일: 확정·완료 = 채움, 대기·입금대기 = 점선("요청"), 취소 = 흐림.
 * 디자이너 색은 등록 순서 기반(TIMELINE_PALETTE)이라 어느 화면에서든 같은 색을 쓴다.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { designersApi, reservationsApi } from '@/services';
import type { Designer, Reservation } from '@/services';
import { useMyShop } from '@/hooks/use-my-shop';
import { collectAll } from '@/lib/api-client';
import { formatTime, todayLocalDate } from '@/lib/date';
import { computeWindow, isoToMinutes, kindOf, TIMELINE_PALETTE } from '@/lib/timeline';

type Palette = (typeof TIMELINE_PALETTE)[number];

const localDateOf = (iso: string) => todayLocalDate(new Date(iso));
const isCancelled = (r: Reservation) => kindOf(r.status) === 'cancelled';

/** 디자이너 목록 → id별 팔레트 색(등록 순서 기반). */
function useColorOf(designers: Designer[]) {
  return useMemo(() => {
    const map = new Map<string, Palette>();
    designers.forEach((d, i) => map.set(d.id, TIMELINE_PALETTE[i % TIMELINE_PALETTE.length]));
    return map;
  }, [designers]);
}

/* ───────────────────────── 프레젠테이션 ───────────────────────── */

export function DayTimeline({
  designers,
  reservations,
  businessHours,
  date,
  colorOf,
  onSelect,
  highlightId,
}: {
  designers: Designer[];
  reservations: Reservation[];
  businessHours: Parameters<typeof computeWindow>[0];
  date: string;
  colorOf: Map<string, Palette>;
  onSelect?: (id: string) => void;
  highlightId?: string;
}) {
  const dayRes = useMemo(
    () => reservations.filter((r) => localDateOf(r.start_at) === date),
    [reservations, date],
  );
  const win = useMemo(
    () => computeWindow(businessHours, dayRes.filter((r) => !isCancelled(r))),
    [businessHours, dayRes],
  );

  const byDesigner = useMemo(() => {
    const map = new Map<string, Reservation[]>();
    for (const r of dayRes) {
      const list = map.get(r.designer_id) ?? [];
      list.push(r);
      map.set(r.designer_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return map;
  }, [dayRes]);

  const { startHour, endHour } = win;
  const hourCount = endHour - startHour;
  const startMin = startHour * 60;
  const spanMin = hourCount * 60;
  const step = 100 / hourCount;
  const pct = (min: number) => ((min - startMin) / spanMin) * 100;
  const grid = `repeating-linear-gradient(to right, transparent 0, transparent calc(${step}% - 1px), #f4f3ee calc(${step}% - 1px), #f4f3ee ${step}%)`;

  const now = new Date();
  const nowMin = date === todayLocalDate() ? now.getHours() * 60 + now.getMinutes() : null;
  const nowPct = nowMin != null ? pct(nowMin) : null;
  const showNow = nowPct != null && nowPct >= 0 && nowPct <= 100;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div className="sticky top-0 z-10 flex border-b border-neutral-200 bg-neutral-50">
          <div className="w-[150px] shrink-0 border-r border-neutral-200 px-3.5 py-2 text-xs text-neutral-400">
            디자이너
          </div>
          <div className="flex flex-1">
            {Array.from({ length: hourCount }, (_, i) => (
              <span
                key={i}
                className="flex-1 border-r border-neutral-100 px-1.5 pt-2.5 text-[11px] text-neutral-400 last:border-r-0"
              >
                {startHour + i}
              </span>
            ))}
          </div>
        </div>

        {designers.map((d, i) => {
          const color = colorOf.get(d.id) ?? TIMELINE_PALETTE[0];
          const jobs = byDesigner.get(d.id) ?? [];
          const live = jobs.filter((r) => !isCancelled(r)).length;
          const last = i === designers.length - 1;
          return (
            <div key={d.id} className={`flex ${last ? '' : 'border-b border-neutral-100'}`}>
              <div className="flex w-[150px] shrink-0 items-center gap-2 border-r border-neutral-200 bg-neutral-50/60 px-3.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color.border }} />
                <span className="whitespace-nowrap text-[13.5px] font-semibold">{d.name}</span>
                <span className="ml-auto text-[11px] text-neutral-300">{live}건</span>
              </div>
              <div className="relative h-[62px] flex-1" style={{ background: grid }}>
                {showNow && (
                  <div className="absolute inset-y-0 z-[2] w-0.5 bg-secondary/70" style={{ left: `${nowPct}%` }}>
                    <span className="absolute -left-[3px] -top-0.5 h-2 w-2 rounded-full bg-secondary" />
                  </div>
                )}
                {jobs.map((r) => (
                  <DayBar
                    key={r.id}
                    reservation={r}
                    color={color}
                    pct={pct}
                    onSelect={onSelect}
                    highlighted={r.id === highlightId}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayBar({
  reservation: r,
  color,
  pct,
  onSelect,
  highlighted,
}: {
  reservation: Reservation;
  color: Palette;
  pct: (min: number) => number;
  onSelect?: (id: string) => void;
  highlighted?: boolean;
}) {
  const startPct = Math.max(0, pct(isoToMinutes(r.start_at)));
  const endPct = Math.min(100, pct(isoToMinutes(r.end_at)));
  const width = Math.max(0, endPct - startPct);
  if (width <= 0) return null;

  const kind = kindOf(r.status);
  const requested = kind === 'requested';
  const cancelled = kind === 'cancelled';
  const who = r.user?.nickname ?? '고객';
  const svc = r.design?.title ?? '시술';
  const interactive = !!onSelect;

  return (
    <button
      type="button"
      onClick={interactive ? () => onSelect!(r.id) : undefined}
      className={`absolute inset-y-[8px] overflow-hidden rounded-r-lg px-2 py-1 text-left transition-transform ${
        interactive ? 'cursor-pointer hover:-translate-y-px' : 'cursor-default'
      } ${cancelled ? 'opacity-45' : ''}`}
      style={{
        left: `${startPct}%`,
        width: `${width}%`,
        background: requested ? '#ffffff' : color.bg,
        borderLeft: `3px solid ${color.border}`,
        borderTop: requested ? `1px dashed ${color.border}` : undefined,
        borderRight: requested ? `1px dashed ${color.border}` : undefined,
        borderBottom: requested ? `1px dashed ${color.border}` : undefined,
        color: color.text,
        boxShadow: highlighted ? `0 0 0 2px ${color.border}` : undefined,
      }}
      title={`${who} · ${svc} · ${formatTime(r.start_at)}~${formatTime(r.end_at)}`}
    >
      <div className={`truncate text-[11.5px] font-bold ${cancelled ? 'line-through' : ''}`}>
        {who}
        {requested && (
          <span className="ml-1 rounded px-1 text-[9px] font-bold" style={{ background: color.bg, color: color.text }}>
            요청
          </span>
        )}
      </div>
      <div className="truncate text-[10.5px] opacity-85">
        {svc} · {formatTime(r.start_at)}~{formatTime(r.end_at)}
      </div>
    </button>
  );
}

/* ───────────────────────── 홈: 오늘 전체 일정 ───────────────────────── */

export function TodayTimeline() {
  const date = todayLocalDate();
  const { data: shop } = useMyShop();
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const designersQuery = useQuery({
    queryKey: ['designers'],
    queryFn: () => designersApi.listDesigners(),
  });
  const designers = useMemo(() => designersQuery.data ?? [], [designersQuery.data]);
  const colorOf = useColorOf(designers);

  const resQuery = useQuery({
    queryKey: ['reservations', 'timeline', date, date],
    queryFn: () =>
      collectAll<Reservation>((cursor) =>
        reservationsApi.listReservations({ from: date, to: date, limit: 50, cursor }),
      ),
  });
  const reservations = resQuery.data ?? [];
  const visible = designers.filter((d) => !hidden.has(d.id));

  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size >= designers.length) next.clear();
      return next;
    });

  const loading = designersQuery.isLoading || resQuery.isLoading;

  return (
    <div className="space-y-3">
      {designers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setHidden(new Set())}
            className={`inline-flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-[12.5px] font-semibold ${
              hidden.size === 0 ? 'border-secondary text-neutral-800' : 'border-neutral-300 bg-neutral-50 text-neutral-400'
            }`}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: hidden.size === 0 ? 'var(--color-secondary, #8b7565)' : '#ccc' }}
            />
            전체
          </button>
          {designers.map((d) => {
            const off = hidden.has(d.id);
            const color = colorOf.get(d.id) ?? TIMELINE_PALETTE[0];
            return (
              <button
                key={d.id}
                onClick={() => toggle(d.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold ${
                  off ? 'border-neutral-200 bg-neutral-50 text-neutral-400' : 'border-neutral-200 text-neutral-800'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color.border, opacity: off ? 0.3 : 1 }} />
                {d.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-primary-10 bg-white">
        {loading ? (
          <p className="py-10 text-center text-sm text-neutral-400">불러오는 중…</p>
        ) : designers.length === 0 ? (
          <p className="py-10 text-center text-sm text-neutral-400">등록된 디자이너가 없어요.</p>
        ) : (
          <DayTimeline
            designers={visible}
            reservations={reservations}
            businessHours={shop?.business_hours}
            date={date}
            colorOf={colorOf}
          />
        )}
      </div>
    </div>
  );
}

/* ─────────────────── 예약 상세: 방문일의 담당 디자이너 일정 ─────────────────── */

export function DesignerDayTimeline({ reservation: r }: { reservation: Reservation }) {
  const date = localDateOf(r.start_at);
  const { data: shop } = useMyShop();

  const designersQuery = useQuery({
    queryKey: ['designers'],
    queryFn: () => designersApi.listDesigners(),
  });
  const designers = useMemo(() => designersQuery.data ?? [], [designersQuery.data]);
  const colorOf = useColorOf(designers);

  const resQuery = useQuery({
    queryKey: ['reservations', 'timeline', date, date],
    queryFn: () =>
      collectAll<Reservation>((cursor) =>
        reservationsApi.listReservations({ from: date, to: date, limit: 50, cursor }),
      ),
  });
  const reservations = resQuery.data ?? [];

  // 담당 디자이너 1명만 렌더. 목록에 없으면 예약에 담긴 이름으로 임시 행을 만든다.
  const found = designers.find((d) => d.id === r.designer_id);
  const rowDesigners: Designer[] = found
    ? [found]
    : r.designer_id
      ? [{ id: r.designer_id, name: r.designer?.name ?? '담당자' } as Designer]
      : [];

  if (resQuery.isLoading || designersQuery.isLoading) {
    return <p className="py-4 text-[13px] text-neutral-400">일정 불러오는 중…</p>;
  }
  if (rowDesigners.length === 0) {
    return <p className="py-2 text-[13px] text-neutral-400">담당 디자이너 정보가 없어요.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-primary-10 bg-white">
      <DayTimeline
        designers={rowDesigners}
        reservations={reservations}
        businessHours={shop?.business_hours}
        date={date}
        colorOf={colorOf}
        highlightId={r.id}
      />
    </div>
  );
}
