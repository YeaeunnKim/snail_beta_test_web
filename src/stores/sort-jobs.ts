/**
 * 디자인 정렬 작업(백그라운드) 전역 상태 (Zustand).
 *
 * "디자인 정렬" 페이지에서 폴더 설정 후 "만들기"를 누르면:
 *  1) 원본 사진들을 업로드해 object_key 를 얻고,
 *  2) 백엔드 정렬 엔드포인트(POST /shops/me/designs/sort)를 한 번 호출한다.
 * 실제 정렬(VM /process)과 디자인 생성은 백엔드가 백그라운드로 처리하므로,
 * 프론트는 폴더를 폴링(FolderDesigns의 refetchInterval)해 생성되는 디자인을 확인한다.
 *
 * 스토어는 모듈 싱글턴이라 화면이 언마운트되거나 다른 탭으로 이동해도 상태가 유지된다.
 * ⚠️ 새로고침(F5)하면 업로드 진행 중이던 나머지는 사라진다(파일이 메모리에만 있음).
 *    이미 백엔드로 넘어간 정렬 처리는 계속되고, 생성된 디자인은 폴더에 남는다.
 */
import { create } from 'zustand';
import { designsApi, uploadsApi } from '@/services';
import type { Designer } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import { clampDuration, saveBulkSettings, type DesignSettings } from '@/app/dashboard/designs/design-settings';

export interface SortJob {
  folderId: string;
  folderName: string;
  total: number; // 정렬 대상 장수
  uploaded: number; // 업로드 완료 장수(uploading 단계)
  baseCount: number; // 정렬 시작 시점 폴더의 디자인 수(진행률 계산 기준)
  status: 'uploading' | 'processing' | 'done' | 'error';
  error?: string;
}

interface SortJobsState {
  jobs: Record<string, SortJob>;
  /** 원본 업로드 → 백엔드 정렬 요청. folderId는 이미 존재해야 한다. */
  startJob: (params: {
    folderId: string;
    folderName: string;
    files: File[];
    settings: DesignSettings;
    designers: Designer[];
    baseCount: number;
  }) => Promise<void>;
  /** 폴더에 정렬 결과가 다 나타나면 완료로 표시(폴더 뷰가 폴링으로 판단 후 호출). */
  markDone: (folderId: string) => void;
  /** 완료/에러 표시를 폴더 뷰에서 닫는다. */
  clearJob: (folderId: string) => void;
}

export const useSortJobs = create<SortJobsState>((set, get) => ({
  jobs: {},

  startJob: async ({ folderId, folderName, files, settings, designers, baseCount }) => {
    const current = get().jobs[folderId]?.status;
    if (current === 'uploading' || current === 'processing') return; // 중복 실행 방지

    set((s) => ({
      jobs: {
        ...s.jobs,
        [folderId]: {
          folderId,
          folderName,
          total: files.length,
          uploaded: 0,
          baseCount,
          status: 'uploading',
        },
      },
    }));

    // 1) 원본 업로드 → object_key 확보
    const keys: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      try {
        const up = await uploadsApi.uploadFile(files[i], 'design');
        keys.push(up.object_key);
      } catch {
        /* 개별 업로드 실패는 건너뛴다(전부 실패면 아래에서 에러 처리) */
      }
      set((s) => {
        const j = s.jobs[folderId];
        if (!j) return s;
        return { jobs: { ...s.jobs, [folderId]: { ...j, uploaded: i + 1 } } };
      });
    }

    if (keys.length === 0) {
      set((s) => {
        const j = s.jobs[folderId];
        if (!j) return s;
        return {
          jobs: { ...s.jobs, [folderId]: { ...j, status: 'error', error: '이미지 업로드에 실패했어요.' } },
        };
      });
      return;
    }

    // 2) 백엔드 정렬 요청(백엔드가 VM /process 처리 후 폴더에 디자인 생성)
    const price = Math.max(0, Number(settings.price) || 0);
    const multiDesigner = designers.length >= 2;
    const designerIds = multiDesigner
      ? Object.keys(settings.picked)
      : designers.length > 0
        ? [designers[0].id]
        : [];
    try {
      // NOTE: 백엔드 /sort 는 디자이너별 개별 오버라이드/추가옵션을 받지 않는다(균일 적용).
      //   개별 시간·가격 조정과 추가옵션은 정렬 후 각 디자인 "수정"에서. (후속: /sort 에 옵션 확장)
      const res = await designsApi.sortDesigns({
        image_upload_keys: keys,
        folder_id: folderId,
        base_price: price,
        intro_price: null,
        duration_minutes: clampDuration(settings.duration),
        designer_ids: designerIds,
        owner_tags: settings.tags,
      });
      // 폴더 공통설정 저장 → 이후 이 폴더에 추가 등록 시 재사용(기존 폴더 흐름과 동일).
      saveBulkSettings(`snail_bulk_settings:${folderId}`, settings);
      set((s) => {
        const j = s.jobs[folderId];
        if (!j) return s;
        return {
          jobs: { ...s.jobs, [folderId]: { ...j, status: 'processing', total: res.count ?? keys.length } },
        };
      });
    } catch (e) {
      set((s) => {
        const j = s.jobs[folderId];
        if (!j) return s;
        return { jobs: { ...s.jobs, [folderId]: { ...j, status: 'error', error: toUserMessage(e) } } };
      });
    }
  },

  markDone: (folderId) =>
    set((s) => {
      const j = s.jobs[folderId];
      if (!j || j.status !== 'processing') return s;
      return { jobs: { ...s.jobs, [folderId]: { ...j, status: 'done' } } };
    }),

  clearJob: (folderId) =>
    set((s) => {
      const next = { ...s.jobs };
      delete next[folderId];
      return { jobs: next };
    }),
}));
