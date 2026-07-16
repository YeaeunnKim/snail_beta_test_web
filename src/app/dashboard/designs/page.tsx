'use client';

/**
 * 디자인 등록/관리.
 *
 * 등록 폼:
 *  - 대표 스네일 사진 1장(필수, 썸네일로 노출) + 상세 사진 최대 5장(선택, 손 후기 등)
 *  - 제목(사장님 관리용, 고객 미노출) · 설명(앱 미노출 메모)
 *  - 폴더(만들기/선택)로 정리 — 예: "7월 이달의 아트"
 *  - 사장님 태그: 단어 입력→등록(엔터), X로 삭제, 최대 10개
 *  - 디자이너 선택 시 디자이너별 소요시간을 +/-로 조정(미조정 시 기본 소요시간)
 *
 * 목록: 카드별 AI 분석 상태 배지(pending/in_progress면 폴링), failed 시 재분석.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designersApi, designsApi } from '@/services';
import type { Design, DesignFolder } from '@/services';
import { collectAll } from '@/lib/api-client';
import { toUserMessage } from '@/lib/error-messages';
import { useMyShop } from '@/hooks/use-my-shop';
// 설정 입력 관련 상수·타입·헬퍼·컴포넌트는 ./design-settings 로 추출해
// 새 디자인/대량 등록/수정/정렬 화면이 ★완전히 동일하게★ 재사용한다.
import { nextDesignNumber } from './design-settings';
import { useSortJobs } from '@/stores/sort-jobs';
import { Lightbox } from './_components/photo';
import { designImageUrls, formatWon } from './_lib/design-helpers';
import { CreateForm } from './_components/create-form';
import { RefineForm } from './_components/refine-form';
import { BulkDropzone, BulkAddModal } from './_components/bulk-add';
import { DesignEditForm } from './_components/design-edit-form';

/** 샵마다 기본으로 만들어 두는 디자인 폴더 */
const DEFAULT_FOLDERS = ['7월의 아트', '8월의 아트'];

type FolderView = { label: string; folderId?: string; unfiled?: boolean };

