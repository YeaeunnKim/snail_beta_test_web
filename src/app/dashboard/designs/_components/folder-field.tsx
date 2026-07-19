'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designsApi } from '@/services';
import type { DesignFolder } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import { inputCls } from './field';

/* ───────────── 폴더 선택/만들기 ───────────── */

export function FolderField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
