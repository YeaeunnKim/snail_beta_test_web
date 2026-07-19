'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designsApi } from '@/services';
import type { Design, DesignFolder } from '@/services';
import { collectAll } from '@/lib/api-client';
import { toUserMessage } from '@/lib/error-messages';
import type { FolderView } from './folder-designs';
import { StandardsPanel } from './standards-panel';

/* ───────────── 폴더 목록 ───────────── */

export function FolderGrid({
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
  const qc = useQueryClient();
  const [shopBoardOpen, setShopBoardOpen] = useState(false);
  // 샵 전체 최빈값을 세려면 전 디자인이 필요하다(폴더 필터 없이 collectAll). 패널을 열 때만 조회한다.
  const allDesigns = useQuery({
    queryKey: ['designs', 'all'],
    queryFn: () => collectAll<Design>((cursor) => designsApi.listDesigns({ limit: 50, cursor })),
    enabled: shopBoardOpen,
  });

  if (loading) return <p className="text-body-sm text-primary-50">불러오는 중…</p>;

  return (
    <>
      <div className="mb-3 flex justify-end">
        <button
          onClick={() => setShopBoardOpen(true)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:bg-neutral-50"
        >
          ⚙ 샵 전체 기준
        </button>
      </div>
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
      {shopBoardOpen &&
        (allDesigns.isLoading ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
            <p className="rounded-lg bg-white px-4 py-3 text-body-sm text-primary">전 디자인 불러오는 중…</p>
          </div>
        ) : (
          <StandardsPanel
            scopeLabel="샵 전체"
            designs={allDesigns.data ?? []}
            onClose={() => setShopBoardOpen(false)}
            onDone={() => {
              qc.invalidateQueries({ queryKey: ['designs'] });
              qc.invalidateQueries({ queryKey: ['design-folders'] });
              // 카드별 상세 캐시도 무효화(일괄 변경 후 카드가 옛 값을 보여주지 않도록).
              qc.invalidateQueries({ queryKey: ['design'] });
              allDesigns.refetch();
            }}
          />
        ))}
    </>
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
  const [name, setName] = useState(folder.name);
  const [error, setError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: (body: { name?: string; featured_month?: string | null }) =>
      designsApi.updateFolder(folder.id, body),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ['design-folders'] });
      qc.invalidateQueries({ queryKey: ['designs'] });
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
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="폴더 이름"
            maxLength={60}
            className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-body-sm outline-none focus:border-secondary"
          />
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-caption outline-none focus:border-secondary"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                const trimmed = name.trim();
                if (!trimmed) {
                  setError('폴더 이름을 입력해 주세요.');
                  return;
                }
                update.mutate({ name: trimmed, featured_month: month || null });
              }}
              disabled={update.isPending}
              className="flex-1 rounded-md bg-secondary py-1 text-caption font-semibold text-white disabled:opacity-50"
            >
              저장
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setMonth(folder.featured_month ?? '');
                setName(folder.name);
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
            폴더 편집
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
