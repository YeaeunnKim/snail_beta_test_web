'use client';

/**
 * 디자인 등록/관리 — 페이지 셸.
 *
 * 폴더 목록/생성, 폴더 내부 디자인 목록, 카드 UI는 ./_components 로 분리되어 있다.
 * 이 파일은 데이터 로딩(디자이너/폴더/미분류 디자인)과 등록 폼(새 디자인/사진 다듬기)
 * 토글, 기본 폴더 시딩만 담당한다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { designersApi, designsApi } from '@/services';
import type { Design } from '@/services';
import { collectAll } from '@/lib/api-client';
import { useMyShop } from '@/hooks/use-my-shop';
import { CreateForm } from './_components/create-form';
import { RefineForm } from './_components/refine-form';
import { FolderGrid } from './_components/folder-grid';
import { FolderDesigns, type FolderView } from './_components/folder-designs';

/** 샵마다 기본으로 만들어 두는 디자인 폴더 */
const DEFAULT_FOLDERS = ['7월의 아트', '8월의 아트'];

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
