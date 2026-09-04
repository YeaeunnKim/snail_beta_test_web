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
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designersApi, designsApi, uploadsApi } from '@/services';
import type { Design, Designer, DesignFolder } from '@/services';
import { collectAll } from '@/lib/api-client';
import { toUserMessage } from '@/lib/error-messages';
import { useMyShop } from '@/hooks/use-my-shop';
import { useLockBodyScroll } from '@/hooks/use-lock-body-scroll';
// 설정 입력 관련 상수·타입·헬퍼·컴포넌트는 ./design-settings 로 추출해
// 새 디자인/대량 등록/수정 화면이 ★완전히 동일하게★ 재사용한다.
import {
  DURATION_MAX,
  DURATION_MIN,
  DURATION_STEP,
  OPTION_DURATION_DEFAULT,
  OPTION_DURATION_STEP,
  OPTION_KINDS,
  OPTION_PRICE_DEFAULT,
  PRICE_INPUT_STEP,
  PRICE_STEP,
  Stepper,
  TagInput,
  clampDuration,
  clampOptionDuration,
  defaultBulkSettings,
  loadBulkSettings,
  saveBulkSettings,
  nextDesignNumber,
  DesignSettingsFields,
} from './design-settings';
import type { OptionKind, DesignSettings } from './design-settings';
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

const MAX_EDIT_PHOTOS = 6; // 대표 1 + 상세 5 (등록·수정 공통)
// 백엔드가 디자인 1개당 옵션 최대 개수를 20개로 제한한다(제거+연장+케어 합산).
// 옵션 관리는 이 목록을 디자인마다 그대로 생성하므로, 넘기면 일부 디자인만 적용되는
// 드리프트가 생길 수 있어 클라이언트에서도 미리 막는다.
const MAX_DESIGN_OPTIONS = 20;
const formatWon = (n: number) => `${n.toLocaleString('ko-KR')}원`;

type FolderView = { label: string; folderId?: string; unfiled?: boolean };

/** 문자 하나의 정렬 그룹 — 숫자(123) < 한글(ㄱㄴㄷ) < 영문(abc) < 그 외, 오름차순 그룹 순서. */
function scriptGroup(ch: string | undefined): number {
  const code = ch?.codePointAt(0) ?? 0;
  if (/[0-9]/.test(ch ?? '')) return 0;
  if ((code >= 0xac00 && code <= 0xd7a3) || (code >= 0x3131 && code <= 0x318e)) return 1; // 한글 음절/자모
  if (/[A-Za-z]/.test(ch ?? '')) return 2;
  return 3;
}

/**
 * 사진 파일명 앞부분의 "{번호}_{가격(천원)}" 패턴을 해석한다 — 없으면 null.
 * 예: "01_75.jpg" → { number: '01'(파일명 그대로, 자리수 안 맞춤), price: 75000 }.
 * 번호_가격 형태가 아닌 파일(상세사진, 일반 파일명 등)은 그냥 null을 반환해서
 * 호출부가 기존 자동번호·공통가격 방식으로 폴백하게 한다.
 */
function parseFilenamePriceInfo(filename: string): { number: string; price: number } | null {
  const base = filename.replace(/\.[^./\\]+$/, '');
  const m = base.match(/^(\d+)_(\d+)/);
  if (!m) return null;
  const price = parseInt(m[2], 10) * 1000;
  if (!Number.isFinite(price)) return null;
  return { number: m[1], price };
}

/** "이름순" 정렬 비교자 — 123 → ㄱㄴㄷ → abc 순서로 오름차순 정렬한다. */
function compareTitleAsc(a: string, b: string): number {
  const ga = scriptGroup(a[0]);
  const gb = scriptGroup(b[0]);
  return ga !== gb ? ga - gb : a.localeCompare(b, 'ko');
}