export default function DesignsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showRefine, setShowRefine] = useState(false); // "사진 다듬기"(구 디자인 정렬) 인라인 폼
  const [open, setOpen] = useState<FolderView | null>(null); // null = 폴더 목록

  const designers = useQuery({ queryKey: ['designers'], queryFn: () => designersApi.listDesigners() });
  const foldersQuery = useQuery({
    queryKey: ['design-folders'],
    queryFn: () => designsApi.listFolders(),
  });
  const unfiledQuery = useQuery({
    queryKey: ['designs', 'unfiled'],
    queryFn: () =>
      collectAll<Design>((cursor) => designsApi.listDesigns({ unfiled: true, limit: 50, cursor })),
  });

  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data]);
  const unfiledCount = unfiledQuery.data?.length ?? 0;

  // "디자인 정렬"에서 /dashboard/designs?folder=<id> 로 넘어오면 그 폴더를 자동으로 연다.
  const [pendingFolder, setPendingFolder] = useState<string | null>(null);
  useEffect(() => {
    setPendingFolder(new URLSearchParams(window.location.search).get('folder'));
  }, []);
  useEffect(() => {
    if (!pendingFolder) return;
    const f = folders.find((x) => x.id === pendingFolder);
    if (!f) return; // 폴더 목록이 아직 안 왔으면 다음 렌더에서 다시 시도
    setOpen({ label: f.name, folderId: f.id });
    setPendingFolder(null);
    window.history.replaceState(null, '', '/dashboard/designs'); // URL 정리(뒤로가기 정상화)
  }, [pendingFolder, folders]);

  // 기본 폴더(7월의 아트·8월의 아트)가 없으면 자동 생성 (샵마다 1회)
  const { data: shop } = useMyShop();
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !shop || !foldersQuery.isSuccess) return;
    const flag = `snail_beta_folders:${shop.id}`;
    if (typeof window !== 'undefined' && window.localStorage.getItem(flag)) {
      seededRef.current = true;
      return;
    }
    const names = new Set((foldersQuery.data ?? []).map((f) => f.name));
    const missing = DEFAULT_FOLDERS.filter((n) => !names.has(n));
    seededRef.current = true;
    void (async () => {
      for (const name of missing) {
        try {
          await designsApi.createFolder({ name });
        } catch {
          /* 무시 */
        }
      }
      try {
        window.localStorage.setItem(flag, '1');
      } catch {
        /* 무시 */
      }
      if (missing.length) qc.invalidateQueries({ queryKey: ['design-folders'] });
    })();
  }, [shop, foldersQuery.isSuccess, foldersQuery.data, qc]);

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ['designs'] });
    qc.invalidateQueries({ queryKey: ['design-folders'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-heading-lg font-bold">디자인 관리</h1>
          <p className="mt-1 text-body-sm text-primary-50">폴더로 정리하고, 폴더를 열어 디자인을 관리합니다.</p>
        </div>
        <div className="flex flex-col items-stretch gap-2">
          <button
            onClick={() => {
              setShowCreate((v) => !v);
              setShowRefine(false);
            }}
            className="rounded-md bg-secondary px-4 py-2 text-body-sm font-semibold text-white"
          >
            {showCreate ? '닫기' : '+ 새 디자인'}
          </button>
          <button
            onClick={() => {
              setShowRefine((v) => !v);
              setShowCreate(false);
            }}
            className="rounded-md border border-secondary px-4 py-2 text-center text-body-sm font-semibold text-secondary hover:bg-secondary/5"
          >
            {showRefine ? '닫기' : '사진 다듬기'}
          </button>
        </div>
      </div>

      {showCreate && (
        <CreateForm
          designers={designers.data ?? []}
          // 특정 폴더를 연 상태에서 새 디자인을 만들면 그 폴더에 생성한다.
          // (미분류 뷰이거나 폴더 목록이면 폴더 없음으로 시작)
          defaultFolderId={open && !open.unfiled ? (open.folderId ?? '') : ''}
          onCreated={() => {
            refetchAll();
            setShowCreate(false);
          }}
        />
      )}

      {showRefine && (
        <RefineForm
          designers={designers.data ?? []}
          // 새 디자인과 동일: 폴더 안에서 열면 그 폴더 자동지정, 폴더 목록/미분류면 직접 선택.
          defaultFolderId={open && !open.unfiled ? (open.folderId ?? '') : ''}
          onStarted={(folder) => {
            setShowRefine(false);
            // 결과가 채워지는 폴더로 이동해 진행상황 배너를 보여준다.
            setOpen({ label: folder.name, folderId: folder.id });
            refetchAll();
          }}
        />
      )}

      {open ? (
        <FolderDesigns view={open} onBack={() => setOpen(null)} />
      ) : (
        <FolderGrid
          folders={folders}
          unfiledCount={unfiledCount}
          loading={foldersQuery.isLoading || unfiledQuery.isLoading}
          onOpen={setOpen}
        />
      )}
    </div>
  );
}

/* ───────────── 폴더 목록 ───────────── */

function FolderGrid({
  folders,
  unfiledCount,
  loading,
  onOpen,
}: {
  folders: DesignFolder[];
  unfiledCount: number;
  loading: boolean;
  onOpen: (v: FolderView) => void;
}) {
  if (loading) return <p className="text-body-sm text-primary-50">불러오는 중…</p>;

  return (
    <div className="grid grid-cols-2 gap-3">
      {folders.map((f) => (
        <EditableFolderCard
          key={f.id}
          folder={f}
          onOpen={() => onOpen({ label: f.name, folderId: f.id })}
        />
      ))}
      {unfiledCount > 0 && (
        <FolderCard name="미분류" count={unfiledCount} muted onClick={() => onOpen({ label: '미분류', unfiled: true })} />
      )}
      <NewFolderCard />
    </div>
  );
}

function FolderCard({
  name,
  count,
  muted,
  onClick,
}: {
  name: string;
  count: number;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:border-secondary hover:shadow-sm"
    >
      <span className="text-2xl">{muted ? '🗂️' : '📁'}</span>
      <span className="mt-2 line-clamp-2 w-full break-keep font-semibold">{name}</span>
      <span className="mt-0.5 text-caption text-primary-50">디자인 {count}개</span>
    </button>
  );
}

function EditableFolderCard({ folder, onOpen }: { folder: DesignFolder; onOpen: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [month, setMonth] = useState(folder.featured_month ?? '');
  const [error, setError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: (body: { featured_month: string | null }) =>
      designsApi.updateFolder(folder.id, body),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ['design-folders'] });
    },
    onError: (e) => setError(toUserMessage(e)),
  });

  const del = useMutation({
    mutationFn: () => designsApi.deleteFolder(folder.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['design-folders'] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e) => setError(toUserMessage(e)),
  });
  const onDelete = () => {
    const msg =
      folder.design_count > 0
        ? `「${folder.name}」 폴더를 삭제할까요? 폴더 안에 디자인 ${folder.design_count}개가 있어요.`
        : `「${folder.name}」 폴더를 삭제할까요?`;
    if (window.confirm(msg)) del.mutate();
  };

  return (
    <div className="flex flex-col rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-secondary hover:shadow-sm">
      <button onClick={onOpen} className="flex flex-col text-left">
        <span className="text-2xl">📁</span>
        <span className="mt-2 line-clamp-2 w-full break-keep font-semibold">{folder.name}</span>
        <span className="mt-0.5 text-caption text-primary-50">디자인 {folder.design_count}개</span>
      </button>
      {folder.featured_month && !editing && (
        <span className="mt-1 text-caption font-semibold text-secondary">
          🗓 이달의 아트 {folder.featured_month}
        </span>
      )}
      {editing ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-caption outline-none focus:border-secondary"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => update.mutate({ featured_month: month || null })}
              disabled={update.isPending}
              className="flex-1 rounded-md bg-secondary py-1 text-caption font-semibold text-white disabled:opacity-50"
            >
              저장
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setMonth(folder.featured_month ?? '');
                setError(null);
              }}
              className="rounded-md border border-neutral-300 px-2 py-1 text-caption text-primary-50"
            >
              취소
            </button>
          </div>
          {error && <p className="text-caption text-danger">{error}</p>}
        </div>
      ) : (
        <div className="mt-1 flex items-center justify-between gap-2">
          <button
            onClick={() => setEditing(true)}
            className="text-left text-caption text-primary-50 underline hover:text-secondary"
          >
            {folder.featured_month ? '진행월 변경' : '이달의 아트 지정'}
          </button>
          <button
            onClick={onDelete}
            disabled={del.isPending}
            className="text-caption text-danger/80 hover:text-danger disabled:opacity-50"
          >
            {del.isPending ? '삭제 중…' : '삭제'}
          </button>
        </div>
      )}
      {error && !editing && <p className="mt-1 text-caption text-danger">{error}</p>}
    </div>
  );
}

