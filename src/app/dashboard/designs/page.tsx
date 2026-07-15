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
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designersApi, designsApi, uploadsApi } from '@/services';
import type { Design, Designer, DesignFolder } from '@/services';
import { collectAll } from '@/lib/api-client';
import { toUserMessage } from '@/lib/error-messages';
import { useMyShop } from '@/hooks/use-my-shop';
// 설정 입력 관련 상수·타입·헬퍼·컴포넌트는 ./design-settings 로 추출해
// 새 디자인/대량 등록/수정/정렬 화면이 ★완전히 동일하게★ 재사용한다.
import {
  OPTION_KINDS,
  clampDuration,
  createOptionsFor,
  defaultBulkSettings,
  loadBulkSettings,
  saveBulkSettings,
  nextDesignNumber,
  toOptionBody,
  DesignSettingsFields,
} from './design-settings';
import type { OptionRow, OptionKind, DesignSettings } from './design-settings';
import { useSortJobs } from '@/stores/sort-jobs';
import { ImageCropper } from '@/components/ImageCropper';

interface PhotoItem {
  id: string;
  name: string;
  previewUrl: string;
  objectKey?: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

/** 디자인 수정 시 사진 편집용. 기존 사진(key는 URL에서 역추출)과 새 업로드를 함께 다룬다. */
interface EditPhoto {
  uid: string;
  key: string; // object_key ('' = 업로드 중)
  previewUrl: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

/** 샵마다 기본으로 만들어 두는 디자인 폴더 */
const DEFAULT_FOLDERS = ['7월의 아트', '8월의 아트'];

const MAX_DETAIL_PHOTOS = 5;
const MAX_EDIT_PHOTOS = 6; // 수정 시 대표 1 + 상세 5
const formatWon = (n: number) => `${n.toLocaleString('ko-KR')}원`;

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

function CreateForm({
  designers,
  onCreated,
  defaultFolderId = '',
}: {
  designers: Designer[];
  onCreated: () => void;
  defaultFolderId?: string;
}) {
  const [thumbnail, setThumbnail] = useState<PhotoItem | null>(null);
  const [details, setDetails] = useState<PhotoItem[]>([]);
  const [cropFile, setCropFile] = useState<File | null>(null); // 대표 사진 선택 직후 크롭 대기 중인 원본 파일
  const [folderId, setFolderId] = useState<string>(defaultFolderId); // '' = 미선택(필수)
  const [title, setTitle] = useState('');
  // 제목을 사장님이 직접 고쳤는지. 고친 뒤에는 폴더를 바꿔도 자동제목으로 덮어쓰지 않는다.
  const [titleTouched, setTitleTouched] = useState(false);
  const [settings, setSettings] = useState<DesignSettings>(() => defaultBulkSettings());
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 등록 도중 일부 실패(옵션 등) 후 재시도할 때 디자인을 다시 만들지 않도록 보관.
  const createdIdRef = useRef<string | null>(null);
  // 이 폴더에 저장된 이전 공통설정(있으면 "불러오기" 배너 노출) — 반복 등록 편의.
  const [folderPreset, setFolderPreset] = useState<DesignSettings | null>(null);

  const uploading =
    thumbnail?.status === 'uploading' || details.some((p) => p.status === 'uploading');

  // 폴더를 고르면 그 폴더의 이전 설정이 있는지 확인한다.
  useEffect(() => {
    if (!folderId) {
      setFolderPreset(null);
      return;
    }
    setFolderPreset(loadBulkSettings(`snail_bulk_settings:${folderId}`, designers));
  }, [folderId, designers]);

  // 제목 자동생성: 선택한 폴더의 기존 디자인에서 다음 순번을 구해 "폴더명_001" 형식으로 채운다.
  // 폴더 안 일괄 업로드(BulkForm)와 동일한 규칙이라 순번이 폴더 기준으로 누적된다.
  const foldersQuery = useQuery({ queryKey: ['design-folders'], queryFn: () => designsApi.listFolders() });
  const selectedFolder = (foldersQuery.data ?? []).find((f) => f.id === folderId);
  const folderDesignsQuery = useQuery({
    queryKey: ['designs', 'folder', folderId || 'none', 'for-title'],
    queryFn: () =>
      collectAll<Design>((cursor) => designsApi.listDesigns({ folder_id: folderId, limit: 50, cursor })),
    enabled: !!folderId,
  });
  const autoTitle =
    selectedFolder && folderDesignsQuery.data
      ? `${selectedFolder.name}_${String(nextDesignNumber(selectedFolder.name, folderDesignsQuery.data)).padStart(3, '0')}`
      : '';

  // 사장님이 제목을 직접 고치기 전까지는 자동제목을 따라간다.
  useEffect(() => {
    if (!titleTouched) setTitle(autoTitle);
  }, [autoTitle, titleTouched]);

  // --- 사진 업로드 헬퍼 ---
  const startUpload = (file: File, onDone: (item: PhotoItem) => void) => {
    const id = crypto.randomUUID();
    const base: PhotoItem = {
      id,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
    };
    onDone(base);
    uploadsApi
      .uploadFile(file, 'design')
      .then((r) => updatePhoto(id, { status: 'done', objectKey: r.object_key }))
      .catch((e) => updatePhoto(id, { status: 'error', error: toUserMessage(e) }));
  };

  const updatePhoto = (id: string, patch: Partial<PhotoItem>) => {
    setThumbnail((t) => (t && t.id === id ? { ...t, ...patch } : t));
    setDetails((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  // 대표 사진은 바로 업로드하지 않고 먼저 크롭 스텝을 거친다(work order 20 · 등록 확장).
  const pickThumbnail = (file: File | undefined) => {
    if (!file) return;
    setCropFile(file);
  };
  const handleThumbnailCropped = (blob: Blob) => {
    if (!cropFile) return;
    const cropped = new File([blob], cropFile.name, { type: blob.type || cropFile.type });
    setCropFile(null);
    startUpload(cropped, (item) => setThumbnail(item));
  };
  const handleThumbnailCropSkip = () => {
    if (!cropFile) return;
    const original = cropFile;
    setCropFile(null);
    startUpload(original, (item) => setThumbnail(item));
  };
  const addDetails = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_DETAIL_PHOTOS - details.length;
    for (const file of Array.from(files).slice(0, room)) {
      startUpload(file, (item) => setDetails((list) => [...list, item].slice(0, MAX_DETAIL_PHOTOS)));
    }
  };
  const removeDetail = (id: string) => setDetails((list) => list.filter((it) => it.id !== id));

  // 제목은 비워두면 자동제목으로 등록된다(필수 아님).
  const effectiveTitle = title.trim() || autoTitle;

  const onSubmit = async () => {
    setFormError(null);
    if (!folderId) {
      setFormError('폴더를 선택하거나 새로 만들어주세요.');
      return;
    }
    if (!effectiveTitle) {
      setFormError('제목을 불러오는 중이에요. 잠시 후 다시 시도해주세요.');
      return;
    }
    if (!thumbnail || thumbnail.status !== 'done' || !thumbnail.objectKey) {
      setFormError('대표 스네일 사진 1장을 등록해주세요.');
      return;
    }
    const price = Number(settings.price);
    if (settings.price.trim() === '' || !Number.isFinite(price) || price < 0) {
      setFormError('가격을 입력해주세요.');
      return;
    }
    const multiDesigner = designers.length >= 2;
    let designerIds: string[];
    if (multiDesigner) {
      designerIds = Object.keys(settings.picked);
      if (designerIds.length === 0) {
        setFormError('이 디자인을 할 수 있는 디자이너를 1명 이상 선택해주세요.');
        return;
      }
    } else {
      if (designers.length === 0) {
        setFormError('먼저 디자이너 탭에서 디자이너를 등록해주세요.');
        return;
      }
      designerIds = [designers[0].id];
    }

    const detailKeys = details.filter((p) => p.status === 'done' && p.objectKey).map((p) => p.objectKey!);
    // 대표 사진이 image_upload_keys[0] → 썸네일로 사용된다.
    const imageKeys = [thumbnail.objectKey, ...detailKeys];

    // 기본값과 다른 디자이너만 오버라이드로 전송(다인샵 전용).
    const designerDurations = multiDesigner
      ? designerIds
          .filter((id) => settings.picked[id] !== settings.duration)
          .map((id) => ({ designer_id: id, duration_minutes: settings.picked[id] }))
      : [];
    const designerPrices = multiDesigner
      ? designerIds
          .filter((id) => (settings.pickedPrice[id] ?? price) !== price)
          .map((id) => ({ designer_id: id, base_price: settings.pickedPrice[id] ?? price }))
      : [];

    setSubmitting(true);
    try {
      // 이미 디자인 생성까지는 성공했던 재시도라면 새로 만들지 않고 같은 디자인에 이어서 진행.
      let designId = createdIdRef.current;
      if (!designId) {
        const created = await designsApi.createDesign({
          title: effectiveTitle,
          description: settings.description.trim() || null,
          base_price: price,
          intro_price: settings.introPrice.trim() ? Number(settings.introPrice) : null,
          duration_minutes: clampDuration(settings.duration),
          designer_ids: designerIds,
          designer_durations: designerDurations,
          designer_prices: designerPrices,
          folder_id: folderId || null,
          image_upload_keys: imageKeys,
          owner_tags: settings.tags,
        });
        designId = created.id;
        createdIdRef.current = designId;
      }
      // 옵션 생성: 이미 생성된 옵션(id 보유)은 갱신, 나머지만 생성 — 재시도 시 중복 생성 방지.
      for (let i = 0; i < settings.options.length; i += 1) {
        const r = settings.options[i];
        if (!r.name.trim()) continue;
        const body = toOptionBody(r, i);
        if (r.id) {
          await designsApi.updateOption(designId, r.id, body);
        } else {
          const created = await designsApi.createOption(designId, body);
          const optId = created.id;
          const uid = r.uid;
          setSettings((prev) => ({
            ...prev,
            options: prev.options.map((o) => (o.uid === uid ? { ...o, id: optId } : o)),
          }));
        }
      }
      try {
        // 이미지 자동 처리 트리거. 실패해도 등록 자체는 유지 — 카드의 "처리 재시도" 버튼으로 재시도 가능.
        await designsApi.processDesign(designId);
      } catch {
        /* 무시 */
      }
      if (folderId) saveBulkSettings(`snail_bulk_settings:${folderId}`, settings);
      onCreated();
    } catch (e) {
      setFormError(toUserMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {cropFile && (
        <ImageCropper
          file={cropFile}
          title="대표 사진 크롭"
          onCropped={handleThumbnailCropped}
          onSkip={handleThumbnailCropSkip}
          onCancel={() => setCropFile(null)}
        />
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-5 rounded-lg border border-neutral-200 bg-white p-5"
        noValidate
      >
        <h2 className="text-body-sm font-semibold text-primary">새 디자인 등록</h2>

      {/* 대표 사진 */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          <label className="text-body-sm font-medium">대표 스네일 사진</label>
          <span className="text-danger">*</span>
        </div>
        <p className="mb-2 text-caption text-primary-50">
          고객에게 <strong className="text-primary-50">썸네일</strong>로 노출되는 사진입니다. 1장 필수.
        </p>
        <div className="flex flex-wrap gap-2">
          {thumbnail ? (
            <PhotoTile photo={thumbnail} onRemove={() => setThumbnail(null)} badge="대표" />
          ) : (
            <UploadTile label="대표 사진" onFiles={(f) => pickThumbnail(f?.[0])} />
          )}
        </div>
      </div>

      {/* 상세 사진 */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          <label className="text-body-sm font-medium">상세 사진</label>
          <span className="text-caption text-primary-50">선택 · 최대 {MAX_DETAIL_PHOTOS}장</span>
        </div>
        <p className="mb-2 text-caption text-primary-50">손 후기 사진 등 자유롭게 추가할 수 있어요.</p>
        <div className="flex flex-wrap gap-2">
          {details.map((p) => (
            <PhotoTile key={p.id} photo={p} onRemove={() => removeDetail(p.id)} />
          ))}
          {details.length < MAX_DETAIL_PHOTOS && (
            <UploadTile label="추가" multiple onFiles={(f) => addDetails(f)} />
          )}
        </div>
      </div>

      {/* 제목 (관리용) */}
      <Field
        label="제목 (관리용)"
        hint="폴더를 고르면 자동으로 지어집니다. 직접 고쳐도 되고, 비우면 자동 제목으로 등록돼요. 사장님 관리용 이름이라 고객에게는 노출되지 않습니다."
      >
        <input
          className={inputCls}
          value={title}
          onChange={(e) => {
            setTitleTouched(true);
            setTitle(e.target.value);
          }}
          placeholder={autoTitle || '폴더를 먼저 선택하세요'}
        />
      </Field>

      {/* 폴더 */}
      <FolderField value={folderId} onChange={setFolderId} />
      {folderPreset && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-secondary/10 px-3 py-2 text-caption text-primary">
          <span className="flex-1">이 폴더에 저장된 이전 설정(가격·디자이너·태그·추가옵션)이 있어요.</span>
          <button
            type="button"
            onClick={() => {
              setSettings(folderPreset);
              setFolderPreset(null);
            }}
            className="rounded-md bg-secondary px-3 py-1.5 font-semibold text-white"
          >
            이전 설정 불러오기
          </button>
          <button
            type="button"
            onClick={() => setFolderPreset(null)}
            className="px-2 py-1 font-semibold text-primary-50"
          >
            닫기
          </button>
        </div>
      )}

      {designers.length === 0 && (
        <p className="text-caption text-primary-50">
          등록된 디자이너가 없습니다.{' '}
          <Link href="/dashboard/designers" className="text-secondary underline">
            디자이너
          </Link>{' '}
          탭에서 먼저 추가하세요.
        </p>
      )}

      {/* 가격·디자이너별 소요시간/가격·설명·태그·추가옵션 (더미·수정 폼과 동일) */}
      <DesignSettingsFields
        designers={designers}
        value={settings}
        onChange={(p) => setSettings((prev) => ({ ...prev, ...p }))}
      />

      {formError && <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">{formError}</p>}

      <button
        type="submit"
        disabled={submitting || uploading}
        className="rounded-md bg-secondary px-5 py-2 text-body-sm font-semibold text-white disabled:opacity-50"
      >
        {submitting ? '등록 중…' : uploading ? '사진 업로드 중…' : '디자인 등록'}
      </button>
      </form>
    </>
  );
}

/* ───────────── 사진 다듬기(구 디자인 정렬) ───────────── */

const REFINE_INSTAGRAM_URL =
  'https://www.instagram.com/s_nail_official?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==';

/**
 * "사진 다듬기" 폼. 새 디자인 등록(CreateForm)과 같은 UI/설정을 쓰되,
 *  - 다듬을 사진은 딱 1장,
 *  - 등록 대신 백엔드 정렬(sort-jobs.startJob)로 넘겨 배경/정렬을 자동 처리한다.
 * 폴더 지정 규칙은 새 디자인과 동일(FolderField: 바깥이면 직접 선택/생성, 안이면 자동지정).
 */
function RefineForm({
  designers,
  defaultFolderId = '',
  onStarted,
}: {
  designers: Designer[];
  defaultFolderId?: string;
  onStarted: (folder: { id: string; name: string }) => void;
}) {
  const startJob = useSortJobs((s) => s.startJob);
  const foldersQuery = useQuery({ queryKey: ['design-folders'], queryFn: () => designsApi.listFolders() });
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data]);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [settings, setSettings] = useState<DesignSettings>(() => defaultBulkSettings());
  const [folderPreset, setFolderPreset] = useState<DesignSettings | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 미리보기 objectURL 누수 방지.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // 폴더를 고르면 그 폴더의 이전 공통설정을 불러올 수 있게 한다(새 디자인과 동일).
  useEffect(() => {
    if (!folderId) {
      setFolderPreset(null);
      return;
    }
    setFolderPreset(loadBulkSettings(`snail_bulk_settings:${folderId}`, designers));
  }, [folderId, designers]);

  // 진행률 기준선(baseCount): 정렬 시작 시점 폴더의 실제 디자인 수.
  const folderDesignsQuery = useQuery({
    queryKey: ['designs', 'folder', folderId || 'none', 'for-refine'],
    queryFn: () =>
      collectAll<Design>((cursor) => designsApi.listDesigns({ folder_id: folderId, limit: 50, cursor })),
    enabled: !!folderId,
  });

  const pickFile = (list: FileList | null) => {
    const f = list?.[0];
    if (!f || !f.type.startsWith('image/')) return;
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    setFile(f);
    setFormError(null);
  };
  const clearFile = () => {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });
    setFile(null);
  };

  const onSubmit = () => {
    setFormError(null);
    if (!file) {
      setFormError('다듬을 사진 1장을 올려주세요.');
      return;
    }
    if (!folderId) {
      setFormError('결과가 담길 폴더를 선택하거나 새로 만들어주세요.');
      return;
    }
    const price = Number(settings.price);
    if (settings.price.trim() === '' || !Number.isFinite(price) || price < 0) {
      setFormError('가격을 입력해주세요.');
      return;
    }
    const multiDesigner = designers.length >= 2;
    if (multiDesigner) {
      if (Object.keys(settings.picked).length === 0) {
        setFormError('이 디자인을 할 수 있는 디자이너를 1명 이상 선택해주세요.');
        return;
      }
    } else if (designers.length === 0) {
      setFormError('먼저 디자이너 탭에서 디자이너를 등록해주세요.');
      return;
    }

    const folder = folders.find((f) => f.id === folderId);
    const baseCount = folderDesignsQuery.data?.length ?? folder?.design_count ?? 0;
    setSubmitting(true);
    // 원본 업로드→백엔드 정렬 요청은 스토어가 백그라운드로 처리(탭 이동해도 유지) — await 하지 않는다.
    void startJob({
      folderId,
      folderName: folder?.name ?? '폴더',
      files: [file],
      settings,
      designers,
      baseCount,
    });
    saveBulkSettings(`snail_bulk_settings:${folderId}`, settings);
    onStarted({ id: folderId, name: folder?.name ?? '폴더' });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-5 rounded-lg border border-neutral-200 bg-white p-5"
      noValidate
    >
      <h2 className="text-body-sm font-semibold text-primary">사진 다듬기</h2>

      {/* 다듬을 사진 (1장) */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          <label className="text-body-sm font-medium">다듬을 사진</label>
          <span className="text-danger">*</span>
          <span className="text-caption text-primary-50">1장</span>
        </div>
        <p className="mb-2 text-caption text-primary-50">
          네일 팁 사진 1장을 올리면 배경·정렬을 자동으로 다듬어 폴더에 넣어드려요.
        </p>
        <div className="flex flex-wrap gap-2">
          {file ? (
            <div className="relative h-24 w-24 overflow-hidden rounded-md border border-neutral-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt={file.name} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={clearFile}
                className="absolute right-0 top-0 bg-black/50 px-1 text-caption text-white"
                aria-label="삭제"
              >
                ×
              </button>
            </div>
          ) : (
            <UploadTile label="사진 올리기" onFiles={pickFile} />
          )}
        </div>
      </div>

      {/* 폴더 (새 디자인과 동일) */}
      <FolderField value={folderId} onChange={setFolderId} />
      {folderPreset && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-secondary/10 px-3 py-2 text-caption text-primary">
          <span className="flex-1">이 폴더에 저장된 이전 설정(가격·디자이너·태그·추가옵션)이 있어요.</span>
          <button
            type="button"
            onClick={() => {
              setSettings(folderPreset);
              setFolderPreset(null);
            }}
            className="rounded-md bg-secondary px-3 py-1.5 font-semibold text-white"
          >
            이전 설정 불러오기
          </button>
          <button
            type="button"
            onClick={() => setFolderPreset(null)}
            className="px-2 py-1 font-semibold text-primary-50"
          >
            닫기
          </button>
        </div>
      )}

      {designers.length === 0 && (
        <p className="text-caption text-primary-50">
          등록된 디자이너가 없습니다.{' '}
          <Link href="/dashboard/designers" className="text-secondary underline">
            디자이너
          </Link>{' '}
          탭에서 먼저 추가하세요.
        </p>
      )}

      {/* 가격·디자이너별 소요시간/가격·설명·태그·추가옵션 (새 디자인과 동일) */}
      <DesignSettingsFields
        designers={designers}
        value={settings}
        onChange={(p) => setSettings((prev) => ({ ...prev, ...p }))}
      />

      {/* 베타 안내 + 문의 */}
      <RefineGuide />

      {formError && <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">{formError}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-secondary px-5 py-2 text-body-sm font-semibold text-white disabled:opacity-50"
      >
        {submitting ? '다듬는 중…' : '다듬기'}
      </button>
    </form>
  );
}

/** 사진 다듬기 베타 안내 문구 + 인스타 문의. */
function RefineGuide() {
  return (
    <div className="space-y-3 rounded-lg bg-neutral-50 px-4 py-3">
      <ul className="space-y-1.5 text-caption text-primary-50">
        <li>
          • 현재 베타 기간이라 이미지 정확도를 올리고 있어요. 이미지가 잘 나오지 않았을 경우, 원본과 결과물을 첨부해
          DM으로 피드백해 주시면 운영자가 직접 가공해서 전해드려요.
        </li>
        <li>• 원본 이미지의 팁이 가지런하고 간격이 조금 있으며, 조명이 밝고 해상도가 높을수록 정확도가 올라가요.</li>
        <li>• 네일 쉐입이 달라지거나 이미지가 깨지는 등 오류가 생길 수 있어요. 재시도할 수 있어요.</li>
        <li>• 투명한 팁은 잘 표현되지 않을 수 있어요.</li>
      </ul>
      <div className="flex items-center gap-2 border-t border-neutral-200 pt-2">
        <span className="text-caption font-semibold text-primary">문의</span>
        <a
          href={REFINE_INSTAGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-secondary px-3 py-1 text-caption font-semibold text-secondary hover:bg-secondary/5"
        >
          <InstagramIcon />
          @s_nail_official
        </a>
      </div>
    </div>
  );
}

/** 인스타그램 글리프(외부 리소스 없이 인라인 SVG). */
function InstagramIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* ───────────── 폴더 선택/만들기 ───────────── */

function FolderField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [featuredMonth, setFeaturedMonth] = useState('');
  const [error, setError] = useState<string | null>(null);

  const foldersQuery = useQuery({
    queryKey: ['design-folders'],
    queryFn: () => designsApi.listFolders(),
  });
  const folders: DesignFolder[] = foldersQuery.data ?? [];

  const create = useMutation({
    mutationFn: (body: { name: string; featured_month: string | null }) =>
      designsApi.createFolder(body),
    onSuccess: (folder) => {
      setError(null);
      setName('');
      setFeaturedMonth('');
      setCreating(false);
      qc.invalidateQueries({ queryKey: ['design-folders'] });
      onChange(folder.id);
    },
    onError: (e) => setError(toUserMessage(e)),
  });

  return (
    <div>
      <label className="mb-1 block text-body-sm font-medium">
        폴더 <span className="text-danger">*</span>
      </label>
      {creating ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 7월 이달의 아트"
              maxLength={60}
              className={inputCls}
            />
            <button
              type="button"
              onClick={() =>
                name.trim() &&
                create.mutate({ name: name.trim(), featured_month: featuredMonth || null })
              }
              disabled={create.isPending || !name.trim()}
              className="shrink-0 rounded-md border border-secondary px-3 py-2 text-body-sm font-semibold text-secondary disabled:opacity-50"
            >
              만들기
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setName('');
                setFeaturedMonth('');
                setError(null);
              }}
              className="shrink-0 rounded-md border border-neutral-300 px-3 py-2 text-body-sm text-primary-50"
            >
              취소
            </button>
          </div>
          <label className="flex items-center gap-2 text-caption text-primary-50">
            <span className="shrink-0">이달의 아트 진행월</span>
            <input
              type="month"
              value={featuredMonth}
              onChange={(e) => setFeaturedMonth(e.target.value)}
              className={`${inputCls} max-w-[12rem]`}
            />
            <span className="shrink-0">비우면 일반 폴더</span>
          </label>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputCls} bg-white`}
          >
            <option value="">폴더를 선택하세요</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.featured_month ? ` · 이달의 아트 ${f.featured_month}` : ''} ({f.design_count})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="shrink-0 rounded-md border border-neutral-300 px-3 py-2 text-body-sm text-primary"
          >
            + 새 폴더
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-caption text-danger">{error}</p>}
    </div>
  );
}


/* ───────────── 사진 타일 ───────────── */

function PhotoTile({ photo: p, onRemove, badge }: { photo: PhotoItem; onRemove: () => void; badge?: string }) {
  return (
    <div className="relative h-24 w-24 overflow-hidden rounded-md border border-neutral-200">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.previewUrl} alt={p.name} className="h-full w-full object-cover" />
      {badge && (
        <span className="absolute left-0 top-0 bg-secondary px-1.5 py-0.5 text-caption font-semibold text-white">
          {badge}
        </span>
      )}
      {p.status === 'uploading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-caption text-white">
          업로드 중…
        </div>
      )}
      {p.status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-600/70 px-1 text-center text-caption text-white">
          {p.error ?? '실패'}
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-0 top-0 bg-black/50 px-1 text-caption text-white"
        aria-label="삭제"
      >
        ×
      </button>
    </div>
  );
}

function UploadTile({
  label,
  multiple,
  onFiles,
}: {
  label: string;
  multiple?: boolean;
  onFiles: (files: FileList | null) => void;
}) {
  return (
    <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-neutral-300 text-primary-50 hover:border-secondary">
      <span className="text-2xl leading-none">+</span>
      <span className="mt-1 text-caption">{label}</span>
      <input
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/* ───────────── 사진 확대 뷰(라이트박스) ───────────── */

/** 디자인의 모든 사진 URL을 대표 사진이 맨 앞에 오도록 정렬해 반환한다. */
function designImageUrls(d: Design): string[] {
  const imgs = d.images ?? [];
  if (imgs.length > 0) {
    return [...imgs]
      .sort((a, b) => Number(b.is_thumbnail) - Number(a.is_thumbnail))
      .map((i) => i.original_url);
  }
  return d.thumbnail_url ? [d.thumbnail_url] : [];
}

/** 전체화면 사진 확대 뷰. 배경 클릭·ESC로 닫고, 좌우 버튼/화살표키로 넘긴다. */
function Lightbox({
  urls,
  index,
  onIndex,
  onClose,
}: {
  urls: string[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (index == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onIndex((index - 1 + urls.length) % urls.length);
      else if (e.key === 'ArrowRight') onIndex((index + 1) % urls.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, urls.length, onIndex, onClose]);

  if (index == null || !urls[index]) return null;
  const many = urls.length > 1;
  const btnCls =
    'absolute grid h-11 w-11 place-items-center rounded-full bg-white/15 text-heading-md text-white hover:bg-white/25';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button type="button" onClick={onClose} aria-label="닫기" className={`${btnCls} right-4 top-4`}>
        ×
      </button>
      {many && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndex((index - 1 + urls.length) % urls.length);
          }}
          aria-label="이전 사진"
          className={`${btnCls} left-3`}
        >
          ‹
        </button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={urls[index]}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] max-w-[92vw] rounded-lg object-contain"
      />
      {many && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onIndex((index + 1) % urls.length);
          }}
          aria-label="다음 사진"
          className={`${btnCls} right-3`}
        >
          ›
        </button>
      )}
      {many && (
        <div className="absolute bottom-5 rounded-full bg-black/50 px-3 py-1 text-caption text-white">
          {index + 1} / {urls.length}
        </div>
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
      // 신규 이미지 처리 상태도 진행 중이면 폴링(공개와 무관, 결과 검수용).
      const ip = q.state.data?.image_processing_status;
      const active =
        s === 'pending' || s === 'in_progress' || ip === 'pending' || ip === 'in_progress';
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

  // 이미지 자동 처리 재시도(크롭 원본 → 워커 처리). 상태는 image_processing_status로 폴링된다.
  const reprocess = useMutation({
    mutationFn: () => designsApi.processDesign(d.id),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e) => setActionError(toUserMessage(e)),
  });

  const imageStatus = d.image_processing_status;
  const processedUrls = (d.images ?? [])
    .filter((i) => i.processed_url)
    .map((i) => i.processed_url as string);

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
          {(imageStatus === 'pending' || imageStatus === 'in_progress') && (
            <span className="text-caption text-primary-50">· 이미지 처리 완료 후 공개를 권장해요</span>
          )}
        </div>
      )}

      {/* 이미지 자동 처리(크롭 원본 → 배경 제거/보정 등) 상태 + 결과 검수. 공개(노출)와는 무관.
          image_processing_status: idle | pending | in_progress | done | failed. */}
      {!editing && imageStatus && imageStatus !== 'idle' && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption text-primary-50">🖼 이미지 처리</span>
            {imageStatus === 'done' ? (
              <span className="rounded-full bg-success-bg px-2 py-0.5 text-caption font-semibold text-success">
                완료
              </span>
            ) : imageStatus === 'failed' ? (
              <span className="rounded-full bg-danger-bg px-2 py-0.5 text-caption font-semibold text-danger">
                실패
              </span>
            ) : (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-semibold text-primary-50">
                {imageStatus === 'pending' ? '대기 중' : '처리 중…'}
              </span>
            )}
            {(imageStatus === 'failed' || imageStatus === 'done') && (
              <button
                onClick={() => reprocess.mutate()}
                disabled={reprocess.isPending}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary hover:bg-neutral-50 disabled:opacity-50"
              >
                {reprocess.isPending ? '요청 중…' : imageStatus === 'failed' ? '처리 재시도' : '다시 처리'}
              </button>
            )}
          </div>
          {imageStatus === 'failed' && (
            <p className="mt-2 rounded-md bg-danger-bg p-2 text-caption text-danger">
              {d.image_processing_error ?? '이미지 처리에 실패했습니다.'}
            </p>
          )}
          {imageStatus === 'done' && processedUrls.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-caption text-primary-50">처리 결과(검수) — 공개 전 확인하세요</p>
              <div className="flex flex-wrap gap-2">
                {processedUrls.map((u, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`p-${i}`}
                    src={u}
                    alt="처리 결과"
                    className="h-16 w-16 rounded-md border border-neutral-200 object-cover"
                  />
                ))}
              </div>
            </div>
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


/** 이미지 URL에서 업로드 object_key를 역추출(버킷명 무관). 기존 사진 보존용. */
function urlToObjectKey(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/[^/]+\//, '');
  } catch {
    return url;
  }
}


/* ───────────── 일괄 등록 (드롭존 + 공통설정 모달) ───────────── */

/** 폴더 안에서 여러 사진을 한번에 올리는 드롭존. */
function BulkDropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [drag, setDrag] = useState(false);
  const pick = (list: FileList | null) => {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (imgs.length) onFiles(imgs);
  };
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        pick(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-6 text-center transition ${
        drag ? 'border-secondary bg-secondary/5' : 'border-neutral-300 hover:border-secondary'
      }`}
    >
      <span className="text-2xl">🖼️</span>
      <span className="text-body-sm font-semibold text-primary">사진 여러 장 한번에 올리기</span>
      <span className="text-caption text-primary-50">
        컴퓨터에서 끌어다 놓거나, 눌러서 갤러리에서 여러 장 선택하세요. 각 사진이 대표사진인 디자인이 만들어져요.
      </span>
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/** 일괄 등록 모달: 공통설정 입력 → 사진마다 디자인 1개씩 생성(제목 자동번호). */
function BulkAddModal({
  folderId,
  folderName,
  files,
  startNumber,
  designers,
  onClose,
  onCreated,
}: {
  folderId: string;
  folderName: string;
  files: File[];
  startNumber: number;
  designers: Designer[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const multiDesigner = designers.length >= 2;
  const storageKey = `snail_bulk_settings:${folderId}`;

  const savedRef = useRef<DesignSettings | null | undefined>(undefined);
  if (savedRef.current === undefined) savedRef.current = loadBulkSettings(storageKey, designers);
  const hasSaved = !!savedRef.current;

  const [step, setStep] = useState<'confirm' | 'form'>(hasSaved ? 'confirm' : 'form');
  const [settings, setSettings] = useState<DesignSettings>(() => savedRef.current ?? defaultBulkSettings());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const pad = (n: number) => String(n).padStart(3, '0');
  const titlePreview =
    files.length === 1
      ? `${folderName}_${pad(startNumber)}`
      : `${folderName}_${pad(startNumber)} ~ ${folderName}_${pad(startNumber + files.length - 1)}`;

  const runCreate = async (s: DesignSettings) => {
    setErr(null);
    const price = Number(s.price);
    if (!Number.isFinite(price) || price < 0 || s.price.trim() === '') {
      setErr('가격을 입력해주세요.');
      setStep('form');
      return;
    }
    let designerIds: string[];
    if (multiDesigner) {
      designerIds = Object.keys(s.picked);
      if (designerIds.length === 0) {
        setErr('디자이너를 1명 이상 선택해주세요.');
        setStep('form');
        return;
      }
    } else {
      if (designers.length === 0) {
        setErr('먼저 디자이너 탭에서 디자이너를 등록해주세요.');
        setStep('form');
        return;
      }
      designerIds = [designers[0].id];
    }
    const designerDurations = multiDesigner
      ? designerIds
          .filter((id) => s.picked[id] !== s.duration)
          .map((id) => ({ designer_id: id, duration_minutes: s.picked[id] }))
      : [];
    // 기본가격과 다른 디자이너만 오버라이드로 전송(다인샵 전용).
    const designerPrices = multiDesigner
      ? designerIds
          .filter((id) => (s.pickedPrice[id] ?? price) !== price)
          .map((id) => ({ designer_id: id, base_price: s.pickedPrice[id] ?? price }))
      : [];

    saveBulkSettings(storageKey, s);

    setProgress({ done: 0, total: files.length });
    const failed: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const title = `${folderName}_${pad(startNumber + i)}`;
      try {
        const up = await uploadsApi.uploadFile(files[i], 'design');
        const created = await designsApi.createDesign({
          title,
          description: s.description.trim() || null,
          base_price: price,
          intro_price: s.introPrice.trim() ? Number(s.introPrice) : null,
          duration_minutes: clampDuration(s.duration),
          designer_ids: designerIds,
          designer_durations: designerDurations,
          designer_prices: designerPrices,
          folder_id: folderId,
          image_upload_keys: [up.object_key],
          owner_tags: s.tags,
        });
        await createOptionsFor(created.id, s.options);
        try {
          // 이미지 자동 처리 트리거. 실패해도 등록 자체는 유지 — 카드의 "처리 재시도" 버튼으로 재시도 가능.
          await designsApi.processDesign(created.id);
        } catch {
          /* 무시 */
        }
      } catch (e) {
        failed.push(`${title}: ${toUserMessage(e)}`);
      }
      setProgress({ done: i + 1, total: files.length });
    }

    onCreated(); // 성공분 즉시 반영
    if (failed.length === 0) {
      onClose();
    } else {
      setFailures(failed);
      setProgress(null);
    }
  };

  const running = progress !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={running ? undefined : onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-heading-md font-bold">여러 디자인 한번에 등록</h2>
        <p className="mt-1 text-body-sm text-primary-50">
          사진 <strong className="text-primary">{files.length}장</strong> → 「{folderName}」 폴더에 디자인 {files.length}개
          <br />
          제목: <span className="font-semibold text-primary">{titlePreview}</span> (자동)
        </p>

        {/* 등록 진행 중 */}
        {running ? (
          <div className="mt-5">
            <p className="text-body-sm font-semibold text-primary">
              등록 중… {progress!.done}/{progress!.total}
            </p>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
              <div
                className="h-full bg-secondary transition-all"
                style={{ width: `${(progress!.done / progress!.total) * 100}%` }}
              />
            </div>
          </div>
        ) : failures.length > 0 ? (
          /* 일부 실패 결과 */
          <div className="mt-5 space-y-3">
            <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">
              {files.length - failures.length}개 등록 완료, {failures.length}개 실패:
            </p>
            <ul className="max-h-40 space-y-1 overflow-y-auto text-caption text-danger">
              {failures.map((f, i) => (
                <li key={i}>• {f}</li>
              ))}
            </ul>
            <button
              onClick={onClose}
              className="w-full rounded-md bg-secondary py-2.5 text-body-sm font-semibold text-white"
            >
              닫기
            </button>
          </div>
        ) : step === 'confirm' ? (
          /* 이전 공통설정 유지? */
          <div className="mt-5 space-y-3">
            <p className="rounded-md bg-secondary/10 px-3 py-2 text-body-sm text-primary">
              이전에 저장한 공통설정(가격·디자이너·태그 등)을 그대로 쓸까요?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => runCreate(savedRef.current!)}
                className="flex-1 rounded-md bg-secondary py-2.5 text-body-sm font-semibold text-white"
              >
                예, 바로 등록
              </button>
              <button
                onClick={() => setStep('form')}
                className="flex-1 rounded-md border border-neutral-300 py-2.5 text-body-sm font-semibold text-primary"
              >
                아니요, 설정 바꾸기
              </button>
            </div>
            <button onClick={onClose} className="w-full py-1 text-caption text-primary-50">
              취소
            </button>
          </div>
        ) : (
          /* 공통설정 입력 폼 (개별 수정 팝업과 동일한 필드) */
          <div className="mt-5 space-y-3">
            <p className="rounded-md bg-secondary/10 px-3 py-2 text-caption text-primary">
              여기서 정한 값은 이번에 올리는 모든 디자인에 공통 적용돼요. 등록 후 디자인을 하나씩 눌러 개별로 수정할 수 있어요.
            </p>
            <DesignSettingsFields
              designers={designers}
              value={settings}
              onChange={(p) => setSettings((prev) => ({ ...prev, ...p }))}
            />
            {err && <p className="text-caption text-danger">{err}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => runCreate(settings)}
                className="flex-1 rounded-md bg-secondary py-2.5 text-body-sm font-semibold text-white"
              >
                {files.length}개 등록
              </button>
              <button
                onClick={onClose}
                className="rounded-md border border-neutral-300 px-4 py-2.5 text-body-sm font-semibold text-primary"
              >
                취소
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── 디자인 수정 폼 ───────────── */

function DesignEditForm({ design: d, onClose }: { design: Design; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(d.title);
  const [description, setDescription] = useState(d.description ?? '');
  const [price, setPrice] = useState(String(d.base_price));
  const [introPrice, setIntroPrice] = useState(d.intro_price != null ? String(d.intro_price) : '');
  const [duration, setDuration] = useState(clampDuration(d.duration_minutes));
  const [tags, setTags] = useState<string[]>(d.owner_tags ?? []);
  const [err, setErr] = useState<string | null>(null);

  const designersQuery = useQuery({ queryKey: ['designers'], queryFn: () => designersApi.listDesigners() });
  const designers = designersQuery.data ?? [];
  const multiDesigner = designers.length >= 2;

  // designerId → 소요시간(분). 현재 이 디자인을 담당하는 디자이너로 초기화한다(다인샵 전용).
  const [picked, setPicked] = useState<Record<string, number>>(() =>
    Object.fromEntries((d.designers ?? []).map((dz) => [dz.id, clampDuration(dz.duration_minutes)])),
  );
  // designerId → 가격(원). 현재 담당 디자이너의 가격으로 초기화한다(다인샵 전용).
  const [pickedPrice, setPickedPrice] = useState<Record<string, number>>(() =>
    Object.fromEntries((d.designers ?? []).map((dz) => [dz.id, dz.base_price])),
  );

  // 추가옵션: 기존 옵션으로 초기화하고, 저장 시 원본과 비교해 추가/변경/삭제한다.
  const originalOptionsRef = useRef(d.options ?? []);
  const [options, setOptions] = useState<OptionRow[]>(() =>
    (d.options ?? []).map((o) => ({
      uid: crypto.randomUUID(),
      id: o.id,
      kind: (OPTION_KINDS.some((k) => k.value === o.kind) ? o.kind : 'extend') as OptionKind,
      name: o.name,
      priceDelta: o.price_delta,
      durationDelta: o.duration_delta_min ?? 0,
    })),
  );

  // 사진 편집: 기존 사진(URL→key 역추출) + 새 업로드를 통합 관리. index 0 = 대표사진.
  const [photos, setPhotos] = useState<EditPhoto[]>(() => {
    const imgs = [...(d.images ?? [])].sort((a, b) => Number(b.is_thumbnail) - Number(a.is_thumbnail));
    if (imgs.length > 0) {
      return imgs.map((i) => ({
        uid: i.id,
        key: urlToObjectKey(i.original_url),
        previewUrl: i.original_url,
        status: 'done' as const,
      }));
    }
    return d.thumbnail_url
      ? [{ uid: 'thumb', key: urlToObjectKey(d.thumbnail_url), previewUrl: d.thumbnail_url, status: 'done' as const }]
      : [];
  });
  const [photosDirty, setPhotosDirty] = useState(false);
  const photoUploading = photos.some((p) => p.status === 'uploading');

  const addPhotos = (list: FileList | null) => {
    if (!list) return;
    const room = MAX_EDIT_PHOTOS - photos.length;
    const files = Array.from(list)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, room);
    for (const file of files) {
      const uid = crypto.randomUUID();
      setPhotos((prev) => [...prev, { uid, key: '', previewUrl: URL.createObjectURL(file), status: 'uploading' }]);
      setPhotosDirty(true);
      uploadsApi
        .uploadFile(file, 'design')
        .then((r) =>
          setPhotos((prev) => prev.map((p) => (p.uid === uid ? { ...p, key: r.object_key, status: 'done' } : p))),
        )
        .catch((e) =>
          setPhotos((prev) =>
            prev.map((p) => (p.uid === uid ? { ...p, status: 'error', error: toUserMessage(e) } : p)),
          ),
        );
    }
  };
  const removePhoto = (uid: string) => {
    setPhotos((prev) => prev.filter((p) => p.uid !== uid));
    setPhotosDirty(true);
  };
  const makeThumbnail = (uid: string) => {
    setPhotos((prev) => {
      const t = prev.find((p) => p.uid === uid);
      if (!t) return prev;
      return [t, ...prev.filter((p) => p.uid !== uid)];
    });
    setPhotosDirty(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const designerIds = Object.keys(picked);
      const basePriceNum = Number(price) || 0;
      // 기본값과 다른 디자이너만 오버라이드로 전송(나머지는 기본값 사용) — 등록 폼과 동일한 규칙.
      const designerDurations = designerIds
        .filter((id) => picked[id] !== duration)
        .map((id) => ({ designer_id: id, duration_minutes: picked[id] }));
      const designerPrices = designerIds
        .filter((id) => (pickedPrice[id] ?? basePriceNum) !== basePriceNum)
        .map((id) => ({ designer_id: id, base_price: pickedPrice[id] ?? basePriceNum }));

      await designsApi.updateDesign(d.id, {
        title: title.trim(),
        description: description.trim() || null,
        base_price: basePriceNum,
        intro_price: introPrice.trim() ? Number(introPrice) : null,
        duration_minutes: clampDuration(duration),
        owner_tags: tags,
        // 사진을 바꿨을 때만 전체 세트를 전송(백엔드는 image_upload_keys를 통째로 교체).
        ...(photosDirty
          ? { image_upload_keys: photos.filter((p) => p.status === 'done').map((p) => p.key) }
          : {}),
        ...(multiDesigner
          ? { designer_ids: designerIds, designer_durations: designerDurations, designer_prices: designerPrices }
          : {}),
      });

      // 추가옵션 동기화: 삭제된 것 제거 → 이름 있는 줄은 추가/변경.
      const orig = originalOptionsRef.current;
      const keptIds = new Set(options.filter((o) => o.id).map((o) => o.id));
      for (const o of orig) {
        if (o.id && !keptIds.has(o.id)) await designsApi.deleteOption(d.id, o.id);
      }
      for (let i = 0; i < options.length; i += 1) {
        const r = options[i];
        const body = toOptionBody(r, i);
        if (r.id) {
          if (!r.name.trim()) {
            await designsApi.deleteOption(d.id, r.id); // 이름을 비우면 삭제
            continue;
          }
          const before = orig.find((o) => o.id === r.id);
          if (
            !before ||
            before.kind !== body.kind ||
            before.name !== body.name ||
            before.price_delta !== body.price_delta ||
            before.duration_delta_min !== body.duration_delta_min ||
            before.sort_order !== i
          ) {
            await designsApi.updateOption(d.id, r.id, body);
          }
        } else if (r.name.trim()) {
          const created = await designsApi.createOption(d.id, body);
          const optId = created.id;
          const uid = r.uid;
          // 생성된 옵션의 id를 로컬 상태에 반영 — 저장 재시도 시 create가 아닌 update 경로로 가도록(중복 생성 방지).
          setOptions((prev) => prev.map((o) => (o.uid === uid ? { ...o, id: optId } : o)));
        }
      }

      // 사진을 바꿨을 때만 이미지 자동 처리 트리거(새 대표/상세 사진 크롭 원본 처리). 실패해도 수정 자체는 유지
      // — 카드의 "처리 재시도" 버튼으로 재시도 가능.
      if (photosDirty) {
        try {
          await designsApi.processDesign(d.id);
        } catch {
          /* 무시 */
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
      onClose();
    },
    onError: (e) => setErr(toUserMessage(e)),
  });

  const attemptSave = () => {
    if (multiDesigner && Object.keys(picked).length === 0) {
      setErr('이 디자인을 할 수 있는 디자이너를 1명 이상 선택해주세요.');
      return;
    }
    if (photoUploading) {
      setErr('사진 업로드가 끝날 때까지 기다려주세요.');
      return;
    }
    if (photosDirty && photos.filter((p) => p.status === 'done').length === 0) {
      setErr('사진을 최소 1장 남겨주세요.');
      return;
    }
    setErr(null);
    save.mutate();
  };

  const inputCls =
    'w-full rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary';
  const labelCls = 'mb-1 block text-caption font-semibold text-primary-50';

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-secondary/30 bg-secondary/5 p-3">
      <div>
        <label className={labelCls}>제목 (관리용 · 고객 미노출)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
      </div>

      {/* 사진 편집 — 대표(첫 번째) + 상세. 삭제·추가·대표지정 가능 */}
      <div>
        <label className={labelCls}>
          사진 <span className="text-caption text-primary-50">첫 번째가 대표사진</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {photos.map((p, idx) => (
            <div key={p.uid} className="relative h-24 w-24 overflow-hidden rounded-md border border-neutral-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
              {idx === 0 && (
                <span className="absolute left-0 top-0 bg-secondary px-1.5 py-0.5 text-caption font-semibold text-white">
                  대표
                </span>
              )}
              {p.status === 'uploading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-caption text-white">
                  업로드 중…
                </div>
              )}
              {p.status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-600/70 px-1 text-center text-caption text-white">
                  {p.error ?? '실패'}
                </div>
              )}
              <button
                type="button"
                onClick={() => removePhoto(p.uid)}
                className="absolute right-0 top-0 bg-black/50 px-1 text-caption text-white"
                aria-label="사진 삭제"
              >
                ×
              </button>
              {idx !== 0 && p.status === 'done' && (
                <button
                  type="button"
                  onClick={() => makeThumbnail(p.uid)}
                  className="absolute inset-x-0 bottom-0 bg-black/50 py-0.5 text-center text-caption text-white hover:bg-black/70"
                >
                  대표로
                </button>
              )}
            </div>
          ))}
          {photos.length < MAX_EDIT_PHOTOS && (
            <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-neutral-300 text-primary-50 hover:border-secondary">
              <span className="text-2xl leading-none">+</span>
              <span className="mt-1 text-caption">사진 추가</span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      </div>

      {/* 가격·디자이너·소요시간·설명·태그 (등록/일괄과 동일한 필드) */}
      <DesignSettingsFields
        designers={designers}
        value={{ price, introPrice, duration, description, tags, picked, pickedPrice, options }}
        onChange={(p) => {
          if (p.price !== undefined) setPrice(p.price);
          if (p.introPrice !== undefined) setIntroPrice(p.introPrice);
          if (p.duration !== undefined) setDuration(p.duration);
          if (p.description !== undefined) setDescription(p.description);
          if (p.tags !== undefined) setTags(p.tags);
          if (p.picked !== undefined) setPicked(p.picked);
          if (p.pickedPrice !== undefined) setPickedPrice(p.pickedPrice);
          if (p.options !== undefined) setOptions(p.options);
        }}
      />

      {err && <p className="text-caption text-danger">{err}</p>}

      <div className="flex gap-2">
        <button
          disabled={
            !title.trim() ||
            save.isPending ||
            photoUploading ||
            (multiDesigner && Object.keys(picked).length === 0)
          }
          onClick={attemptSave}
          className="rounded-md bg-secondary px-4 py-2 text-caption font-semibold text-white disabled:opacity-50"
        >
          {save.isPending ? '저장 중…' : '저장'}
        </button>
        <button
          onClick={onClose}
          className="rounded-md bg-neutral-100 px-4 py-2 text-caption font-semibold text-primary"
        >
          취소
        </button>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary';

function Field({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-body-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-caption text-primary-50">{hint}</p>}
      {error && <p className="mt-1 text-caption text-danger">{error}</p>}
    </div>
  );
}