export default function DesignsPage() {
  const qc = useQueryClient();
  const [showBulkOptions, setShowBulkOptions] = useState(false); // "옵션 일괄 적용" 인라인 패널
  const [open, setOpen] = useState<FolderView | null>(null); // null = 폴더 목록
  // 추가순(기본) = 등록 순서 내림차순(가장 최근에 만든 게 위). 이름순 = 123→ㄱㄴㄷ→abc 순으로 오름차순.
  const [folderSortMode, setFolderSortMode] = useState<'name' | 'created'>('created');
  const [folderSelectedIds, setFolderSelectedIds] = useState<Set<string>>(new Set()); // 폴더 일괄 수정용 선택

  // 하단 탭바에서 "디자인"을 다시 누르면(이미 이 화면에 있어도) 폴더 목록 첫 화면으로 되돌린다.
  useEffect(() => {
    const reset = () => {
      setOpen(null);
      setShowBulkOptions(false);
      setFolderSelectedIds(new Set());
    };
    window.addEventListener('snail:designs-tab-reset', reset);
    return () => window.removeEventListener('snail:designs-tab-reset', reset);
  }, []);

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

  const folders = useMemo(() => {
    const list = [...(foldersQuery.data ?? [])];
    if (folderSortMode === 'name') {
      list.sort((a, b) => compareTitleAsc(a.name, b.name));
    } else {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  }, [foldersQuery.data, folderSortMode]);
  const unfiledCount = unfiledQuery.data?.length ?? 0;

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
    qc.invalidateQueries({ queryKey: ['design'] });
    qc.invalidateQueries({ queryKey: ['design-folders'] });
  };

  return (
    <div className="space-y-6">
      {open ? (
        <FolderDesigns
          view={open}
          onBack={() => setOpen(null)}
          designers={designers.data ?? []}
          onCreated={refetchAll}
        />
      ) : (
        <>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-heading-lg font-bold">디자인</h1>
              <p className="mt-1 text-body-sm text-primary-50">폴더로 정리하고, 폴더를 열어 디자인을 관리합니다.</p>
            </div>
            <button
              onClick={() => setShowBulkOptions((v) => !v)}
              className="shrink-0 rounded-md border border-neutral-300 px-4 py-2 text-center text-body-sm font-semibold text-primary hover:bg-neutral-50"
            >
              {showBulkOptions ? '닫기' : '옵션 관리'}
            </button>
          </div>

          {showBulkOptions && (
            <OptionManager onClose={() => setShowBulkOptions(false)} onDone={refetchAll} />
          )}

          {folders.length > 0 && (
            <FolderBulkActionBar
              folders={folders}
              selectedIds={folderSelectedIds}
              onSelectAll={() => setFolderSelectedIds(new Set(folders.map((f) => f.id)))}
              onClear={() => setFolderSelectedIds(new Set())}
              onDone={refetchAll}
              sortMode={folderSortMode}
              onSortModeChange={setFolderSortMode}
            />
          )}

          <FolderGrid
            folders={folders}
            unfiledCount={unfiledCount}
            loading={foldersQuery.isLoading || unfiledQuery.isLoading}
            onOpen={setOpen}
            selectedIds={folderSelectedIds}
            onToggleSelect={(id) =>
              setFolderSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
        </>
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
  selectedIds,
  onToggleSelect,
}: {
  folders: DesignFolder[];
  unfiledCount: number;
  loading: boolean;
  onOpen: (v: FolderView) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  if (loading) return <p className="text-body-sm text-primary-50">불러오는 중…</p>;

  return (
    <div className="flex flex-col gap-3">
      {folders.map((f) => (
        <EditableFolderCard
          key={f.id}
          folder={f}
          onOpen={() => onOpen({ label: f.name, folderId: f.id })}
          selected={selectedIds.has(f.id)}
          onToggleSelect={() => onToggleSelect(f.id)}
        />
      ))}
      {unfiledCount > 0 && (
        <FolderCard
          name="미분류"
          count={unfiledCount}
          unfiled
          muted
          onClick={() => onOpen({ label: '미분류', unfiled: true })}
        />
      )}
      <NewFolderCard />
    </div>
  );
}

/** 폴더 카드의 "디자인 N개" 옆에 공개/비공개 개수를 함께 보여준다. */
function FolderCounts({
  folderId,
  unfiled,
  fallbackCount,
}: {
  folderId?: string;
  unfiled?: boolean;
  fallbackCount: number;
}) {
  const q = useQuery({
    queryKey: ['designs', unfiled ? 'unfiled' : 'folder', folderId ?? 'none'],
    queryFn: () =>
      collectAll<Design>((cursor) => designsApi.listDesigns({ folder_id: folderId, unfiled, limit: 50, cursor })),
  });
  const list = q.data;
  if (!list) return <span className="mt-0.5 text-caption text-primary-50">디자인 {fallbackCount}개</span>;
  const activeCount = list.filter((d) => d.visibility === 'active').length;
  const hiddenCount = list.length - activeCount;
  return (
    <span className="mt-0.5 text-caption text-primary-50">
      디자인 {list.length}개 (공개 {activeCount}개 / 비공개 {hiddenCount}개)
    </span>
  );
}

function FolderCard({
  name,
  count,
  muted,
  unfiled,
  onClick,
}: {
  name: string;
  count: number;
  muted?: boolean;
  unfiled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:border-secondary hover:shadow-sm"
    >
      <span className="shrink-0 text-2xl">{muted ? '🗂️' : '📁'}</span>
      <span className="flex min-w-0 flex-col">
        <span className="line-clamp-1 break-keep font-semibold">{name}</span>
        <FolderCounts unfiled={unfiled} fallbackCount={count} />
      </span>
    </button>
  );
}

function EditableFolderCard({
  folder,
  onOpen,
  selected,
  onToggleSelect,
}: {
  folder: DesignFolder;
  onOpen: () => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [month, setMonth] = useState(folder.featured_month ?? '');
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

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
    <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-secondary hover:shadow-sm">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label="일괄 수정 대상으로 선택"
          className="h-4 w-4 shrink-0"
        />
        <button onClick={onOpen} className="flex flex-1 items-center gap-3 text-left">
          <span className="shrink-0 text-2xl">📁</span>
          <span className="flex min-w-0 flex-col">
            <span className="line-clamp-1 break-keep font-semibold">{folder.name}</span>
            <FolderCounts folderId={folder.id} fallbackCount={folder.design_count} />
          </span>
        </button>
        {folder.featured_month && !editing && (
          <span className="shrink-0 text-caption font-semibold text-secondary">
            🗓 이달의 아트 {folder.featured_month}
          </span>
        )}
        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="폴더 설정"
            aria-expanded={menuOpen}
            className="grid h-8 w-8 place-items-center rounded-md text-body-sm font-bold text-primary hover:bg-neutral-100"
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-7 z-10 min-w-[7.5rem] rounded-md border border-neutral-200 bg-white p-1.5 shadow-sm">
              <button
                onClick={() => {
                  setEditing(true);
                  setMenuOpen(false);
                }}
                className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-primary-50 underline hover:text-secondary"
              >
                {folder.featured_month ? '진행월 변경' : '이달의 아트 지정'}
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
                disabled={del.isPending}
                className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-danger/80 hover:text-danger disabled:opacity-50"
              >
                {del.isPending ? '삭제 중…' : '삭제'}
              </button>
            </div>
          )}
        </div>
      </div>
      {editing && (
        <div className="flex flex-col gap-1.5">
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
        className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-300 p-4 text-body-sm font-semibold text-primary-50 hover:border-secondary hover:text-secondary"
      >
        <span className="text-heading-md leading-none">+</span>
        <span>새 폴더</span>
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

/**
 * 폴더 목록 일괄 수정 바. 체크한 폴더들 안에 있는 모든 디자인의 공개상태를 한 번에 바꾸거나,
 * 폴더 자체를 삭제한다(폴더를 지워도 디자인은 삭제되지 않고 미분류로 이동 — deleteFolder와 동일한 규칙).
 * 폴더에는 가격·소요시간·태그 같은 개념이 없어서 디자인 목록 쪽 일괄 수정 바와 달리
 * 공개전환/비공개전환/삭제 세 가지만 제공한다.
 */
function FolderBulkActionBar({
  folders,
  selectedIds,
  onSelectAll,
  onClear,
  onDone,
  sortMode,
  onSortModeChange,
}: {
  folders: DesignFolder[];
  selectedIds: Set<string>;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
  sortMode: 'name' | 'created';
  onSortModeChange: (mode: 'name' | 'created') => void;
}) {
  const count = selectedIds.size;
  const selected = folders.filter((f) => selectedIds.has(f.id));

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const closeAllPanels = () => {
    setConfirmDel(false);
    setErr(null);
  };

  async function runVisibility(visibility: 'active' | 'hidden') {
    setMenuOpen(false);
    setBusy(true);
    setErr(null);
    try {
      for (const f of selected) {
        const list = await collectAll<Design>((cursor) =>
          designsApi.listDesigns({ folder_id: f.id, limit: 50, cursor }),
        );
        for (const d of list) {
          await designsApi.changeVisibility(d.id, { visibility });
        }
      }
      onDone();
      onClear();
    } catch (e) {
      setErr(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function runDelete() {
    setBusy(true);
    setErr(null);
    try {
      for (const f of selected) {
        await designsApi.deleteFolder(f.id);
      }
      onDone();
      closeAllPanels();
      onClear();
    } catch (e) {
      setErr(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-center gap-2">
        {count === 0 ? (
          <label className="flex items-center gap-2 text-body-sm text-primary">
            <input type="checkbox" checked={false} onChange={onSelectAll} />
            전체 선택
          </label>
        ) : (
          <div className="flex items-center gap-2 text-body-sm text-primary">
            <input type="checkbox" checked readOnly onClick={onClear} />
            <span className="font-semibold">{count}개 선택</span>
            <button
              type="button"
              onClick={onClear}
              className="text-caption text-primary-50 underline hover:text-secondary"
            >
              선택 취소
            </button>
          </div>
        )}
        <div className="ml-auto flex items-center overflow-hidden rounded-md border border-neutral-300">
          <button
            type="button"
            onClick={() => onSortModeChange('name')}
            className={`px-3 py-1 text-caption font-semibold ${
              sortMode === 'name' ? 'bg-secondary text-white' : 'text-primary-50 hover:bg-neutral-50'
            }`}
          >
            이름순
          </button>
          <button
            type="button"
            onClick={() => onSortModeChange('created')}
            className={`px-3 py-1 text-caption font-semibold ${
              sortMode === 'created' ? 'bg-secondary text-white' : 'text-primary-50 hover:bg-neutral-50'
            }`}
          >
            추가순
          </button>
        </div>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={count === 0}
            aria-label="일괄 작업"
            aria-expanded={menuOpen}
            className="grid h-8 w-8 place-items-center rounded-md text-body-sm font-bold text-primary hover:bg-neutral-100 disabled:opacity-30"
          >
            ⋮
          </button>
          {menuOpen && count > 0 && (
            <div className="absolute right-0 top-7 z-10 min-w-[8rem] rounded-md border border-neutral-200 bg-white p-1.5 shadow-sm">
              <button
                type="button"
                onClick={() => void runVisibility('hidden')}
                className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-primary hover:bg-neutral-50"
              >
                비공개로 전환
              </button>
              <button
                type="button"
                onClick={() => void runVisibility('active')}
                className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-primary hover:bg-neutral-50"
              >
                공개로 전환
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  closeAllPanels();
                  setConfirmDel(true);
                }}
                className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-danger/80 hover:text-danger"
              >
                삭제
              </button>
            </div>
          )}
        </div>
      </div>

      {err && <p className="mt-2 text-caption text-danger">{err}</p>}

      {confirmDel && (
        <div className="mt-3 inline-flex items-center gap-1.5 text-caption text-primary-50">
          선택한 {count}개 폴더를 삭제할까요? (디자인은 삭제되지 않고 미분류로 이동해요)
          <button
            onClick={() => void runDelete()}
            disabled={busy}
            className="rounded-md bg-danger-bg px-2.5 py-1.5 text-caption font-semibold text-danger disabled:opacity-50"
          >
            {busy ? '삭제 중…' : '삭제 확인'}
          </button>
          <button
            onClick={closeAllPanels}
            className="rounded-md bg-neutral-100 px-2.5 py-1.5 text-caption font-semibold text-primary"
          >
            취소
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────── 폴더 내부 디자인 ───────────── */

function FolderDesigns({
  view,
  onBack,
  designers,
  onCreated,
}: {
  view: FolderView;
  onBack: () => void;
  designers: Designer[];
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedDesign, setSelectedDesign] = useState<Design | null>(null); // 디자인 세부 탭(3단계 브레드크럼)
  // 리스트 전체에서 간편 수정(가격/소요시간/태그)이 동시에 두 개 이상 열리지 않도록 여기서 관리한다.
  const [activeQuickEdit, setActiveQuickEdit] = useState<{
    designId: string;
    kind: 'price' | 'duration' | 'tags';
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // 일괄 수정용 선택
  // 추가순(기본) = 등록 순서 내림차순(가장 최근에 등록한 게 위). 이름순 = 123→ㄱㄴㄷ→abc 순으로 오름차순.
  const [sortMode, setSortMode] = useState<'name' | 'created'>('created');
  const q = useQuery({
    queryKey: ['designs', view.unfiled ? 'unfiled' : 'folder', view.folderId ?? 'none'],
    queryFn: () =>
      collectAll<Design>((cursor) =>
        designsApi.listDesigns({ folder_id: view.folderId, unfiled: view.unfiled, limit: 50, cursor }),
      ),
  });
  const designs = useMemo(() => {
    const list = [...(q.data ?? [])];
    if (sortMode === 'name') {
      list.sort((a, b) => compareTitleAsc(a.title, b.title));
    } else {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  }, [q.data, sortMode]);

  const designersQuery = useQuery({ queryKey: ['designers'], queryFn: () => designersApi.listDesigners() });
  const foldersQuery = useQuery({ queryKey: ['design-folders'], queryFn: () => designsApi.listFolders() });
  const [bulkFiles, setBulkFiles] = useState<File[] | null>(null); // 비어있지 않으면 일괄 모달 오픈

  // 실제 폴더에서만 일괄 등록(미분류는 제목에 폴더명을 못 붙임)
  const canBulk = !!view.folderId && !view.unfiled;

  const refetchLists = () => {
    qc.invalidateQueries({ queryKey: ['designs'] });
    // 각 DesignCard가 목록과 별개로 들고 있는 개별 캐시(['design', id])도 같이 갱신해야
    // 일괄 수정 직후 새로고침 없이 카드에 바로 반영된다.
    qc.invalidateQueries({ queryKey: ['design'] });
    qc.invalidateQueries({ queryKey: ['design-folders'] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <button
            onClick={() => {
              setSelectedDesign(null);
              onBack();
            }}
            className="text-heading-md font-bold text-primary hover:text-secondary"
          >
            디자인
          </button>
          <span className="text-heading-md font-bold text-primary-50">/</span>
          {selectedDesign ? (
            <>
              <button
                onClick={() => setSelectedDesign(null)}
                className="text-heading-md font-bold text-primary hover:text-secondary"
              >
                {view.label}
              </button>
              <span className="text-heading-md font-bold text-primary-50">/</span>
              <h2 className="text-heading-md font-bold">{selectedDesign.title}</h2>
            </>
          ) : (
            <>
              <h2 className="text-heading-md font-bold">{view.label}</h2>
              <span className="ml-1 text-body-sm text-primary-50">{designs.length}개</span>
            </>
          )}
        </div>
        {!selectedDesign && (
          <button
            onClick={() => setShowCreate(true)}
            className="shrink-0 rounded-md bg-secondary px-4 py-2 text-body-sm font-semibold text-white"
          >
            + 새 디자인
          </button>
        )}
      </div>

      {selectedDesign ? (
        <DesignDetailForm
          design={selectedDesign}
          onClose={() => setSelectedDesign(null)}
        />
      ) : (
        <>
          {showCreate && (
            <CreateForm
              designers={designers}
              // 이 폴더 안에서만 등록 가능 — 폴더 선택 없이 항상 이 폴더로 고정(미분류 뷰면 미분류로 등록).
              defaultFolderId={!view.unfiled ? (view.folderId ?? '') : ''}
              onClose={() => setShowCreate(false)}
              onCreated={() => {
                onCreated();
                refetchLists();
                setShowCreate(false);
              }}
            />
          )}

          {canBulk && <BulkDropzone onFiles={setBulkFiles} />}

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
            <>
              <BulkActionBar
                designs={designs}
                selectedIds={selectedIds}
                onSelectAll={() => setSelectedIds(new Set(designs.map((d) => d.id)))}
                onClear={() => setSelectedIds(new Set())}
                folders={foldersQuery.data ?? []}
                onDone={refetchLists}
                sortMode={sortMode}
                onSortModeChange={setSortMode}
              />
              <ul className="grid grid-cols-1 gap-3">
                {designs.map((d) => (
                  <DesignCard
                    key={d.id}
                    design={d}
                    onOpen={() => setSelectedDesign(d)}
                    quickEdit={activeQuickEdit?.designId === d.id ? activeQuickEdit.kind : null}
                    onQuickEditChange={(kind) => setActiveQuickEdit(kind ? { designId: d.id, kind } : null)}
                    selected={selectedIds.has(d.id)}
                    onToggleSelect={() =>
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.id)) next.delete(d.id);
                        else next.add(d.id);
                        return next;
                      })
                    }
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 디자인 목록 일괄 수정 바. 체크한 디자인들에 공개상태/가격/소요시간/폴더/삭제를 한 번에 적용한다.
 * 태그는 디자인마다 의미가 달라서 일괄 수정 대상에서 뺐다(개별 카드에서만 수정).
 *
 * 가격·소요시간은 "값으로 설정"(선택한 전부를 같은 값으로 덮어씀) / "+/- 조정"(디자인마다 현재값에
 * 더하고 빼기, 예: 전체 +10,000원) 두 모드를 지원한다. 백엔드는 절대값만 받기 때문에, +/- 조정은
 * 프런트에서 디자인마다 "현재값 + 델타"를 계산해 디자인별로 개별 PATCH를 보내는 방식으로 구현했다.
 * 두 모드 모두 기존 값을 되돌릴 수 없이 덮어쓰므로, 저장 버튼을 한 번 더 눌러 확정하는 확인 단계를 둔다.
 */
function BulkActionBar({
  designs,
  selectedIds,
  onSelectAll,
  onClear,
  folders,
  onDone,
  sortMode,
  onSortModeChange,
}: {
  designs: Design[];
  selectedIds: Set<string>;
  onSelectAll: () => void;
  onClear: () => void;
  folders: DesignFolder[];
  onDone: () => void;
  sortMode: 'name' | 'created';
  onSortModeChange: (mode: 'name' | 'created') => void;
}) {
  const count = selectedIds.size;
  const selected = designs.filter((d) => selectedIds.has(d.id));

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const [quickEdit, setQuickEdit] = useState<'price' | 'duration' | null>(null);
  const [mode, setMode] = useState<'set' | 'delta'>('set');
  const [draft, setDraft] = useState('');
  const [confirmStep, setConfirmStep] = useState(false);
  const [showFolderMove, setShowFolderMove] = useState(false);
  const [folderDraft, setFolderDraft] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const closeAllPanels = () => {
    setQuickEdit(null);
    setConfirmStep(false);
    setShowFolderMove(false);
    setConfirmDel(false);
    setErr(null);
  };

  const openQuickEdit = (kind: 'price' | 'duration') => {
    setMenuOpen(false);
    closeAllPanels();
    setMode('set');
    setDraft('');
    setQuickEdit(kind);
  };

  async function runPerDesign(bodyFor: (d: Design) => Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      for (const d of selected) {
        await designsApi.updateDesign(d.id, bodyFor(d));
      }
      onDone();
      closeAllPanels();
      onClear();
    } catch (e) {
      setErr(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // 이달의 아트 인트로가는 숨겨져 있지만, 정상가를 그대로 따라가고 있던 디자인이면 같이 갱신한다
  // (개별 카드 가격 수정과 동일한 규칙). 디자인마다 따라가는 상태가 다를 수 있어 디자인별로 판단한다.
  const priceUpdateBody = (d: Design, newPrice: number) => {
    const introFollows = d.intro_price == null || d.intro_price === d.base_price;
    return introFollows ? { base_price: newPrice, intro_price: newPrice } : { base_price: newPrice };
  };

  const submitPrice = () => {
    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }
    const n = Math.round(Number(draft)) || 0;
    if (mode === 'set') {
      const v = Math.max(0, n);
      void runPerDesign((d) => priceUpdateBody(d, v));
    } else {
      void runPerDesign((d) => priceUpdateBody(d, Math.max(0, d.base_price + n)));
    }
  };

  const submitDuration = () => {
    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }
    const n = Math.round(Number(draft)) || 0;
    if (mode === 'set') {
      const v = clampDuration(n);
      void runPerDesign(() => ({ duration_minutes: v }));
    } else {
      void runPerDesign((d) => ({ duration_minutes: clampDuration(d.duration_minutes + n) }));
    }
  };

  async function runVisibility(visibility: 'active' | 'hidden') {
    setMenuOpen(false);
    setBusy(true);
    setErr(null);
    try {
      for (const d of selected) {
        await designsApi.changeVisibility(d.id, { visibility });
      }
      onDone();
      onClear();
    } catch (e) {
      setErr(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function runFolderMove() {
    setBusy(true);
    setErr(null);
    try {
      for (const d of selected) {
        await designsApi.updateDesign(d.id, { folder_id: folderDraft || null });
      }
      onDone();
      closeAllPanels();
      onClear();
    } catch (e) {
      setErr(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function runDelete() {
    setBusy(true);
    setErr(null);
    try {
      for (const d of selected) {
        await designsApi.deleteDesign(d.id);
      }
      onDone();
      closeAllPanels();
      onClear();
    } catch (e) {
      setErr(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const modeBtnCls = (active: boolean) =>
    `rounded-full border px-3 py-1 text-caption font-semibold ${
      active ? 'border-secondary bg-secondary/10 text-secondary' : 'border-neutral-300 text-primary-50'
    }`;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <div className="flex items-center gap-2">
        {count === 0 ? (
          <label className="flex items-center gap-2 text-body-sm text-primary">
            <input type="checkbox" checked={false} onChange={onSelectAll} />
            전체 선택
          </label>
        ) : (
          <div className="flex items-center gap-2 text-body-sm text-primary">
            <input type="checkbox" checked readOnly onClick={onClear} />
            <span className="font-semibold">{count}개 선택</span>
            <button
              type="button"
              onClick={onClear}
              className="text-caption text-primary-50 underline hover:text-secondary"
            >
              선택 취소
            </button>
          </div>
        )}
        <div className="ml-auto flex items-center overflow-hidden rounded-md border border-neutral-300">
          <button
            type="button"
            onClick={() => onSortModeChange('name')}
            className={`px-3 py-1 text-caption font-semibold ${
              sortMode === 'name' ? 'bg-secondary text-white' : 'text-primary-50 hover:bg-neutral-50'
            }`}
          >
            이름순
          </button>
          <button
            type="button"
            onClick={() => onSortModeChange('created')}
            className={`px-3 py-1 text-caption font-semibold ${
              sortMode === 'created' ? 'bg-secondary text-white' : 'text-primary-50 hover:bg-neutral-50'
            }`}
          >
            추가순
          </button>
        </div>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={count === 0}
            aria-label="일괄 작업"
            aria-expanded={menuOpen}
            className="grid h-8 w-8 place-items-center rounded-md text-body-sm font-bold text-primary hover:bg-neutral-100 disabled:opacity-30"
          >
            ⋮
          </button>
          {menuOpen && count > 0 && (
            <div className="absolute right-0 top-7 z-10 min-w-[8rem] rounded-md border border-neutral-200 bg-white p-1.5 shadow-sm">
              <button
                type="button"
                onClick={() => void runVisibility('hidden')}
                className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-primary hover:bg-neutral-50"
              >
                비공개로 전환
              </button>
              <button
                type="button"
                onClick={() => void runVisibility('active')}
                className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-primary hover:bg-neutral-50"
              >
                공개로 전환
              </button>
              <button
                type="button"
                onClick={() => openQuickEdit('price')}
                className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-primary hover:bg-neutral-50"
              >
                가격 수정
              </button>
              <button
                type="button"
                onClick={() => openQuickEdit('duration')}
                className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-primary hover:bg-neutral-50"
              >
                소요시간 수정
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  closeAllPanels();
                  setFolderDraft('');
                  setShowFolderMove(true);
                }}
                className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-primary hover:bg-neutral-50"
              >
                폴더 이동
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  closeAllPanels();
                  setConfirmDel(true);
                }}
                className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-danger/80 hover:text-danger"
              >
                삭제
              </button>
            </div>
          )}
        </div>
      </div>

      {quickEdit === 'price' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitPrice();
          }}
          className="mt-3 space-y-2"
        >
          <label className="block text-caption font-semibold text-primary-50">
            정상가(원) — 선택한 {count}개 디자인에 적용
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setMode('set');
                setConfirmStep(false);
              }}
              className={modeBtnCls(mode === 'set')}
            >
              값으로 설정
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('delta');
                setConfirmStep(false);
              }}
              className={modeBtnCls(mode === 'delta')}
            >
              +/- 조정
            </button>
          </div>
          <input
            type="number"
            step={PRICE_INPUT_STEP}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setConfirmStep(false);
            }}
            placeholder={mode === 'set' ? '예: 60000' : '예: 10000 또는 -5000'}
            autoFocus
            className={inputCls}
          />
          {confirmStep && (
            <p className="text-caption text-danger">
              {mode === 'set'
                ? `선택한 ${count}개 디자인의 정상가가 전부 ${(Math.max(0, Math.round(Number(draft)) || 0)).toLocaleString('ko-KR')}원으로 덮어씌워져요. 되돌릴 수 없어요 — 계속하려면 저장을 한 번 더 눌러주세요.`
                : `선택한 ${count}개 디자인의 정상가에 각각 ${(Math.round(Number(draft)) || 0).toLocaleString('ko-KR')}원이 적용돼요(0원 밑으로는 안 내려가요). 되돌릴 수 없어요 — 계속하려면 저장을 한 번 더 눌러주세요.`}
            </p>
          )}
          {err && <p className="text-caption text-danger">{err}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="rounded-md bg-secondary px-4 py-2 text-caption font-semibold text-white disabled:opacity-50"
            >
              {busy ? '저장 중…' : confirmStep ? '정말 저장' : '저장'}
            </button>
            <button
              type="button"
              onClick={closeAllPanels}
              className="rounded-md border border-neutral-300 px-4 py-2 text-caption text-primary"
            >
              취소
            </button>
          </div>
        </form>
      )}

      {quickEdit === 'duration' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitDuration();
          }}
          className="mt-3 space-y-2"
        >
          <label className="block text-caption font-semibold text-primary-50">
            소요시간(분) — 선택한 {count}개 디자인에 적용
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setMode('set');
                setConfirmStep(false);
              }}
              className={modeBtnCls(mode === 'set')}
            >
              값으로 설정
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('delta');
                setConfirmStep(false);
              }}
              className={modeBtnCls(mode === 'delta')}
            >
              +/- 조정
            </button>
          </div>
          <input
            type="number"
            step={DURATION_STEP}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setConfirmStep(false);
            }}
            placeholder={mode === 'set' ? `예: 90 (${DURATION_MIN}~${DURATION_MAX})` : '예: 10 또는 -10'}
            autoFocus
            className={inputCls}
          />
          {confirmStep && (
            <p className="text-caption text-danger">
              {mode === 'set'
                ? `선택한 ${count}개 디자인의 소요시간이 전부 ${clampDuration(Math.round(Number(draft)) || 0)}분으로 덮어씌워져요. 되돌릴 수 없어요 — 계속하려면 저장을 한 번 더 눌러주세요.`
                : `선택한 ${count}개 디자인의 소요시간에 각각 ${Math.round(Number(draft)) || 0}분이 적용돼요(${DURATION_MIN}~${DURATION_MAX}분 범위로 자동 조정). 되돌릴 수 없어요 — 계속하려면 저장을 한 번 더 눌러주세요.`}
            </p>
          )}
          {err && <p className="text-caption text-danger">{err}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="rounded-md bg-secondary px-4 py-2 text-caption font-semibold text-white disabled:opacity-50"
            >
              {busy ? '저장 중…' : confirmStep ? '정말 저장' : '저장'}
            </button>
            <button
              type="button"
              onClick={closeAllPanels}
              className="rounded-md border border-neutral-300 px-4 py-2 text-caption text-primary"
            >
              취소
            </button>
          </div>
        </form>
      )}

      {showFolderMove && (
        <div className="mt-3 space-y-2">
          <label className="block text-caption font-semibold text-primary-50">
            폴더 — 선택한 {count}개 디자인을 이동
          </label>
          <select
            value={folderDraft}
            onChange={(e) => setFolderDraft(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-body-sm outline-none focus:border-secondary"
            aria-label="폴더 이동"
          >
            <option value="">미분류</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {err && <p className="text-caption text-danger">{err}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void runFolderMove()}
              disabled={busy}
              className="rounded-md bg-secondary px-4 py-2 text-caption font-semibold text-white disabled:opacity-50"
            >
              {busy ? '저장 중…' : '저장'}
            </button>
            <button
              type="button"
              onClick={closeAllPanels}
              className="rounded-md border border-neutral-300 px-4 py-2 text-caption text-primary"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="mt-3 inline-flex items-center gap-1.5 text-caption text-primary-50">
          선택한 {count}개 디자인을 삭제할까요?
          <button
            onClick={() => void runDelete()}
            disabled={busy}
            className="rounded-md bg-danger-bg px-2.5 py-1.5 text-caption font-semibold text-danger disabled:opacity-50"
          >
            {busy ? '삭제 중…' : '삭제 확인'}
          </button>
          <button
            onClick={closeAllPanels}
            className="rounded-md bg-neutral-100 px-2.5 py-1.5 text-caption font-semibold text-primary"
          >
            취소
          </button>
        </div>
      )}
    </div>
  );
}

/** 섹션(kind) 탭 표시 순서 — 앱에서 "제거/연장/케어" 순서로 노출되는 것과 맞춘다. */
const SECTION_TABS: { value: OptionKind; label: string }[] = [
  { value: 'removal', label: '제거' },
  { value: 'extend', label: '연장' },
  { value: 'care', label: '케어' },
];

/** 샵 공통 옵션 한 줄. 같은 이름의 design_options row를 모든 디자인에 걸쳐 묶어서 다룬다. */
interface ShopOptionRow {
  name: string;
  kind: OptionKind;
  priceDelta: number;
  durationDelta: number;
  isActive: boolean; // 앱 노출 여부 — 한 곳이라도 비활성이면 비활성으로 취급
  orderKey: number; // 섹션 내 정렬 기준 — 디자인들에 걸친 sort_order 중 최솟값
}

/** 편집 중인(아직 저장 안 한) 옵션 한 줄. */
interface DraftRow {
  uid: string;
  originalName: string | null; // null이면 새로 추가한 줄(아직 어디에도 없음)
  name: string;
  priceDelta: number;
  durationDelta: number;
  deleted: boolean;
}

/** 배열에서 한 항목을 다른 자리로 옮긴 새 배열. */
function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

const emptyDraftByKind = (): Record<OptionKind, DraftRow[]> => ({ extend: [], removal: [], care: [] });

/**
 * 옵션 관리 — 샵 전체 공용. 개별 디자인·폴더 단위로는 더 이상 옵션을 따로 두지 않고,
 * 샵에 있는 모든 디자인에 동일하게 적용한다(디자인 등록/수정 화면에는 옵션 입력이 없다).
 *
 * 이 모달을 여는 동안은 로컬 초안(draft)만 편집하고, "저장"을 눌러야 실제로 반영된다.
 * 저장 시점에 항상 샵의 모든 디자인에 100% 동일하게 맞춘다(없는 디자인엔 새로 만들고,
 * 있는 디자인은 갱신·삭제) — 그래서 일부만 적용된 상태(드리프트)는 존재하지 않는다.
 *
 * ⚠ 백엔드에 "샵 옵션" 전용 테이블은 아직 없다 — 실제로는 여전히 디자인별
 * design_options row로 저장되고, 이 화면이 "이름"을 기준으로 모든 디자인의 동일 이름
 * row를 하나로 묶어서 다룬다. 섹션 온/오프는 그 kind의 모든 옵션 row의 `is_active`를
 * 일괄로 켜고 끄는 것으로 구현한다(옵션 자체는 삭제하지 않음).
 */
function OptionManager({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  useLockBodyScroll();
  const allDesignsQuery = useQuery({
    queryKey: ['designs', 'all-for-options'],
    queryFn: () => collectAll<Design>((cursor) => designsApi.listDesigns({ limit: 50, cursor })),
  });
  const allDesigns = useMemo(() => allDesignsQuery.data ?? [], [allDesignsQuery.data]);

  // 디자인들의 옵션을 이름 기준으로 묶어 "샵 공통 옵션" 목록을 만든다 — 초안 초기화에만 쓰인다.
  const shopOptions = useMemo<ShopOptionRow[]>(() => {
    const map = new Map<string, ShopOptionRow>();
    for (const design of allDesigns) {
      for (const option of design.options ?? []) {
        let row = map.get(option.name);
        if (!row) {
          row = {
            name: option.name,
            kind: (OPTION_KINDS.some((k) => k.value === option.kind) ? option.kind : 'extend') as OptionKind,
            priceDelta: option.price_delta,
            durationDelta: option.duration_delta_min ?? 0,
            isActive: option.is_active,
            orderKey: option.sort_order,
          };
          map.set(option.name, row);
        } else {
          row.orderKey = Math.min(row.orderKey, option.sort_order);
          if (!option.is_active) row.isActive = false;
        }
      }
    }
    return Array.from(map.values());
  }, [allDesigns]);

  // --- 로컬 초안: 이 모달을 여는 동안의 편집 상태. "저장"을 눌러야 실제 반영된다 ---
  const [initialized, setInitialized] = useState(false);
  const [draftByKind, setDraftByKind] = useState<Record<OptionKind, DraftRow[]>>(emptyDraftByKind());
  const [sectionActive, setSectionActive] = useState<Record<OptionKind, boolean>>({
    extend: false,
    removal: false,
    care: false,
  });

  useEffect(() => {
    if (initialized || !allDesignsQuery.isSuccess) return;
    const byKind = emptyDraftByKind();
    const active: Record<OptionKind, boolean> = { extend: false, removal: false, care: false };
    for (const kind of Object.keys(byKind) as OptionKind[]) {
      const rows = shopOptions
        .filter((r) => r.kind === kind)
        .sort((a, b) => a.orderKey - b.orderKey || a.name.localeCompare(b.name, 'ko'));
      byKind[kind] = rows.map((r) => ({
        uid: crypto.randomUUID(),
        originalName: r.name,
        name: r.name,
        priceDelta: r.priceDelta,
        durationDelta: r.durationDelta,
        deleted: false,
      }));
      active[kind] = rows.some((r) => r.isActive);
    }
    setDraftByKind(byKind);
    setSectionActive(active);
    setInitialized(true);
  }, [initialized, allDesignsQuery.isSuccess, shopOptions]);

  const updateRow = (kind: OptionKind, uid: string, patch: Partial<DraftRow>) =>
    setDraftByKind((prev) => ({
      ...prev,
      [kind]: prev[kind].map((r) => (r.uid === uid ? { ...r, ...patch } : r)),
    }));
  const addRow = (kind: OptionKind) =>
    setDraftByKind((prev) => ({
      ...prev,
      [kind]: [
        ...prev[kind],
        {
          uid: crypto.randomUUID(),
          originalName: null,
          name: '',
          priceDelta: OPTION_PRICE_DEFAULT,
          durationDelta: OPTION_DURATION_DEFAULT,
          deleted: false,
        },
      ],
    }));
  const removeRow = (kind: OptionKind, uid: string) =>
    setDraftByKind((prev) => ({
      ...prev,
      [kind]: prev[kind]
        .map((r) => (r.uid === uid ? { ...r, deleted: true } : r))
        .filter((r) => r.originalName !== null || r.uid !== uid), // 저장 전 새 줄은 바로 제거, 기존 줄은 삭제 표시만
    }));

  // --- 섹션 내 드래그 정렬 (로컬 상태만 바꾸고, 저장 시 sort_order로 반영) ---
  const [dragKind, setDragKind] = useState<OptionKind | null>(null);
  const [dragUid, setDragUid] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const startDrag = (e: React.PointerEvent, kind: OptionKind, uid: string) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragKind(kind);
    setDragUid(uid);
  };
  const endDrag = () => {
    setDragKind(null);
    setDragUid(null);
  };
  const onDragMove = (e: React.PointerEvent, kind: OptionKind, uid: string) => {
    if (dragKind !== kind || dragUid !== uid) return;
    const rows = draftByKind[kind];
    const from = rows.findIndex((r) => r.uid === uid);
    if (from < 0) return;
    for (let i = 0; i < rows.length; i += 1) {
      if (i === from) continue;
      const el = rowRefs.current.get(rows[i].uid);
      if (!el) continue;
      const box = el.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      const passedDown = i > from && e.clientY > middle;
      const passedUp = i < from && e.clientY < middle;
      if (passedDown || passedUp) {
        setDraftByKind((prev) => ({ ...prev, [kind]: moveItem(prev[kind], from, i) }));
        return;
      }
    }
  };

  // --- 저장/취소 ---
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      for (const kind of Object.keys(draftByKind) as OptionKind[]) {
        const rows = draftByKind[kind];
        const isActive = sectionActive[kind];
        for (const design of allDesigns) {
          const existingByName = new Map((design.options ?? []).filter((o) => o.kind === kind).map((o) => [o.name, o]));
          const keepNames = new Set(rows.filter((r) => !r.deleted).map((r) => r.originalName ?? r.name));

          // 초안에서 삭제 표시된(또는 더 이상 안 남은) 기존 옵션은 이 디자인에서도 삭제.
          for (const [name, existing] of existingByName) {
            if (!keepNames.has(name)) await designsApi.deleteOption(design.id, existing.id);
          }

          // 남은 줄들을 순서대로 생성/갱신 — 항상 모든 디자인에 동일하게 맞춘다.
          for (let i = 0; i < rows.length; i += 1) {
            const r = rows[i];
            if (r.deleted || !r.name.trim()) continue;
            const existing = r.originalName ? existingByName.get(r.originalName) : undefined;
            const body = {
              name: r.name.trim(),
              price_delta: Math.max(0, Math.round(r.priceDelta) || 0),
              duration_delta_min: clampOptionDuration(r.durationDelta),
              sort_order: i,
            };
            if (existing) {
              const changed =
                existing.name !== body.name ||
                existing.price_delta !== body.price_delta ||
                existing.duration_delta_min !== body.duration_delta_min ||
                existing.sort_order !== i ||
                existing.is_active !== isActive;
              if (changed) await designsApi.updateOption(design.id, existing.id, { ...body, is_active: isActive });
            } else {
              const created = await designsApi.createOption(design.id, { kind, ...body });
              if (!isActive) await designsApi.updateOption(design.id, created.id, { is_active: false });
            }
          }
        }
      }
      await allDesignsQuery.refetch();
      onDone();
      onClose();
    } catch (e) {
      setSaveError(toUserMessage(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 p-6 pb-4">
          <div>
            <h2 className="text-heading-md font-bold text-primary">옵션 관리</h2>
            <p className="mt-1 text-caption text-primary-50">
              샵에 있는 모든 디자인에 동일하게 적용되는 공통 옵션이에요. 개별 디자인이나
              폴더별로 다르게 설정할 수 없어요.
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-neutral-100 text-primary-50"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <div className="space-y-6 overflow-y-auto p-6 pt-4">
      {/* 섹션 온/오프 — 켜진 섹션만 아래에 목록으로 펼쳐진다. 끄면 그 섹션 옵션 전체가 앱에서 비활성화(삭제 아님). */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SECTION_TABS.map((tab) => {
          const on = sectionActive[tab.value];
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setSectionActive((prev) => ({ ...prev, [tab.value]: !prev[tab.value] }))}
              className={`rounded-full border px-4 py-1.5 text-body-sm font-semibold ${
                on
                  ? 'border-secondary bg-secondary text-white'
                  : 'border-neutral-300 text-primary-50 hover:border-secondary hover:text-secondary'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
        <button
          type="button"
          disabled
          title="새 섹션 추가는 아직 지원하지 않아요 (앱과 함께 맞춰야 하는 부분이라 별도 준비 중이에요)"
          className="rounded-full border border-dashed border-neutral-300 px-3 py-1.5 text-body-sm font-semibold text-primary-50 opacity-50"
        >
          +
        </button>
      </div>

      {saveError && <p className="text-caption text-danger">{saveError}</p>}

      {/* 켜진 섹션만 순서대로 목록 표시 */}
      {(() => {
        const totalActiveRows = (Object.keys(draftByKind) as OptionKind[]).reduce(
          (sum, k) => sum + draftByKind[k].filter((r) => !r.deleted).length,
          0,
        );
        const atCap = totalActiveRows >= MAX_DESIGN_OPTIONS;
        return SECTION_TABS.filter((tab) => sectionActive[tab.value]).map((tab) => {
          const rows = draftByKind[tab.value].filter((r) => !r.deleted);
          return (
          <div key={tab.value} className="space-y-2 border-t border-neutral-200 pt-4">
            <p className="text-body-sm font-semibold text-primary">{tab.label}</p>
            {rows.length === 0 ? (
              <p className="text-caption text-primary-50">아직 등록된 옵션이 없어요.</p>
            ) : (
              <div className="space-y-2">
                {rows.map((row) => (
                  <div
                    key={row.uid}
                    ref={(el) => {
                      if (el) rowRefs.current.set(row.uid, el);
                      else rowRefs.current.delete(row.uid);
                    }}
                    className={`flex items-center gap-2 rounded-md border p-2 ${
                      dragKind === tab.value && dragUid === row.uid
                        ? 'border-secondary bg-secondary/5'
                        : 'border-neutral-200'
                    }`}
                  >
                    <button
                      type="button"
                      onPointerDown={(e) => startDrag(e, tab.value, row.uid)}
                      onPointerMove={(e) => onDragMove(e, tab.value, row.uid)}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      className="grid h-8 w-5 shrink-0 cursor-grab touch-none select-none place-items-center rounded text-primary-50 hover:bg-neutral-100 active:cursor-grabbing"
                      aria-label="옵션 순서 변경 — 잡고 위아래로 끌기"
                      title="잡고 위아래로 끌어 순서를 바꿔요"
                    >
                      ⋮⋮
                    </button>
                    <input
                      value={row.name}
                      onChange={(e) => updateRow(tab.value, row.uid, { name: e.target.value })}
                      placeholder="옵션 이름 (예: 없음)"
                      maxLength={80}
                      className="min-w-[6rem] flex-1 rounded-md border border-neutral-300 px-2 py-1 text-caption"
                    />
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 text-caption text-primary-50">+</span>
                      <Stepper
                        value={row.priceDelta}
                        onChange={(v) => updateRow(tab.value, row.uid, { priceDelta: Math.max(0, v) })}
                        step={PRICE_STEP}
                        suffix="원"
                        ariaLabel="추가금액"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 text-caption text-primary-50">+</span>
                      <Stepper
                        value={row.durationDelta}
                        onChange={(v) =>
                          updateRow(tab.value, row.uid, { durationDelta: clampOptionDuration(v) })
                        }
                        step={OPTION_DURATION_STEP}
                        suffix="분"
                        ariaLabel="추가시간"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRow(tab.value, row.uid)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-neutral-300 text-primary-50 hover:bg-neutral-50"
                      aria-label="옵션 삭제"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => addRow(tab.value)}
              disabled={atCap}
              className="text-caption font-semibold text-secondary hover:underline disabled:cursor-not-allowed disabled:text-primary-50 disabled:no-underline"
            >
              + 옵션 추가
            </button>
            {atCap && (
              <p className="text-caption text-warning">
                디자인 1개당 옵션은 최대 {MAX_DESIGN_OPTIONS}개까지예요(제거·연장·케어 합산). 더 추가하려면 기존 옵션을 먼저 지워주세요.
              </p>
            )}
          </div>
          );
        });
      })()}

        </div>
        <div className="flex shrink-0 gap-2 border-t border-neutral-200 p-6 pt-4">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !initialized}
            className="rounded-md bg-secondary px-4 py-2 text-body-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-neutral-300 px-4 py-2 text-body-sm text-primary disabled:opacity-50"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateForm({
  designers,
  onCreated,
  onClose,
  defaultFolderId = '',
}: {
  designers: Designer[];
  onCreated: () => void;
  onClose: () => void;
  defaultFolderId?: string;
}) {
  // 사진은 하나의 목록으로 관리 — index 0 = 대표사진(수정 페이지와 동일한 구조).
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [title, setTitle] = useState('');
  // 제목을 사장님이 직접 고쳤는지. 고친 뒤에는 자동제목으로 덮어쓰지 않는다.
  const [titleTouched, setTitleTouched] = useState(false);
  const [settings, setSettings] = useState<DesignSettings>(() => defaultBulkSettings());
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 등록 도중 일부 실패 후 재시도할 때 디자인을 다시 만들지 않도록 보관.
  const createdIdRef = useRef<string | null>(null);
  // 이 폴더에 저장된 이전 공통설정(있으면 "불러오기" 배너 노출) — 반복 등록 편의.
  const [folderPreset, setFolderPreset] = useState<DesignSettings | null>(null);

  useLockBodyScroll();
  const uploading = photos.some((p) => p.status === 'uploading');

  // 폴더 내에서만 등록하는 구조라 폴더는 defaultFolderId로 고정 — 이 폴더의 이전 설정이 있는지 확인.
  useEffect(() => {
    if (!defaultFolderId) {
      setFolderPreset(null);
      return;
    }
    setFolderPreset(loadBulkSettings(`snail_bulk_settings:${defaultFolderId}`, designers));
  }, [defaultFolderId, designers]);

  // 제목 자동생성: 이 폴더의 기존 디자인에서 다음 순번을 구해 "폴더명_001" 형식으로 채운다.
  const foldersQuery = useQuery({ queryKey: ['design-folders'], queryFn: () => designsApi.listFolders() });
  const selectedFolder = (foldersQuery.data ?? []).find((f) => f.id === defaultFolderId);
  const folderDesignsQuery = useQuery({
    queryKey: ['designs', 'folder', defaultFolderId || 'none', 'for-title'],
    queryFn: () =>
      collectAll<Design>((cursor) => designsApi.listDesigns({ folder_id: defaultFolderId, limit: 50, cursor })),
    enabled: !!defaultFolderId,
  });
  const autoTitle =
    selectedFolder && folderDesignsQuery.data
      ? `${selectedFolder.name}_${String(nextDesignNumber(selectedFolder.name, folderDesignsQuery.data)).padStart(3, '0')}`
      : '';

  // 사장님이 제목을 직접 고치기 전까지는 자동제목을 따라간다.
  useEffect(() => {
    if (!titleTouched) setTitle(autoTitle);
  }, [autoTitle, titleTouched]);

  const updatePhoto = (id: string, patch: Partial<PhotoItem>) =>
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const uploadFilesDirect = (files: File[]) => {
    for (const file of files) {
      const id = crypto.randomUUID();
      setPhotos((prev) => [...prev, { id, name: file.name, previewUrl: URL.createObjectURL(file), status: 'uploading' }]);
      uploadsApi
        .uploadFile(file, 'design')
        .then((r) => updatePhoto(id, { status: 'done', objectKey: r.object_key }))
        .catch((e) => updatePhoto(id, { status: 'error', error: toUserMessage(e) }));
    }
  };

  // 대표 사진을 아직 안 정한 상태(첫 업로드)에서만 크롭 흐름을 탄다 — 이미 대표가 있으면
  // "+ 사진 추가"는 그냥 상세 사진으로 바로 업로드된다(수정 페이지와 동일).
  const [pickThumbFrom, setPickThumbFrom] = useState<{ file: File; previewUrl: string }[] | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropRestFiles, setCropRestFiles] = useState<File[]>([]);

  const addPhotos = (fileList: FileList | null) => {
    if (!fileList) return;
    const room = MAX_EDIT_PHOTOS - photos.length;
    const files = Array.from(fileList)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, room);
    if (files.length === 0) return;

    if (photos.length === 0) {
      // 첫 업로드 — 대표(썸네일) 사진을 정해야 한다.
      if (files.length === 1) {
        setCropFile(files[0]);
        setCropRestFiles([]);
      } else {
        setPickThumbFrom(files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })));
      }
      return;
    }
    uploadFilesDirect(files);
  };

  const choosePendingThumbnail = (chosen: File) => {
    const rest = (pickThumbFrom ?? []).filter((p) => p.file !== chosen).map((p) => p.file);
    for (const p of pickThumbFrom ?? []) URL.revokeObjectURL(p.previewUrl);
    setPickThumbFrom(null);
    setCropFile(chosen);
    setCropRestFiles(rest);
  };
  const cancelPickThumbnail = () => {
    for (const p of pickThumbFrom ?? []) URL.revokeObjectURL(p.previewUrl);
    setPickThumbFrom(null);
  };

  const finishThumbnailFlow = (thumbFile: File) => {
    const rest = cropRestFiles;
    setCropFile(null);
    setCropRestFiles([]);
    // 대표 사진 파일명이 "번호_가격천원"(예: 01_75.jpg) 형태면 제목·가격을 자동으로 채운다.
    const info = parseFilenamePriceInfo(thumbFile.name);
    if (info) {
      setTitleTouched(true);
      setTitle(selectedFolder ? `${selectedFolder.name}_${info.number}` : info.number);
      setSettings((prev) => ({ ...prev, price: String(info.price) }));
    }
    uploadFilesDirect([thumbFile, ...rest]);
  };
  const handleThumbnailCropped = (blob: Blob) => {
    if (!cropFile) return;
    finishThumbnailFlow(new File([blob], cropFile.name, { type: blob.type || cropFile.type }));
  };
  const handleThumbnailCropCancel = () => {
    setCropFile(null);
    setCropRestFiles([]);
  };

  const removePhoto = (id: string) => setPhotos((prev) => prev.filter((p) => p.id !== id));
  const makeThumbnail = (id: string) =>
    setPhotos((prev) => {
      const t = prev.find((p) => p.id === id);
      if (!t) return prev;
      return [t, ...prev.filter((p) => p.id !== id)];
    });

  // 제목은 비워두면 자동제목으로 등록된다(필수 아님).
  const effectiveTitle = title.trim() || autoTitle;

  const onSubmit = async () => {
    setFormError(null);
    if (!effectiveTitle) {
      setFormError('제목을 불러오는 중이에요. 잠시 후 다시 시도해주세요.');
      return;
    }
    const thumb = photos[0];
    if (!thumb || thumb.status !== 'done' || !thumb.objectKey) {
      setFormError('대표 사진 1장을 등록해주세요.');
      return;
    }
    const price = Number(settings.price);
    if (settings.price.trim() === '' || !Number.isFinite(price) || price < 0) {
      setFormError('가격을 입력해주세요.');
      return;
    }
    const multiDesigner = designers.length >= 2;
    let designerFields: {
      designer_ids: string[];
      designer_durations: { designer_id: string; duration_minutes: number }[];
      designer_prices: { designer_id: string; base_price: number }[];
    } = { designer_ids: [], designer_durations: [], designer_prices: [] };
    if (multiDesigner) {
      if (settings.perDesigner) {
        const designerIds = Object.keys(settings.picked);
        if (designerIds.length === 0) {
          setFormError('이 디자인을 할 수 있는 디자이너를 1명 이상 선택해주세요.');
          return;
        }
        const designerDurations = designerIds
          .filter((id) => settings.picked[id] !== settings.duration)
          .map((id) => ({ designer_id: id, duration_minutes: settings.picked[id] }));
        const designerPrices = designerIds
          .filter((id) => (settings.pickedPrice[id] ?? price) !== price)
          .map((id) => ({ designer_id: id, base_price: settings.pickedPrice[id] ?? price }));
        designerFields = { designer_ids: designerIds, designer_durations: designerDurations, designer_prices: designerPrices };
      } else {
        // 체크 해제 = 전체 디자이너가 동일한 정상가·소요시간으로 이 디자인을 함(오버라이드 없음).
        designerFields = { designer_ids: designers.map((dz) => dz.id), designer_durations: [], designer_prices: [] };
      }
    } else {
      if (designers.length === 0) {
        setFormError('먼저 디자이너 탭에서 디자이너를 등록해주세요.');
        return;
      }
      designerFields = { designer_ids: [designers[0].id], designer_durations: [], designer_prices: [] };
    }

    const imageKeys = photos.filter((p) => p.status === 'done' && p.objectKey).map((p) => p.objectKey!);

    setSubmitting(true);
    try {
      // 이미 디자인 생성까지는 성공했던 재시도라면 새로 만들지 않고 같은 디자인에 이어서 진행.
      let designId = createdIdRef.current;
      if (!designId) {
        const created = await designsApi.createDesign({
          title: effectiveTitle,
          description: settings.description.trim() || null,
          base_price: price,
          // 이달의 아트 인트로가 입력란은 지금 숨겨져 있지만, 값 자체를 null로 두지 않고
          // 정상가와 같은 값으로 채워둔다 — 나중에 그 입력란을 다시 노출했을 때
          // "정상가와 같은 값에서 시작해 다르게 바꿀 수 있는" 자연스러운 상태가 되도록.
          intro_price: price,
          duration_minutes: clampDuration(settings.duration),
          folder_id: defaultFolderId || null,
          image_upload_keys: imageKeys,
          owner_tags: settings.tags,
          ...designerFields,
        });
        designId = created.id;
        createdIdRef.current = designId;
      }
      if (defaultFolderId) saveBulkSettings(`snail_bulk_settings:${defaultFolderId}`, settings);
      onCreated();
      onClose();
    } catch (e) {
      setFormError(toUserMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={submitting ? undefined : onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-heading-md font-bold text-primary">새 디자인 등록</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-neutral-100 text-primary-50 disabled:opacity-50"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {pickThumbFrom ? (
          <div className="mt-4 space-y-3">
            <p className="text-body-sm font-semibold text-primary">대표(썸네일) 사진을 골라주세요</p>
            <p className="text-caption text-primary-50">
              고객에게 썸네일로 노출되는 사진이에요. 고르지 않은 나머지 사진은 상세 사진으로 등록돼요.
            </p>
            <div className="flex flex-wrap gap-2">
              {pickThumbFrom.map(({ file, previewUrl }, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => choosePendingThumbnail(file)}
                  className="relative h-24 w-24 overflow-hidden rounded-md border border-neutral-200 hover:border-secondary"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={cancelPickThumbnail}
              className="rounded-md border border-neutral-300 px-4 py-2 text-body-sm font-semibold text-primary"
            >
              취소
            </button>
          </div>
        ) : cropFile ? (
          <div className="mt-4">
            <ImageCropper
              embedded
              file={cropFile}
              aspect={1}
              title="대표 사진 크롭"
              description="고객에게 썸네일로 노출되는 대표 이미지예요(정사각형). 박스를 끌어 위치를 옮기고, 우측 하단 손잡이로 크기를 조절한 뒤 확정하세요."
              onCropped={handleThumbnailCropped}
              onCancel={handleThumbnailCropCancel}
            />
          </div>
        ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="mt-4 space-y-5"
          noValidate
        >
          {/* 사진 — 첫 번째가 대표사진(수정 페이지와 동일한 구조) */}
          <div>
            <label className="mb-1 block text-caption font-semibold text-primary-50">
              사진 <span className="text-danger">*</span> 첫 번째가 대표사진
            </label>
            <div className="flex flex-wrap gap-2">
              {photos.map((p, idx) => (
                <div key={p.id} className="relative h-24 w-24 overflow-hidden rounded-md border border-neutral-200">
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
                    onClick={() => removePhoto(p.id)}
                    className="absolute right-0 top-0 bg-black/50 px-1 text-caption text-white"
                    aria-label="삭제"
                  >
                    ×
                  </button>
                  {idx !== 0 && p.status === 'done' && (
                    <button
                      type="button"
                      onClick={() => makeThumbnail(p.id)}
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

          {/* 제목 (관리용) */}
          <Field
            label="제목 (관리용 · 고객 미노출)"
            hint="폴더를 고르면 자동으로 지어집니다. 직접 고쳐도 되고, 비우면 자동 제목으로 등록돼요."
          >
            <input
              className={inputCls}
              value={title}
              onChange={(e) => {
                setTitleTouched(true);
                setTitle(e.target.value);
              }}
              placeholder={autoTitle || '제목 입력'}
            />
          </Field>

          {folderPreset && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-secondary/10 px-3 py-2 text-caption text-primary">
              <span className="flex-1">이 폴더에 저장된 이전 설정(가격·디자이너·태그 등)이 있어요.</span>
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

          {/* 정상가·소요시간·(다인샵) 디자이너별 오버라이드·설명·태그 — 수정 페이지와 동일한 필드 */}
          <DesignSettingsFields
            designers={designers}
            value={settings}
            onChange={(p) => setSettings((prev) => ({ ...prev, ...p }))}
          />

          {formError && <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">{formError}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || uploading}
              className="flex-1 rounded-md bg-secondary px-5 py-2.5 text-body-sm font-semibold text-white disabled:opacity-50"
            >
              {submitting ? '등록 중…' : uploading ? '사진 업로드 중…' : '디자인 등록'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-neutral-300 px-4 py-2.5 text-body-sm font-semibold text-primary disabled:opacity-50"
            >
              취소
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
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

function DesignCard({
  design,
  onOpen,
  quickEdit,
  onQuickEditChange,
  selected,
  onToggleSelect,
}: {
  design: Design;
  onOpen: () => void;
  // 리스트 전체에서 간편 수정이 하나만 열리도록 부모(FolderDesigns)가 관리하는 공유 상태.
  quickEdit: 'price' | 'duration' | 'tags' | null;
  onQuickEditChange: (kind: 'price' | 'duration' | 'tags' | null) => void;
  // 일괄 수정용 체크박스 — 부모(FolderDesigns)가 선택 상태를 관리한다.
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [moveErr, setMoveErr] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFolderMove, setShowFolderMove] = useState(false);
  const [folderDraft, setFolderDraft] = useState('');
  const [zoomIndex, setZoomIndex] = useState<number | null>(null); // null = 확대 뷰 닫힘
  const menuRef = useRef<HTMLDivElement>(null);

  const [priceDraft, setPriceDraft] = useState('');
  const [durationDraft, setDurationDraft] = useState(120);
  const [tagsDraft, setTagsDraft] = useState<string[]>([]);
  const [quickErr, setQuickErr] = useState<string | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const { data } = useQuery({
    queryKey: ['design', design.id],
    queryFn: () => designsApi.getDesign(design.id),
    initialData: design,
  });
  const d = data ?? design;

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
      setShowFolderMove(false);
      qc.invalidateQueries({ queryKey: ['designs'] });
      qc.invalidateQueries({ queryKey: ['design-folders'] });
      qc.invalidateQueries({ queryKey: ['design', d.id] });
    },
    onError: (e) => setMoveErr(toUserMessage(e)),
  });

  // 디자인별 공개/비공개 전환. 공개 조건(백엔드 검증): 샵 공개 + 오너 승인.
  const publish = useMutation({
    mutationFn: (visibility: 'active' | 'hidden') => designsApi.changeVisibility(d.id, { visibility }),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e) => setActionError(toUserMessage(e)),
  });

  // 점 세개 메뉴의 가격/소요시간/태그 수정 — 필드 하나만 골라 부분 저장(디자인 세부 페이지와 별개의 간편 수정).
  const updateField = useMutation({
    mutationFn: (body: {
      base_price?: number;
      intro_price?: number;
      duration_minutes?: number;
      owner_tags?: string[];
    }) => designsApi.updateDesign(d.id, body),
    onSuccess: () => {
      setQuickErr(null);
      onQuickEditChange(null);
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e) => setQuickErr(toUserMessage(e)),
  });

  // 이달의 아트 인트로가 입력란은 숨겨져 있지만, 정상가를 정상가와 같은 값으로 "따라가고" 있던
  // 디자인이라면 정상가를 바꿀 때 같이 갱신한다. 예전에 사장님이 인트로가를 다르게 넣어둔
  // 디자인(따로 관리 중)은 건드리지 않는다.
  const priceUpdateBody = (newPrice: number) => {
    const introFollows = d.intro_price == null || d.intro_price === d.base_price;
    return introFollows ? { base_price: newPrice, intro_price: newPrice } : { base_price: newPrice };
  };

  const openQuickEdit = (kind: 'price' | 'duration' | 'tags') => {
    setMenuOpen(false);
    setConfirmDel(false);
    setShowFolderMove(false);
    setQuickErr(null);
    if (kind === 'price') setPriceDraft(String(d.base_price));
    if (kind === 'duration') setDurationDraft(d.duration_minutes);
    if (kind === 'tags') setTagsDraft(d.owner_tags);
    onQuickEditChange(kind);
  };

  const zoomUrls = designImageUrls(d); // 확대 뷰에 넘길 사진 URL(대표 먼저)
  const photoCount = zoomUrls.length;

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label="일괄 수정 대상으로 선택"
          className="mt-1 h-4 w-4 shrink-0"
        />
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

        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
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
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {d.visibility === 'active' ? (
            <span className="rounded-full bg-success-bg px-2 py-0.5 text-caption font-semibold text-success">
              공개 중
            </span>
          ) : (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-caption font-semibold text-primary-50">
              비공개
            </span>
          )}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="디자인 설정"
              aria-expanded={menuOpen}
              className="grid h-8 w-8 place-items-center rounded-md text-body-sm font-bold text-primary hover:bg-neutral-100"
            >
              ⋮
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-10 min-w-[7.5rem] rounded-md border border-neutral-200 bg-white p-1.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    publish.mutate(d.visibility === 'active' ? 'hidden' : 'active');
                  }}
                  disabled={publish.isPending}
                  className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-primary hover:bg-neutral-50 disabled:opacity-50"
                >
                  {d.visibility === 'active' ? '비공개로 전환' : '앱에 공개'}
                </button>
                <button
                  type="button"
                  onClick={() => openQuickEdit('price')}
                  className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-primary hover:bg-neutral-50"
                >
                  가격 수정
                </button>
                <button
                  type="button"
                  onClick={() => openQuickEdit('duration')}
                  className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-primary hover:bg-neutral-50"
                >
                  소요시간 수정
                </button>
                <button
                  type="button"
                  onClick={() => openQuickEdit('tags')}
                  className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-primary hover:bg-neutral-50"
                >
                  태그 수정
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onQuickEditChange(null);
                    setMoveErr(null);
                    setFolderDraft(d.folder_id ?? '');
                    setShowFolderMove(true);
                  }}
                  className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-primary hover:bg-neutral-50"
                >
                  폴더 이동
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onQuickEditChange(null);
                    setConfirmDel(true);
                  }}
                  className="block w-full whitespace-nowrap rounded px-2 py-1 text-left text-caption text-danger/80 hover:text-danger"
                >
                  삭제
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 가격/소요시간/태그 수정 — ⋮ 메뉴에서 고른 항목 하나만 그 자리에서 편집(세부 페이지 진입 없이) */}
      {quickEdit === 'price' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateField.mutate(priceUpdateBody(Math.max(0, Math.round(Number(priceDraft)) || 0)));
          }}
          className="mt-3 space-y-2"
        >
          <label className="block text-caption font-semibold text-primary-50">정상가(원)</label>
          <input
            type="number"
            min={0}
            step={PRICE_INPUT_STEP}
            value={priceDraft}
            onChange={(e) => setPriceDraft(e.target.value)}
            autoFocus
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
          />
          {quickErr && <p className="text-caption text-danger">{quickErr}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={updateField.isPending}
              className="rounded-md bg-secondary px-4 py-2 text-caption font-semibold text-white disabled:opacity-50"
            >
              {updateField.isPending ? '저장 중…' : '저장'}
            </button>
            <button
              type="button"
              onClick={() => onQuickEditChange(null)}
              className="rounded-md border border-neutral-300 px-4 py-2 text-caption text-primary"
            >
              취소
            </button>
          </div>
        </form>
      )}

      {quickEdit === 'duration' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateField.mutate({ duration_minutes: durationDraft });
          }}
          className="mt-3 space-y-2"
        >
          <label className="block text-caption font-semibold text-primary-50">기본 소요시간(분)</label>
          <input
            type="number"
            min={DURATION_MIN}
            max={DURATION_MAX}
            step={DURATION_STEP}
            value={durationDraft}
            onChange={(e) => setDurationDraft(Number(e.target.value))}
            onBlur={(e) => setDurationDraft(clampDuration(Number(e.target.value)))}
            autoFocus
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
          />
          {quickErr && <p className="text-caption text-danger">{quickErr}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={updateField.isPending}
              className="rounded-md bg-secondary px-4 py-2 text-caption font-semibold text-white disabled:opacity-50"
            >
              {updateField.isPending ? '저장 중…' : '저장'}
            </button>
            <button
              type="button"
              onClick={() => onQuickEditChange(null)}
              className="rounded-md border border-neutral-300 px-4 py-2 text-caption text-primary"
            >
              취소
            </button>
          </div>
        </form>
      )}

      {quickEdit === 'tags' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateField.mutate({ owner_tags: tagsDraft });
          }}
          className="mt-3 space-y-2"
        >
          <label className="block text-caption font-semibold text-primary-50">사장님 태그</label>
          <TagInput tags={tagsDraft} onChange={setTagsDraft} />
          {quickErr && <p className="text-caption text-danger">{quickErr}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={updateField.isPending}
              className="rounded-md bg-secondary px-4 py-2 text-caption font-semibold text-white disabled:opacity-50"
            >
              {updateField.isPending ? '저장 중…' : '저장'}
            </button>
            <button
              type="button"
              onClick={() => onQuickEditChange(null)}
              className="rounded-md border border-neutral-300 px-4 py-2 text-caption text-primary"
            >
              취소
            </button>
          </div>
        </form>
      )}

      {/* 폴더 이동 — ⋮ 메뉴에서 연 경우에만 표시, 다른 미니 편집칸과 동일한 UI */}
      {showFolderMove && (
        <div className="mt-3 space-y-2">
          <label className="block text-caption font-semibold text-primary-50">폴더</label>
          <select
            value={folderDraft}
            onChange={(e) => setFolderDraft(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-body-sm outline-none focus:border-secondary"
            aria-label="폴더 이동"
          >
            <option value="">미분류</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {moveErr && <p className="text-caption text-danger">{moveErr}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => move.mutate(folderDraft)}
              disabled={move.isPending}
              className="rounded-md bg-secondary px-4 py-2 text-caption font-semibold text-white disabled:opacity-50"
            >
              {move.isPending ? '저장 중…' : '저장'}
            </button>
            <button
              onClick={() => setShowFolderMove(false)}
              className="rounded-md border border-neutral-300 px-4 py-2 text-caption text-primary"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 삭제 — ⋮ 메뉴에서 연 경우에만 표시 */}
      {confirmDel && (
        <div className="mt-3 inline-flex items-center gap-1.5 text-caption text-primary-50">
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
        </div>
      )}

      {actionError && <p className="mt-2 text-caption text-danger">{actionError}</p>}

      {/* 사진 확대 뷰 */}
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
  useLockBodyScroll();
  const multiDesigner = designers.length >= 2;
  const storageKey = `snail_bulk_settings:${folderId}`;
  // 파일명이 "번호_가격천원" 패턴이면 그 파일은 공통 가격이 필요 없다.
  const recognizedCount = useMemo(
    () => files.filter((f) => parseFilenamePriceInfo(f.name) !== null).length,
    [files],
  );
  // 파일명 인식 정보를 이번 등록에 실제로 쓸지 — "아니요, 직접 입력할게요"를 고르면 꺼진다.
  const [useFilenameInfo, setUseFilenameInfo] = useState(true);
  const filenameInfoActive = useFilenameInfo && recognizedCount > 0;
  const allRecognized = filenameInfoActive && recognizedCount === files.length;
  const needsSharedPrice = !allRecognized;

  const savedRef = useRef<DesignSettings | null | undefined>(undefined);
  if (savedRef.current === undefined) savedRef.current = loadBulkSettings(storageKey, designers);
  const hasSaved = !!savedRef.current;

  // 파일명 인식 → (필요시) 이전 설정 확인 → 폼, 순서로 단계를 정한다.
  const [step, setStep] = useState<'filename-confirm' | 'confirm' | 'form'>(
    recognizedCount > 0 ? 'filename-confirm' : hasSaved ? 'confirm' : 'form',
  );
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
    const price = s.price.trim() === '' ? 0 : Number(s.price);
    if (needsSharedPrice && (!Number.isFinite(price) || price < 0 || s.price.trim() === '')) {
      setErr('가격을 입력해주세요.');
      setStep('form');
      return;
    }
    let designerIds: string[];
    let designerDurations: { designer_id: string; duration_minutes: number }[] = [];
    if (multiDesigner) {
      if (s.perDesigner) {
        designerIds = Object.keys(s.picked);
        if (designerIds.length === 0) {
          setErr('디자이너를 1명 이상 선택해주세요.');
          setStep('form');
          return;
        }
        designerDurations = designerIds
          .filter((id) => s.picked[id] !== s.duration)
          .map((id) => ({ designer_id: id, duration_minutes: s.picked[id] }));
      } else {
        // 체크 해제 = 전체 디자이너가 동일한 정상가·소요시간으로 이 디자인들을 함(오버라이드 없음).
        designerIds = designers.map((dz) => dz.id);
      }
    } else {
      if (designers.length === 0) {
        setErr('먼저 디자이너 탭에서 디자이너를 등록해주세요.');
        setStep('form');
        return;
      }
      designerIds = [designers[0].id];
    }
    // 디자이너별 가격 오버라이드는 파일마다 정상가가 달라질 수 있어(파일명 인식) 디자인별로 다시 계산한다.
    const designerPricesFor = (basePrice: number) =>
      s.perDesigner
        ? designerIds
            .filter((id) => (s.pickedPrice[id] ?? basePrice) !== basePrice)
            .map((id) => ({ designer_id: id, base_price: s.pickedPrice[id] ?? basePrice }))
        : [];

    saveBulkSettings(storageKey, s);

    setProgress({ done: 0, total: files.length });
    const failed: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      // 파일명이 "번호_가격천원"(예: 01_75.jpg) 형태면 그 값으로 제목·가격을 각각 정하고,
      // 아니면 기존처럼 자동 순번 + 공통 가격으로 등록한다.
      const info = filenameInfoActive ? parseFilenamePriceInfo(files[i].name) : null;
      const title = info ? `${folderName}_${info.number}` : `${folderName}_${pad(startNumber + i)}`;
      const filePrice = info ? info.price : price;
      try {
        const up = await uploadsApi.uploadFile(files[i], 'design');
        await designsApi.createDesign({
          title,
          description: s.description.trim() || null,
          base_price: filePrice,
          // CreateForm과 동일한 이유로 정상가와 같은 값으로 채워둔다(인트로가 입력란 재노출 대비).
          intro_price: filePrice,
          duration_minutes: clampDuration(s.duration),
          designer_ids: designerIds,
          designer_durations: designerDurations,
          designer_prices: designerPricesFor(filePrice),
          folder_id: folderId,
          image_upload_keys: [up.object_key],
          owner_tags: s.tags,
        });
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
        ) : step === 'filename-confirm' ? (
          /* 파일명에서 가격 정보를 읽었을 때 그 값을 쓸지 먼저 확인 */
          <div className="mt-5 space-y-3">
            <p className="rounded-md bg-secondary/10 px-3 py-2 text-body-sm text-primary">
              사진 {files.length}장 중 {recognizedCount}장의 파일명에서 가격 정보를 읽었어요 (예: 01_75.jpg →
              75,000원). 이 정보로 등록할까요?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setStep('form')}
                className="flex-1 rounded-md bg-secondary py-2.5 text-body-sm font-semibold text-white"
              >
                예, 이 정보로 등록
              </button>
              <button
                onClick={() => {
                  setUseFilenameInfo(false);
                  setStep(hasSaved ? 'confirm' : 'form');
                }}
                className="flex-1 rounded-md border border-neutral-300 py-2.5 text-body-sm font-semibold text-primary"
              >
                아니요, 직접 입력할게요
              </button>
            </div>
            <button onClick={onClose} className="w-full py-1 text-caption text-primary-50">
              취소
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
                onClick={() => {
                  // "아니요"는 저장된 값을 안 쓰겠다는 뜻이라, 폼도 빈 상태로 시작해야 앞뒤가 맞는다.
                  setSettings(defaultBulkSettings());
                  setStep('form');
                }}
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
              priceRequired={needsSharedPrice}
              priceDisabled={allRecognized}
              priceHint={
                allRecognized
                  ? '선택한 사진 전체의 가격이 파일명에서 인식돼서, 이 입력칸은 사용되지 않아요.'
                  : filenameInfoActive
                    ? `사진 ${recognizedCount}개는 파일명에서 개별 가격이 인식됐어요. 여기 입력한 가격은 그 사진들에는 적용되지 않고(개별 가격 그대로 등록), 인식 안 된 나머지 ${files.length - recognizedCount}개에만 공통으로 적용돼요.`
                    : undefined
              }
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

/* ───────────── 디자인 세부(수정) 화면 ───────────── */

/**
 * 디자인 세부 화면 — 브레드크럼("디자인 / {폴더} / {디자인명}")으로 진입하는 전체 수정 폼.
 * 사진·제목·정상가·소요시간·(다인샵이면) 디자이너별 오버라이드·설명·태그를 한 화면에서 관리한다.
 *
 * "이달의 아트 인트로가"는 지금 입력란은 숨겨뒀지만(폴더의 "이달의 아트 지정"과 짝을 이루는 값이라
 * 별도 화면에서 다룰 예정), 값 자체를 null로 방치하지는 않는다 — 정상가를 그대로 따라가고 있던
 * 디자인(intro_price가 null이거나 base_price와 같음)이면 정상가를 바꿀 때 같이 갱신해서 항상
 * "정상가와 같은 값"에서 시작하게 하고, 예전에 사장님이 인트로가를 다르게 넣어둔 디자인은 안 건드린다.
 */
function DesignDetailForm({ design: d, onClose }: { design: Design; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(d.title);
  const [description, setDescription] = useState(d.description ?? '');
  const [price, setPrice] = useState(String(d.base_price));
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

  // "디자이너별로 다르게 적용" — 켜면 정상가/소요시간이 비활성화되고 디자이너별 목록이 열린다.
  // 이미 일부 디자이너만 배정돼 있거나 가격·시간이 서로 다르면 켜진 상태로 초기화한다.
  const [perDesignerInitialized, setPerDesignerInitialized] = useState(false);
  const [perDesigner, setPerDesigner] = useState(false);
  useEffect(() => {
    if (perDesignerInitialized || !designersQuery.isSuccess) return;
    const all = designersQuery.data ?? [];
    const differs =
      all.length >= 2 &&
      ((d.designers?.length ?? 0) !== all.length ||
        (d.designers ?? []).some(
          (dz) => dz.duration_minutes !== d.duration_minutes || dz.base_price !== d.base_price,
        ));
    setPerDesigner(differs);
    setPerDesignerInitialized(true);
  }, [perDesignerInitialized, designersQuery.isSuccess, designersQuery.data, d]);

  const toggleDesigner = (id: string) => {
    setPicked((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = clampDuration(duration);
      return next;
    });
    setPickedPrice((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = Number(price) || 0;
      return next;
    });
  };

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
      const basePriceNum = Number(price) || 0;
      let designerFields: {
        designer_ids?: string[];
        designer_durations?: { designer_id: string; duration_minutes: number }[];
        designer_prices?: { designer_id: string; base_price: number }[];
      } = {};
      if (multiDesigner) {
        if (perDesigner) {
          const designerIds = Object.keys(picked);
          // 기본값과 다른 디자이너만 오버라이드로 전송(나머지는 기본값 사용).
          const designerDurations = designerIds
            .filter((id) => picked[id] !== duration)
            .map((id) => ({ designer_id: id, duration_minutes: picked[id] }));
          const designerPrices = designerIds
            .filter((id) => (pickedPrice[id] ?? basePriceNum) !== basePriceNum)
            .map((id) => ({ designer_id: id, base_price: pickedPrice[id] ?? basePriceNum }));
          designerFields = { designer_ids: designerIds, designer_durations: designerDurations, designer_prices: designerPrices };
        } else {
          // 체크 해제 = 전체 디자이너가 동일한 정상가·소요시간으로 이 디자인을 함(오버라이드 없음).
          designerFields = { designer_ids: designers.map((dz) => dz.id), designer_durations: [], designer_prices: [] };
        }
      }

      // 이달의 아트 인트로가는 숨겨져 있지만, 정상가를 그대로 따라가고 있던 디자인이면 같이
      // 갱신한다(개별/일괄 가격 수정과 동일한 규칙). 예전에 다르게 넣어둔 경우는 안 건드린다.
      const introFollows = d.intro_price == null || d.intro_price === d.base_price;

      await designsApi.updateDesign(d.id, {
        title: title.trim(),
        description: description.trim() || null,
        base_price: basePriceNum,
        ...(introFollows ? { intro_price: basePriceNum } : {}),
        duration_minutes: clampDuration(duration),
        owner_tags: tags,
        // 사진을 바꿨을 때만 전체 세트를 전송(백엔드는 image_upload_keys를 통째로 교체).
        ...(photosDirty
          ? { image_upload_keys: photos.filter((p) => p.status === 'done').map((p) => p.key) }
          : {}),
        ...designerFields,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
      onClose();
    },
    onError: (e) => setErr(toUserMessage(e)),
  });

  const attemptSave = () => {
    if (multiDesigner && perDesigner && Object.keys(picked).length === 0) {
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

  const labelCls = 'mb-1 block text-caption font-semibold text-primary-50';
  const disabledFieldCls = 'disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-primary-50';

  return (
    <div className="space-y-5 rounded-lg border border-neutral-200 bg-white p-5">
      {/* 사진 편집 — 대표(첫 번째) + 상세. 삭제·추가·대표지정 가능 */}
      <div>
        <label className={labelCls}>사진 첫 번째가 대표사진</label>
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

      <div>
        <label className={labelCls}>제목 (관리용 · 고객 미노출)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
      </div>

      <div>
        <label className={labelCls}>정상가(원)</label>
        <input
          type="number"
          min={0}
          step={PRICE_INPUT_STEP}
          value={price}
          disabled={perDesigner}
          onChange={(e) => setPrice(e.target.value)}
          className={`${inputCls} ${disabledFieldCls}`}
        />
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
          onChange={(e) => setDuration(Number(e.target.value))}
          onBlur={(e) => setDuration(clampDuration(Number(e.target.value)))}
          className={`${inputCls} ${disabledFieldCls}`}
        />
      </div>

      {multiDesigner && (
        <div>
          <label className="flex items-center gap-2 text-body-sm text-primary">
            <input type="checkbox" checked={perDesigner} onChange={(e) => setPerDesigner(e.target.checked)} />
            디자이너별로 다르게 적용
          </label>
          {perDesigner && (
            <div className="mt-2 space-y-2">
              <p className="text-caption text-primary-50">
                체크한 디자이너만 이 디자인을 할 수 있어요. 소요시간·가격을 디자이너별로 다르게 조정할 수 있어요.
                미조정 시 기본값(소요시간 {duration}분 · 가격 {(Number(price) || 0).toLocaleString('ko-KR')}원).
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
                              onChange={(v) => setPicked((prev) => ({ ...prev, [dz.id]: clampDuration(v) }))}
                              suffix="분"
                              ariaLabel="소요시간 직접 입력"
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-caption text-primary-50">가격</span>
                            <Stepper
                              value={pickedPrice[dz.id] ?? (Number(price) || 0)}
                              onChange={(v) => setPickedPrice((prev) => ({ ...prev, [dz.id]: Math.max(0, v) }))}
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
          onChange={(e) => setDescription(e.target.value)}
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>사장님 태그</label>
        <TagInput tags={tags} onChange={setTags} />
      </div>

      {err && <p className="text-caption text-danger">{err}</p>}

      <div className="flex gap-2">
        <button
          disabled={
            !title.trim() ||
            save.isPending ||
            photoUploading ||
            (multiDesigner && perDesigner && Object.keys(picked).length === 0)
          }
          onClick={attemptSave}
          className="rounded-md bg-secondary px-4 py-2 text-body-sm font-semibold text-white disabled:opacity-50"
        >
          {save.isPending ? '저장 중…' : '저장'}
        </button>
        <button
          onClick={onClose}
          className="rounded-md border border-neutral-300 px-4 py-2 text-body-sm text-primary"
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
      <label className="mb-1 block text-caption font-semibold text-primary-50">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-caption text-primary-50">{hint}</p>}
      {error && <p className="mt-1 text-caption text-danger">{error}</p>}
    </div>
  );
}