function NewFolderCard() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [featuredMonth, setFeaturedMonth] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: { name: string; featured_month: string | null }) =>
      designsApi.createFolder(body),
    onSuccess: () => {
      setName('');
      setFeaturedMonth('');
      setEditing(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ['design-folders'] });
    },
    onError: (e) => setError(toUserMessage(e)),
  });

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex min-h-[104px] flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 text-body-sm font-semibold text-primary-50 hover:border-secondary hover:text-secondary"
      >
        <span className="text-heading-lg leading-none">+</span>
        <span className="mt-1">새 폴더</span>
      </button>
    );
  }
  return (
    <div className="flex flex-col justify-center rounded-xl border border-secondary/40 bg-white p-3">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim())
            create.mutate({ name: name.trim(), featured_month: featuredMonth || null });
          if (e.key === 'Escape') setEditing(false);
        }}
        placeholder="폴더 이름"
        maxLength={60}
        className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-body-sm outline-none focus:border-secondary"
      />
      <input
        type="month"
        value={featuredMonth}
        onChange={(e) => setFeaturedMonth(e.target.value)}
        title="이달의 아트 진행월 (비우면 일반 폴더)"
        className="mt-1.5 w-full rounded-md border border-neutral-300 px-2 py-1 text-caption outline-none focus:border-secondary"
      />
      <div className="mt-2 flex gap-1.5">
        <button
          onClick={() =>
            name.trim() && create.mutate({ name: name.trim(), featured_month: featuredMonth || null })
          }
          disabled={create.isPending || !name.trim()}
          className="flex-1 rounded-md bg-secondary py-1.5 text-caption font-semibold text-white disabled:opacity-50"
        >
          만들기
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setName('');
            setFeaturedMonth('');
            setError(null);
          }}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-caption font-semibold text-primary-50"
        >
          취소
        </button>
      </div>
      {error && <p className="mt-1 text-caption text-danger">{error}</p>}
    </div>
  );
}

/* ───────────── 폴더 내부 디자인 ───────────── */

