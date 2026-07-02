'use client';

/**
 * 예약 관리 — 콘솔형.
 *
 *  - 상태 탭: 방문 요청(pending) / 방문 확정(confirmed·payment_pending) / 방문 완료(completed) + 건수 배지
 *  - 필터: 오늘·전체 기간 · 디자이너 · 입금 상태 · 고객명 검색
 *  - 행 클릭 시 인라인 상세: 디자인·결제·고객 요청사항(읽기 전용)·상태 액션·변경 이력(타임스탬프)
 *  - 상태 전이/입금확인은 실제 API로 처리. (손기 예약 추가·요청 답변·재예약은 백엔드 미지원 → 제외)
 *
 * 거절/취소는 사유 필수라 상세에서 사유 입력 후 확정한다.
 */
import { Suspense, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designersApi, reservationsApi } from '@/services';
import type { Reservation, ReservationStatus } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import { collectAll } from '@/lib/api-client';
import { formatTime, todayLocalDate } from '@/lib/date';
import { TIMELINE_PALETTE } from '@/lib/timeline';
import { badgeMeta, dateTimeLabel, dayLabel, payState, won } from '@/lib/reservation-format';
import { PayPill, ReservationDetail } from '@/components/reservation-detail';

type Palette = (typeof TIMELINE_PALETTE)[number];
type TabKey = 'pending' | 'confirmed' | 'completed';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'pending', label: '방문 요청' },
  { key: 'confirmed', label: '방문 확정' },
  { key: 'completed', label: '방문 완료' },
];

/** 상태 → 어느 탭에 속하는지 (종료 상태는 탭 없음) */
function tabOf(status: ReservationStatus): TabKey | null {
  if (status === 'pending') return 'pending';
  if (status === 'confirmed' || status === 'payment_pending') return 'confirmed';
  if (status === 'completed') return 'completed';
  return null; // rejected / cancelled_* / no_show
}

export default function ReservationsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">불러오는 중…</p>}>
      <ReservationsConsole />
    </Suspense>
  );
}

