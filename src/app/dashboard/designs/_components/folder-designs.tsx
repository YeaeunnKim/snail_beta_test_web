'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { designersApi, designsApi } from '@/services';
import type { Design } from '@/services';
import { collectAll } from '@/lib/api-client';
import { toUserMessage } from '@/lib/error-messages';
import { useSortJobs } from '@/stores/sort-jobs';
import { nextDesignNumber } from '../design-settings';
import { BulkDropzone, BulkAddModal } from './bulk-add';
import { DesignCard } from './design-card';

export type FolderView = { label: string; folderId?: string; unfiled?: boolean };

/* ───────────── 폴더 내부 디자인 ───────────── */

export function FolderDesigns({ view, onBack }: { view: FolderView; onBack: () => void }) {
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