function FolderDesigns({ view, onBack }: { view: FolderView; onBack: () => void }) {
  const qc = useQueryClient();
  // 이 폴더의 백그라운드 정렬 작업 진행상황 — stores/sort-jobs (탭 이동해도 유지됨).
  const job = useSortJobs((s) => (view.folderId ? s.jobs[view.folderId] : undefined));
  const clearJob = useSortJobs((s) => s.clearJob);
  const markDone = useSortJobs((s) => s.markDone);
  const jobActive = job?.status === 'uploading' || job?.status === 'processing';
  const q = useQuery({
    queryKey: ['designs', view.unfiled ? 'unfiled' : 'folder', view.folderId ?? 'none'],
    queryFn: () =>
      collectAll<Design>((cursor) =>
        designsApi.listDesigns({ folder_id: view.folderId, unfiled: view.unfiled, limit: 50, cursor }),
      ),
    // 업로드/정렬 처리 중이면 새로 생성되는 디자인이 실시간으로 보이도록 주기적으로 갱신.
    refetchInterval: jobActive ? 2000 : false,
  });
  const designs = q.data ?? [];

  // 정렬 진행률: 폴더에 늘어난 디자인 수로 계산(백엔드가 백그라운드로 생성).
  const sortProduced = job ? Math.max(0, designs.length - job.baseCount) : 0;
  const sortDone = job ? Math.min(job.total, sortProduced) : 0;
  useEffect(() => {
    if (job?.status === 'processing' && job.total > 0 && sortDone >= job.total && view.folderId) {
      markDone(view.folderId);
    }
  }, [job?.status, job?.total, sortDone, view.folderId, markDone]);

  const designersQuery = useQuery({ queryKey: ['designers'], queryFn: () => designersApi.listDesigners() });
  const [bulkFiles, setBulkFiles] = useState<File[] | null>(null); // 비어있지 않으면 일괄 모달 오픈

  // 실제 폴더에서만 일괄 등록(미분류는 제목에 폴더명을 못 붙임)
  const canBulk = !!view.folderId && !view.unfiled;

  const refetchLists = () => {
    qc.invalidateQueries({ queryKey: ['designs'] });
    qc.invalidateQueries({ queryKey: ['design-folders'] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-body-sm font-semibold text-primary hover:bg-neutral-50"
        >
          ← 폴더
        </button>
        <h2 className="text-heading-md font-bold">{view.label}</h2>
        <span className="text-body-sm text-primary-50">{designs.length}개</span>
      </div>

      {/* 디자인 정렬 진행상황 배너 */}
      {job && (
        <div
          className={`flex items-center gap-3 rounded-lg border p-4 ${
            job.status === 'error'
              ? 'border-danger/40 bg-danger-bg'
              : jobActive
                ? 'border-secondary/40 bg-secondary/5'
                : 'border-neutral-200 bg-white'
          }`}
        >
          {jobActive ? (
            // TODO: 사장님이 제공할 로딩 PNG로 교체하세요.
            //   예: <img src="/loading-snail.png" alt="다듬는 중" className="h-9 w-9 shrink-0 animate-spin" />
            //   지금은 자리표시용 원형 스피너입니다(회전 애니메이션 동일).
            <div
              className="h-9 w-9 shrink-0 animate-spin rounded-full border-4 border-secondary/20 border-t-secondary"
              role="status"
              aria-label="다듬는 중"
            />
          ) : job.status === 'error' ? (
            <span className="text-2xl">⚠️</span>
          ) : designs[0]?.thumbnail_url ? (
            // 완료: 방금 다듬어진 결과 사진(목록 최상단 = 가장 최근 생성)을 미리보기로.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={designs[0].thumbnail_url}
              alt="다듬은 결과"
              className="h-12 w-12 shrink-0 rounded-md border border-neutral-200 object-cover"
            />
          ) : (
            <span className="text-2xl">✅</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-semibold text-primary">
              {job.status === 'uploading'
                ? `사진 올리는 중… ${job.uploaded}/${job.total}`
                : job.status === 'processing'
                  ? `다듬는 중.. ${sortDone}/${job.total}`
                  : job.status === 'error'
                    ? '다듬기를 시작하지 못했어요'
                    : '완료되었어요.'}
            </p>
            <p className="text-caption text-primary-50">
              {job.status === 'uploading'
                ? '원본 사진을 올리고 있어요.'
                : job.status === 'processing'
                  ? '사진 한 장당 약 1분 걸릴 수 있어요. 이 화면을 떠나도 계속 처리돼요. 완료되면 여기에 나타나요.'
                  : job.status === 'error'
                    ? (job.error ?? '잠시 후 다시 시도해 주세요.')
                    : '아래에서 확인해 보세요.'}
            </p>
          </div>
          {(job.status === 'done' || job.status === 'error') && (
            <button
              type="button"
              onClick={() => view.folderId && clearJob(view.folderId)}
              className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:text-primary"
            >
              {job.status === 'done' ? '확인' : '닫기'}
            </button>
          )}
        </div>
      )}

      {canBulk && (
        <>
          <BulkDropzone onFiles={setBulkFiles} />
          <p className="text-caption text-primary-50">
            💡 등록 후 각 디자인의 <strong className="text-primary">수정</strong>을 누르면 가격·사진·태그 등을 개별로
            바꿀 수 있어요.
          </p>
        </>
      )}

      {canBulk && bulkFiles && bulkFiles.length > 0 && (
        <BulkAddModal
          folderId={view.folderId!}
          folderName={view.label}
          files={bulkFiles}
          startNumber={nextDesignNumber(view.label, designs)}
          designers={designersQuery.data ?? []}
          onClose={() => setBulkFiles(null)}
          onCreated={refetchLists}
        />
      )}

      {q.isLoading ? (
        <p className="text-body-sm text-primary-50">불러오는 중…</p>
      ) : q.isError ? (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">{toUserMessage(q.error)}</p>
      ) : designs.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-body-sm text-primary-50">
          이 폴더에 디자인이 없습니다.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3">
          {designs.map((d) => (
            <DesignCard key={d.id} design={d} />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────── 디자인 카드 ───────────── */

function DesignCard({ design }: { design: Design }) {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [zoomIndex, setZoomIndex] = useState<number | null>(null); // null = 확대 뷰 닫힘
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [moveErr, setMoveErr] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['design', design.id],
    queryFn: () => designsApi.getDesign(design.id),
    initialData: design,
    refetchInterval: (q) => {
      const s = q.state.data?.ai_analysis_status;
      const active = s === 'pending' || s === 'in_progress';
      return active ? 3000 : false;
    },
  });
  const d = data ?? design;

  const reanalyze = useMutation({
    mutationFn: () => designsApi.reanalyze(d.id),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e) => setActionError(toUserMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => designsApi.deleteDesign(d.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['designs'] });
      qc.invalidateQueries({ queryKey: ['design-folders'] });
    },
    onError: (e) => setActionError(toUserMessage(e)),
  });

  // 폴더 이동용 — 폴더 목록(부모와 동일 캐시 재사용) + 이동 뮤테이션
  const foldersQuery = useQuery({ queryKey: ['design-folders'], queryFn: () => designsApi.listFolders() });
  const folders = foldersQuery.data ?? [];
  const move = useMutation({
    mutationFn: (folderId: string) => designsApi.updateDesign(d.id, { folder_id: folderId || null }),
    onSuccess: () => {
      setMoveErr(null);
      qc.invalidateQueries({ queryKey: ['designs'] });
      qc.invalidateQueries({ queryKey: ['design-folders'] });
      qc.invalidateQueries({ queryKey: ['design', d.id] });
    },
    onError: (e) => setMoveErr(toUserMessage(e)),
  });

  // 디자인별 공개/비공개 전환. 공개 조건(백엔드 검증): 샵 공개 + 오너 승인 (AI 분석과 무관).
  // AI는 백그라운드로 계속 돌며 완료 시 검색 랭킹만 보강 — 공개(노출)를 막지 않는다.
  const publish = useMutation({
    mutationFn: (visibility: 'active' | 'hidden') => designsApi.changeVisibility(d.id, { visibility }),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e) => setActionError(toUserMessage(e)),
  });

  const zoomUrls = designImageUrls(d); // 확대 뷰에 넘길 사진 URL(대표 먼저)
  const photoCount = zoomUrls.length;

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start gap-3">
        {/* 대표 사진 — 클릭 시 상세 사진 펼침 */}
        <button
          type="button"
          onClick={() => photoCount > 0 && setZoomIndex(0)}
          disabled={photoCount === 0}
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-neutral-200 disabled:cursor-default"
          title="사진 확대"
        >
          {d.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.thumbnail_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="block h-full w-full bg-neutral-100" />
          )}
          {photoCount > 0 && (
            <span className="absolute inset-x-0 bottom-0 bg-black/40 py-0.5 text-center text-caption font-semibold text-white">
              🔍 {photoCount}
            </span>
          )}
        </button>

        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{d.title}</p>
            <p className="mt-0.5 text-body-sm text-primary-50">
              {d.intro_price != null && d.intro_price < d.base_price ? (
                <>
                  <span className="line-through">{formatWon(d.base_price)}</span>{' '}
                  <span className="font-semibold text-secondary">{formatWon(d.intro_price)}</span>
                </>
              ) : (
                formatWon(d.base_price)
              )}{' '}
              · 기본 {d.duration_minutes}분
            </p>
            {d.owner_tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {d.owner_tags.map((t) => (
                  <span key={`o-${t}`} className="rounded bg-secondary/10 px-2 py-0.5 text-caption text-secondary">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {!editing && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => {
                  setEditing(true);
                  setConfirmDel(false);
                  setActionError(null);
                }}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary hover:bg-neutral-50"
              >
                수정
              </button>
              {confirmDel ? (
                <span className="inline-flex items-center gap-1.5 text-caption text-primary-50">
                  삭제할까요?
                  <button
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                    className="rounded-md bg-danger-bg px-2.5 py-1.5 text-caption font-semibold text-danger disabled:opacity-50"
                  >
                    {remove.isPending ? '삭제 중…' : '삭제 확인'}
                  </button>
                  <button
                    onClick={() => setConfirmDel(false)}
                    className="rounded-md bg-neutral-100 px-2.5 py-1.5 text-caption font-semibold text-primary"
                  >
                    취소
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDel(true)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:bg-neutral-50"
                >
                  삭제
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 폴더 이동 — 다른 폴더(또는 미분류)로 즉시 옮긴다 */}
      {!editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-caption text-primary-50">📁 폴더</span>
          <select
            value={d.folder_id ?? ''}
            onChange={(e) => move.mutate(e.target.value)}
            disabled={move.isPending}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-caption outline-none focus:border-secondary disabled:opacity-50"
            aria-label="폴더 이동"
          >
            <option value="">미분류</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {move.isPending && <span className="text-caption text-primary-50">이동 중…</span>}
          {moveErr && <span className="text-caption text-danger">{moveErr}</span>}
        </div>
      )}

      {/* 앱 노출(디자인별 공개) — 샵 공개와 별개로 디자인마다 공개해야 앱 피드에 노출된다.
          공개는 AI 분석과 무관(백엔드가 노출을 AI에서 분리). AI가 아직/실패여도 바로 공개할 수 있고,
          AI는 백그라운드로 돌며 완료 시 검색 랭킹만 보강한다. */}
      {!editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-caption text-primary-50">👁 앱 노출</span>
          {d.visibility === 'active' ? (
            <span className="rounded-full bg-success-bg px-2 py-0.5 text-caption font-semibold text-success">
              공개 중
            </span>
          ) : (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-semibold text-primary-50">
              비공개
            </span>
          )}
          {d.visibility === 'active' ? (
            <button
              onClick={() => publish.mutate('hidden')}
              disabled={publish.isPending}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:bg-neutral-50 disabled:opacity-50"
            >
              {publish.isPending ? '처리 중…' : '비공개로 전환'}
            </button>
          ) : (
            <button
              onClick={() => publish.mutate('active')}
              disabled={publish.isPending}
              className="rounded-md bg-secondary px-3 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
            >
              {publish.isPending ? '처리 중…' : '앱에 공개'}
            </button>
          )}
          {d.visibility !== 'active' && (
            <span className="text-caption text-primary-50">· 샵도 공개 상태여야 앱에 노출돼요</span>
          )}
          {(d.ai_analysis_status === 'pending' || d.ai_analysis_status === 'in_progress') && (
            <span className="text-caption text-primary-50">· AI 분석 중(공개엔 영향 없어요)</span>
          )}
        </div>
      )}

      {d.ai_analysis_status === 'failed' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="rounded-md bg-danger-bg p-2 text-caption text-danger">
            {d.ai_error_message ?? 'AI 분석에 실패했습니다.'}
          </div>
          {!editing && (
            <button
              onClick={() => reanalyze.mutate()}
              disabled={reanalyze.isPending}
              className="rounded-md bg-secondary px-3 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
            >
              {reanalyze.isPending ? '요청 중…' : '재분석'}
            </button>
          )}
        </div>
      )}

      {editing && <DesignEditForm design={d} onClose={() => setEditing(false)} />}

      {actionError && <p className="mt-2 text-caption text-danger">{actionError}</p>}

      {/* 사진 확대 뷰 — 수정 중에도 대표/상세 사진을 크게 볼 수 있다 */}
      <Lightbox urls={zoomUrls} index={zoomIndex} onIndex={setZoomIndex} onClose={() => setZoomIndex(null)} />
    </li>
  );
}