function ReservationsConsole() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('pending');
  const [day, setDay] = useState<string | null>(null); // null = 전체 기간
  const [designerId, setDesignerId] = useState<string>('all');
  const [pay, setPay] = useState<'all' | 'WAIT' | 'DONE'>('all');
  const [q, setQ] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const designersQuery = useQuery({
    queryKey: ['designers'],
    queryFn: () => designersApi.listDesigners(),
  });
  const designers = useMemo(() => designersQuery.data ?? [], [designersQuery.data]);
  const colorOf = useMemo(() => {
    const map = new Map<string, Palette>();
    designers.forEach((d, i) => map.set(d.id, TIMELINE_PALETTE[i % TIMELINE_PALETTE.length]));
    return map;
  }, [designers]);

  const reservationsQuery = useQuery({
    queryKey: ['reservations', 'console', day ?? 'all'],
    queryFn: () =>
      collectAll<Reservation>((cursor) =>
        reservationsApi.listReservations({
          from: day ?? undefined,
          to: day ?? undefined,
          cursor,
          limit: 50,
        }),
      ),
  });
  const all = useMemo(() => reservationsQuery.data ?? [], [reservationsQuery.data]);

  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
    },
  });

  // 탭 제외 공통 필터 통과 집합
  const visible = useMemo(() => {
    const query = q.trim();
    return all.filter((r) => {
      if (tabOf(r.status) == null) return false;
      if (designerId !== 'all' && r.designer_id !== designerId) return false;
      if (pay !== 'all' && payState(r) !== pay) return false;
      if (query && !(r.user?.nickname ?? '').includes(query)) return false;
      return true;
    });
  }, [all, designerId, pay, q]);

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { pending: 0, confirmed: 0, completed: 0 };
    for (const r of visible) {
      const t = tabOf(r.status);
      if (t) c[t] += 1;
    }
    return c;
  }, [visible]);

  const list = useMemo(() => {
    const rows = visible.filter((r) => tabOf(r.status) === tab);
    rows.sort((a, b) => {
      if (tab === 'pending') return b.created_at.localeCompare(a.created_at); // 최근 요청 먼저
      if (tab === 'confirmed') return a.start_at.localeCompare(b.start_at); // 방문 임박 순
      return b.start_at.localeCompare(a.start_at); // 최근 완료 먼저
    });
    return rows;
  }, [visible, tab]);

  const loading = reservationsQuery.isLoading || designersQuery.isLoading;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">예약 관리</h1>
        <p className="mt-1 text-sm text-neutral-500">들어온 예약을 상태에 따라 확인하고 처리합니다.</p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 overflow-x-auto border-b border-neutral-200">
        {TABS.map((t) => {
          const on = tab === t.key;
          const need = t.key === 'pending' && counts.pending > 0;
          return (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key);
                setExpandedId(null);
              }}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 pb-3 pt-2.5 text-sm font-semibold ${
                on ? 'border-brand text-neutral-900' : 'border-transparent text-neutral-400'
              }`}
            >
              {t.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                  on ? 'bg-brand/15 text-brand' : need ? 'bg-brand/15 text-brand' : 'bg-neutral-100 text-neutral-500'
                }`}
              >
                {counts[t.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setDay(todayLocalDate())}
          className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
            day ? 'border-brand bg-brand text-white' : 'border-neutral-200 bg-white text-neutral-600'
          }`}
        >
          오늘
        </button>
        <button
          onClick={() => setDay(null)}
          className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
            day ? 'border-neutral-200 bg-white text-neutral-600' : 'border-brand bg-brand text-white'
          }`}
        >
          전체 기간
        </button>
        <select
          value={designerId}
          onChange={(e) => setDesignerId(e.target.value)}
          className="h-9 rounded-lg border border-neutral-200 bg-white px-2.5 text-sm"
        >
          <option value="all">디자이너 전체</option>
          {designers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          value={pay}
          onChange={(e) => setPay(e.target.value as 'all' | 'WAIT' | 'DONE')}
          className="h-9 rounded-lg border border-neutral-200 bg-white px-2.5 text-sm"
        >
          <option value="all">입금 전체</option>
          <option value="WAIT">입금 대기</option>
          <option value="DONE">입금 완료</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="고객명 검색"
          className="h-9 min-w-[160px] flex-1 rounded-lg border border-neutral-200 bg-white px-3 text-sm outline-none focus:border-brand sm:flex-none"
        />
      </div>

      {action.isError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{toUserMessage(action.error)}</p>
      )}

      {/* 목록 */}
      {loading ? (
        <p className="py-10 text-center text-sm text-neutral-400">불러오는 중…</p>
      ) : reservationsQuery.isError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{toUserMessage(reservationsQuery.error)}</p>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-14 text-center text-sm text-neutral-400">
          해당하는 예약이 없어요.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
          <div className="min-w-[880px]">
            <div className="grid grid-cols-[84px_130px_140px_minmax(120px,1fr)_110px_minmax(150px,1.2fr)_90px_150px_20px] items-center gap-2.5 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5 text-xs font-semibold text-neutral-400">
              <div>상태</div>
              <div>요청 날짜</div>
              <div>방문 예정</div>
              <div>고객</div>
              <div>담당자</div>
              <div>디자인</div>
              <div className="text-right">금액</div>
              <div />
              <div />
            </div>
            {list.map((r) => (
              <Row
                key={r.id}
                r={r}
                color={colorOf.get(r.designer_id) ?? TIMELINE_PALETTE[0]}
                open={expandedId === r.id}
                onToggle={() => setExpandedId((id) => (id === r.id ? null : r.id))}
                run={(fn) => action.mutate(fn)}
                busy={action.isPending}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  r,
  color,
  open,
  onToggle,
  run,
  busy,
}: {
  r: Reservation;
  color: Palette;
  open: boolean;
  onToggle: () => void;
  run: (fn: () => Promise<unknown>) => void;
  busy: boolean;
}) {
  const badge = badgeMeta(r.status);
  const ps = payState(r);

  const inline: { label: string; cls: string; fn: () => Promise<unknown> }[] = [];
  if (r.status === 'pending') inline.push({ label: '확정', cls: 'primary', fn: () => reservationsApi.accept(r.id) });
  if (r.status === 'payment_pending')
    inline.push({ label: '입금완료', cls: 'primary', fn: () => reservationsApi.confirmPayment(r.id) });
  if (r.status === 'confirmed') {
    inline.push({ label: '완료', cls: 'primary', fn: () => reservationsApi.complete(r.id) });
    inline.push({ label: '노쇼', cls: 'ghost', fn: () => reservationsApi.noShow(r.id) });
  }

  return (
    <div className={`border-b border-neutral-100 last:border-b-0 ${open ? 'bg-[#fdf4f7]' : ''}`}>
      <div
        onClick={onToggle}
        className="grid cursor-pointer grid-cols-[84px_130px_140px_minmax(120px,1fr)_110px_minmax(150px,1.2fr)_90px_150px_20px] items-center gap-2.5 px-4 py-3 hover:bg-neutral-50"
      >
        <div className="flex flex-col items-start gap-1">
          <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: badge.bg, color: badge.tx }}>
            {badge.label}
          </span>
          {ps && <PayPill state={ps} />}
        </div>
        <div className="text-[13px]">
          <div className="font-medium">{dateTimeLabel(r.created_at).split(' ')[0]}</div>
          <div className="text-[11px] text-neutral-400">{dateTimeLabel(r.created_at).split(' ')[1]}</div>
        </div>
        <div className="text-[13px]">
          <div className="font-medium">{dayLabel(r.start_at)}</div>
          <div className="text-[11px] text-neutral-400">
            {formatTime(r.start_at)}~{formatTime(r.end_at)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{r.user?.nickname ?? '고객'}</div>
          {r.user_request && <span className="text-[10px] font-bold text-brand">요청사항</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[13px] font-medium">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color.border }} />
          <span className="truncate">{r.designer?.name ?? '-'}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          {r.design?.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.design.thumbnail_url} alt="" className="h-6 w-6 shrink-0 rounded-md border border-neutral-200 object-cover" />
          ) : (
            <span className="h-6 w-6 shrink-0 rounded-md border border-neutral-200 bg-neutral-100" />
          )}
          <span className="truncate">{r.design?.title ?? '시술'}</span>
        </div>
        <div className="text-right text-[13px] font-bold">{won(r.total_price)}</div>
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {inline.map((a) => (
            <button
              key={a.label}
              disabled={busy}
              onClick={() => run(a.fn)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-bold disabled:opacity-50 ${
                a.cls === 'primary' ? 'bg-brand text-white' : 'bg-neutral-100 text-neutral-600'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className={`text-center text-xs text-neutral-300 transition-transform ${open ? 'rotate-180' : ''}`}>⌄</div>
      </div>

      {open && <ReservationDetail reservation={r} />}
    </div>
  );
}
