'use client';

/**
 * 선택된 디자인들에 삭제·폴더이동·공개·비공개를 일괄 적용한다.
 * 일괄 API가 없어 applyToMany로 요청을 N번 돈다(동시 3개). 중간 실패는 롤백하지 않고
 * "N개 완료, M개 실패" + 재시도(실패한 것만 다시)를 띄운다.
 */
import { useState } from 'react';
import { designsApi } from '@/services';
import { applyToMany, type ApplyResult } from '../_lib/apply';

type Job = { label: string; fn: (id: string) => Promise<void> };

export function BulkActionBar({
  selectedIds,
  folders,
  onDone,
  onClearSelection,
}: {
  selectedIds: string[];
  folders: { id: string; name: string }[];
  onDone: () => void;
  onClearSelection: () => void;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ApplyResult<string> | null>(null);
  const [lastJob, setLastJob] = useState<Job | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);

  const run = async (job: Job, ids: string[]) => {
    setLastJob(job);
    setResult(null);
    setProgress({ done: 0, total: ids.length });
    const r = await applyToMany(ids, job.fn, (done, total) => setProgress({ done, total }));
    setProgress(null);
    setResult(r);
    onDone();
    if (r.failed.length === 0) onClearSelection();
  };

  const del: Job = { label: '삭제', fn: (id) => designsApi.deleteDesign(id) };
  const publish: Job = {
    label: '공개',
    fn: async (id) => {
      await designsApi.changeVisibility(id, { visibility: 'active' });
    },
  };
  const hide: Job = {
    label: '비공개',
    fn: async (id) => {
      await designsApi.changeVisibility(id, { visibility: 'hidden' });
    },
  };
  const moveTo = (folderId: string): Job => ({
    label: '폴더이동',
    fn: async (id) => {
      await designsApi.updateDesign(id, { folder_id: folderId || null });
    },
  });

  const busy = progress !== null;
  const count = selectedIds.length;

  return (
    <div className="sticky bottom-0 z-10 rounded-lg border border-neutral-200 bg-white p-3 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <span className="text-body-sm font-semibold text-primary">{count}개 선택됨</span>
        <button onClick={onClearSelection} className="text-caption text-primary-50 underline">
          선택 해제
        </button>
      </div>

      {busy ? (
        <p className="mt-2 text-caption text-primary-50">
          처리 중… {progress!.done}/{progress!.total}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            onClick={() => setMoveOpen((v) => !v)}
            disabled={count === 0}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary hover:bg-neutral-50 disabled:opacity-50"
          >
            폴더이동
          </button>
          <button
            onClick={() => run(publish, selectedIds)}
            disabled={count === 0}
            className="rounded-md bg-secondary px-3 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
          >
            공개
          </button>
          <button
            onClick={() => run(hide, selectedIds)}
            disabled={count === 0}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:bg-neutral-50 disabled:opacity-50"
          >
            비공개
          </button>
          <button
            onClick={() => {
              if (window.confirm(`선택한 ${count}개 디자인을 삭제할까요? 되돌릴 수 없어요.`)) run(del, selectedIds);
            }}
            disabled={count === 0}
            className="rounded-md bg-danger-bg px-3 py-1.5 text-caption font-semibold text-danger disabled:opacity-50"
          >
            삭제
          </button>
        </div>
      )}

      {moveOpen && !busy && (
        <div className="mt-2 flex flex-wrap gap-1.5 rounded-md bg-neutral-50 p-2">
          <button
            onClick={() => {
              setMoveOpen(false);
              run(moveTo(''), selectedIds);
            }}
            className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-caption text-primary"
          >
            미분류로
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setMoveOpen(false);
                run(moveTo(f.id), selectedIds);
              }}
              className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-caption text-primary"
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      {result && result.failed.length > 0 && (
        <div className="mt-2 rounded-md bg-danger-bg p-2">
          <p className="text-caption font-semibold text-danger">
            {result.ok.length}개 완료, {result.failed.length}개 실패
          </p>
          <button
            onClick={() => lastJob && run(lastJob, result.failed.map((f) => f.target))}
            className="mt-1 rounded-md border border-danger/40 px-2.5 py-1 text-caption font-semibold text-danger"
          >
            실패한 것만 재시도
          </button>
        </div>
      )}
      {result && result.failed.length === 0 && result.ok.length > 0 && (
        <p className="mt-2 text-caption text-success">{result.ok.length}개 완료</p>
      )}
    </div>
  );
}
