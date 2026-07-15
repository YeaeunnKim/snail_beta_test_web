'use client';

/**
 * 디자인 정렬(자동 분류) 페이지.
 *
 * 흐름:
 *  1) 사진 여러 장 업로드(드래그/선택)
 *  2) 폴더 설정:
 *     - 기존 폴더 선택  → 그 폴더의 "기본 설정"(폴더에 맨 처음 업로드할 때 저장된 설정)이 있으면
 *                        "이 설정을 적용할까요?"를 묻고, 적용/새로 입력을 고른다.
 *     - 새 폴더 생성    → 새 폴더 이름 + 설정을 새로 입력(새 디자인 등록과 동일한 필드).
 *  3) "만들기"를 누르면 → (새 폴더면 폴더 생성 후) 정렬 처리를 백그라운드로 시작하고,
 *     해당 폴더로 이동한다. 처리 중 다른 탭에 갔다 와도 그 폴더에서 진행상황이 보인다.
 *
 * ⚠️ 정렬 처리 자체는 아직 mock. 실제 정렬은 VM의 n8n에 연결 예정(stores/sort-jobs 의 TODO).
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { designersApi, designsApi } from '@/services';
import type { Design, DesignFolder } from '@/services';
import { collectAll } from '@/lib/api-client';
import { toUserMessage } from '@/lib/error-messages';
import { useMyShop } from '@/hooks/use-my-shop';
import { useSortJobs } from '@/stores/sort-jobs';
import {
  defaultBulkSettings,
  loadBulkSettings,
  DesignSettingsFields,
  type DesignSettings,
} from '../design-settings';

type FolderMode = 'existing' | 'new';

// 백엔드 POST /shops/me/designs/sort의 image_upload_keys maxItems(30)과 동일 — 업로드 시작 전 클라에서 막는다.
const MAX_SORT_PHOTOS = 30;

/** 새 폴더 기본 이름 제안: "[샵이름]_NN" (기존 같은 접두 폴더 다음 번호, 2자리). */
function suggestNewFolderName(shopName: string, folders: DesignFolder[]): string {
  const esc = shopName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc}_(\\d+)$`);
  let max = 0;
  for (const f of folders) {
    const m = f.name.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${shopName}_${String(max + 1).padStart(2, '0')}`;
}

export default function DesignSortPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const startJob = useSortJobs((s) => s.startJob);

  const { data: shop } = useMyShop();
  const designersQuery = useQuery({ queryKey: ['designers'], queryFn: () => designersApi.listDesigners() });
  const designers = useMemo(() => designersQuery.data ?? [], [designersQuery.data]);
  const foldersQuery = useQuery({ queryKey: ['design-folders'], queryFn: () => designsApi.listFolders() });
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data]);

  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<FolderMode>('new');
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [newTouched, setNewTouched] = useState(false);
  const [settings, setSettings] = useState<DesignSettings>(() => defaultBulkSettings());
  // 기존 폴더의 저장된 설정 적용 여부: null=아직 안 물음/없음, true/false=사용자 응답
  const [applyPreset, setApplyPreset] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phase: 'idle' | 'settings' = files.length === 0 ? 'idle' : 'settings';

  // 새 폴더 이름 기본 제안(사용자가 직접 안 고쳤을 때만).
  useEffect(() => {
    if (newTouched) return;
    if (!shop?.name || !foldersQuery.isSuccess) return;
    setNewFolderName(suggestNewFolderName(shop.name, folders));
  }, [shop?.name, foldersQuery.isSuccess, folders, newTouched]);

  // 선택한 기존 폴더에 저장된 설정이 있는지 확인 → 있으면 "적용할까요?" 질문 노출.
  const selectedFolder = folders.find((f) => f.id === selectedFolderId);
  const presetForSelected = useMemo(() => {
    if (mode !== 'existing' || !selectedFolderId) return null;
    return loadBulkSettings(`snail_bulk_settings:${selectedFolderId}`, designers);
  }, [mode, selectedFolderId, designers]);

  // 기존 폴더 바꾸면 질문 상태 초기화.
  useEffect(() => {
    setApplyPreset(null);
  }, [selectedFolderId, mode]);

  // 선택 폴더의 기존 디자인(제목 번호 이어붙이기용) — 기존 폴더일 때만.
  const folderDesignsQuery = useQuery({
    queryKey: ['designs', 'folder', selectedFolderId || 'none', 'for-sort'],
    queryFn: () =>
      collectAll<Design>((cursor) =>
        designsApi.listDesigns({ folder_id: selectedFolderId, limit: 50, cursor }),
      ),
    enabled: mode === 'existing' && !!selectedFolderId,
  });

  const goBack = () => router.push('/dashboard/designs');

  const onFiles = (list: FileList | null) => {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    // 업로드 시작 전 클라에서 상한 검증 — 초과 시 /sort 호출까지 가지 않고 여기서 막는다.
    if (imgs.length > MAX_SORT_PHOTOS) {
      setError(`한 번에 최대 ${MAX_SORT_PHOTOS}장까지 정렬할 수 있어요. ${imgs.length}장을 선택하셨어요 — ${MAX_SORT_PHOTOS}장 이하로 다시 선택해주세요.`);
      return;
    }
    setFiles(imgs);
    setError(null);
  };

  const applyPresetSettings = () => {
    if (presetForSelected) setSettings(presetForSelected);
    setApplyPreset(true);
  };
  const declinePreset = () => {
    setSettings(defaultBulkSettings());
    setApplyPreset(false);
  };

  const onSubmit = async () => {
    setError(null);
    // 폴더 결정
    if (mode === 'existing' && !selectedFolderId) {
      setError('폴더를 선택해주세요.');
      return;
    }
    if (mode === 'new' && !newFolderName.trim()) {
      setError('새 폴더 이름을 입력해주세요.');
      return;
    }
    // 설정 유효성 — 새 디자인/대량 등록과 동일.
    const price = Number(settings.price);
    if (settings.price.trim() === '' || !Number.isFinite(price) || price < 0) {
      setError('정상가를 입력해주세요.');
      return;
    }
    const multiDesigner = designers.length >= 2;
    if (multiDesigner) {
      if (Object.keys(settings.picked).length === 0) {
        setError('이 디자인을 할 수 있는 디자이너를 1명 이상 선택해주세요.');
        return;
      }
    } else if (designers.length === 0) {
      setError('먼저 디자이너 탭에서 디자이너를 등록해주세요.');
      return;
    }

    setStarting(true);
    try {
      let folderId: string;
      let folderName: string;
      let baseCount: number; // 정렬 시작 시점 폴더의 디자인 수(진행률 계산 기준)

      if (mode === 'new') {
        const folder = await designsApi.createFolder({ name: newFolderName.trim() });
        folderId = folder.id;
        folderName = folder.name;
        baseCount = 0;
      } else {
        folderId = selectedFolderId;
        folderName = selectedFolder?.name ?? '폴더';
        baseCount = folderDesignsQuery.data?.length ?? 0;
      }

      // 원본 업로드 → 백엔드 정렬 요청. 스토어가 들고 있어 탭 이동해도 유지 — await 하지 않는다.
      void startJob({ folderId, folderName, files, settings, designers, baseCount });
      qc.invalidateQueries({ queryKey: ['design-folders'] });
      router.push(`/dashboard/designs?folder=${folderId}`);
    } catch (e) {
      setError(toUserMessage(e));
      setStarting(false);
    }
  };

  // 기존 폴더 선택 시, 저장된 설정이 있고 아직 응답 안 했으면 만들기 막고 질문부터.
  const mustAnswerPreset = mode === 'existing' && !!presetForSelected && applyPreset === null;

  return (
    <div className="space-y-6">
      {/* 상단: 뒤로가기 + 제목 */}
      <div>
        <button
          type="button"
          onClick={goBack}
          className="mb-3 inline-flex items-center gap-1 text-body-sm font-semibold text-primary-50 hover:text-primary"
        >
          <span className="text-lg leading-none">←</span> 뒤로
        </button>
        <h1 className="text-heading-lg font-bold">디자인 정렬</h1>
        <p className="mt-1 text-body-sm text-primary-50">
          사진 여러 장을 올리고 폴더·설정을 정하면, 자동 정렬을 시작해요. 처리하는 동안 다른 작업을 해도 됩니다.
        </p>
      </div>

      {/* 1) 업로드 */}
      {phase === 'idle' && (
        <>
          <SortDropzone onFiles={onFiles} />
          {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">{error}</p>}
        </>
      )}

      {/* 2) 폴더 설정 */}
      {phase === 'settings' && (
        <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-body-sm font-semibold text-primary">폴더 · 설정</h2>
            <button
              type="button"
              onClick={() => setFiles([])}
              className="text-caption font-semibold text-primary-50 hover:text-primary"
            >
              사진 다시 고르기 ({files.length}장)
            </button>
          </div>

          {/* 폴더 선택: 기존 / 새로 */}
          <div>
            <label className="mb-1 block text-caption font-semibold text-primary-50">어디에 정렬할까요?</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode('new')}
                className={`flex-1 rounded-md border px-3 py-2 text-body-sm font-semibold ${
                  mode === 'new' ? 'border-secondary bg-secondary/5 text-secondary' : 'border-neutral-300 text-primary'
                }`}
              >
                새 폴더 만들기
              </button>
              <button
                type="button"
                onClick={() => setMode('existing')}
                className={`flex-1 rounded-md border px-3 py-2 text-body-sm font-semibold ${
                  mode === 'existing'
                    ? 'border-secondary bg-secondary/5 text-secondary'
                    : 'border-neutral-300 text-primary'
                }`}
              >
                기존 폴더 사용
              </button>
            </div>
          </div>

          {mode === 'new' ? (
            <div>
              <label className="mb-1 block text-caption font-semibold text-primary-50">새 폴더 이름</label>
              <input
                value={newFolderName}
                onChange={(e) => {
                  setNewFolderName(e.target.value);
                  setNewTouched(true);
                }}
                placeholder={shop?.name ? `${shop.name}_01` : '폴더 이름'}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
              />
              <p className="mt-1 text-caption text-primary-50">
                디자인 제목은 「{newFolderName || '폴더명'}_001」처럼 자동으로 붙어요.
              </p>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-caption font-semibold text-primary-50">폴더 선택</label>
              <select
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-body-sm outline-none focus:border-secondary"
              >
                <option value="">폴더를 선택하세요</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.design_count})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 기존 폴더의 저장된 설정 적용 질문 */}
          {mode === 'existing' && presetForSelected && applyPreset === null && (
            <div className="space-y-2 rounded-md bg-secondary/10 px-3 py-3 text-body-sm text-primary">
              <p>
                「{selectedFolder?.name}」 폴더에 저장된 <strong>기본 설정</strong>(가격·인트로가·태그·추가옵션 등)이
                있어요. 이 설정을 적용할까요?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={applyPresetSettings}
                  className="flex-1 rounded-md bg-secondary py-2 text-body-sm font-semibold text-white"
                >
                  네, 적용
                </button>
                <button
                  type="button"
                  onClick={declinePreset}
                  className="flex-1 rounded-md border border-neutral-300 py-2 text-body-sm font-semibold text-primary"
                >
                  아니요, 새로 입력
                </button>
              </div>
            </div>
          )}
          {mode === 'existing' && applyPreset === true && (
            <p className="rounded-md bg-secondary/10 px-3 py-2 text-caption text-primary">
              이 폴더의 저장된 설정을 불러왔어요. 필요하면 아래에서 수정하세요.
            </p>
          )}

          {/* 설정 입력 (질문에 답하기 전까지는 흐리게) */}
          <div className={mustAnswerPreset ? 'pointer-events-none opacity-40' : ''}>
            <p className="mb-2 rounded-md bg-neutral-50 px-3 py-2 text-caption text-primary-50">
              여기 값은 이번에 정렬되는 모든 디자인에 공통 적용돼요(등록 후 개별 수정 가능).
            </p>
            {designers.length === 0 && !designersQuery.isLoading && (
              <p className="mb-2 text-caption text-primary-50">
                등록된 디자이너가 없습니다. 디자이너 탭에서 먼저 추가하세요.
              </p>
            )}
            <div className="space-y-4">
              <DesignSettingsFields
                designers={designers}
                value={settings}
                onChange={(p) => setSettings((prev) => ({ ...prev, ...p }))}
              />
            </div>
          </div>

          {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">{error}</p>}

          <button
            type="button"
            onClick={onSubmit}
            disabled={starting || mustAnswerPreset}
            className="w-full rounded-md bg-secondary py-2.5 text-body-sm font-semibold text-white disabled:opacity-50"
          >
            {starting ? '시작하는 중…' : mustAnswerPreset ? '위 질문에 먼저 답해주세요' : `만들기 (사진 ${files.length}장)`}
          </button>
        </div>
      )}
    </div>
  );
}

/** 사진 여러 장 업로드 드롭존(컴퓨터 드래그 또는 눌러서 선택). */
function SortDropzone({ onFiles }: { onFiles: (list: FileList | null) => void }) {
  const [drag, setDrag] = useState(false);
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
        onFiles(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-10 text-center transition ${
        drag ? 'border-secondary bg-secondary/5' : 'border-neutral-300 hover:border-secondary'
      }`}
    >
      <span className="text-3xl">🖼️</span>
      <span className="text-body-sm font-semibold text-primary">사진 여러 장 올리기</span>
      <span className="text-caption text-primary-50">
        컴퓨터에서 끌어다 놓거나, 눌러서 여러 장 선택하세요. 다음 단계에서 폴더·설정을 정하면 정렬이 시작돼요.
      </span>
      <input
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}
