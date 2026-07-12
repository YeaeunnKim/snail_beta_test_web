/**
 * 디자인 정렬 작업(백그라운드) 전역 상태 (Zustand).
 *
 * "디자인 정렬" 페이지에서 폴더 설정 후 "만들기"를 누르면, 실제 처리(업로드+디자인 생성)는
 * 이 스토어의 startJob 안에서 백그라운드로 돈다. 스토어는 모듈 싱글턴이라 화면(페이지)이
 * 언마운트되거나 다른 탭으로 이동해도 작업이 계속되고, 폴더 뷰(FolderDesigns)가 folderId로
 * 진행상황을 읽어 표시한다.
 *
 * ⚠️ 파일은 메모리에만 있으므로 "브라우저 새로고침(F5)"하면 진행 중이던(아직 안 만들어진) 나머지는
 *    사라진다. 이미 생성된 디자인은 백엔드에 저장되므로 폴더에 그대로 남는다.
 * ⚠️ 정렬(처리) 자체는 아직 mock(원본 그대로). 실제 정렬은 VM의 n8n 워크플로에 연결 예정 —
 *    startJob 루프의 TODO(정렬 백엔드/n8n) 참고.
 */
import { create } from 'zustand';
import { designsApi, uploadsApi } from '@/services';
import type { Designer } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import {
  clampDuration,
  createOptionsFor,
  saveBulkSettings,
  type DesignSettings,
} from '@/app/dashboard/designs/design-settings';

// mock 처리 속도(장당). 실제 n8n 정렬은 장당 ~1분(약 60000ms) 걸릴 수 있음.
const MOCK_MS_PER_IMAGE = 1500;

export interface SortJob {
  folderId: string;
  folderName: string;
  total: number;
  done: number; // 처리(생성 시도) 완료한 장수
  status: 'processing' | 'done' | 'error';
  failures: string[];
}

interface SortJobsState {
  jobs: Record<string, SortJob>;
  /** 폴더에 대한 정렬 처리를 백그라운드로 시작한다(사진마다 디자인 1개 생성). folderId는 이미 존재해야 한다. */
  startJob: (params: {
    folderId: string;
    folderName: string;
    startNumber: number; // 제목 번호 시작값(기존 폴더 이어붙이기 대응)
    files: File[];
    settings: DesignSettings;
    designers: Designer[];
  }) => Promise<void>;
  /** 완료된 작업 표시를 폴더 뷰에서 닫는다. */
  clearJob: (folderId: string) => void;
}

export const useSortJobs = create<SortJobsState>((set, get) => ({
  jobs: {},

  startJob: async ({ folderId, folderName, startNumber, files, settings, designers }) => {
    // 같은 폴더에 이미 처리 중이면 중복 실행 방지.
    if (get().jobs[folderId]?.status === 'processing') return;

    set((s) => ({
      jobs: {
        ...s.jobs,
        [folderId]: { folderId, folderName, total: files.length, done: 0, status: 'processing', failures: [] },
      },
    }));

    const price = Math.max(0, Number(settings.price) || 0);
    const introPrice = settings.introPrice.trim() ? Number(settings.introPrice) : null;
    const multiDesigner = designers.length >= 2;
    const designerIds = multiDesigner
      ? Object.keys(settings.picked)
      : designers.length > 0
        ? [designers[0].id]
        : [];
    // 기본값과 다른 디자이너만 오버라이드로 전송(다인샵 전용) — 새 디자인/대량 등록과 동일.
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

    const pad = (n: number) => String(n).padStart(3, '0');
    const failed: string[] = [];

    for (let i = 0; i < files.length; i += 1) {
      // ───────────────────────────────────────────────────────────
      // TODO(정렬 백엔드 / n8n): 여기서 파일 1장을 VM의 n8n 정렬 워크플로로 보내고,
      //   정렬(자동 분류·정돈)된 결과를 받아 그걸로 디자인을 만들어야 한다.
      //   예상 연결부(미정): n8n Webhook URL로 이미지(또는 object_key) POST →
      //     결과(정렬된 이미지/메타)를 받아 createDesign 에 사용.
      //   현재는 mock — 원본을 그대로 쓰고, 장당 지연만 흉내낸다(실제 ~1분/장).
      // ───────────────────────────────────────────────────────────
      await new Promise((r) => setTimeout(r, MOCK_MS_PER_IMAGE));
      const title = `${folderName}_${pad(startNumber + i)}`;
      try {
        const up = await uploadsApi.uploadFile(files[i], 'design');
        const created = await designsApi.createDesign({
          title,
          description: settings.description.trim() || null,
          base_price: price,
          intro_price: introPrice,
          duration_minutes: clampDuration(settings.duration),
          designer_ids: designerIds,
          designer_durations: designerDurations,
          designer_prices: designerPrices,
          folder_id: folderId,
          image_upload_keys: [up.object_key],
          owner_tags: settings.tags,
        });
        await createOptionsFor(created.id, settings.options);
      } catch (e) {
        failed.push(`${title}: ${toUserMessage(e)}`);
      }
      set((s) => {
        const j = s.jobs[folderId];
        if (!j) return s; // clearJob 됐으면 무시
        return { jobs: { ...s.jobs, [folderId]: { ...j, done: i + 1, failures: failed.slice() } } };
      });
    }

    // 이 폴더의 공통설정 저장 → 이후 폴더에 추가 등록 시 재사용(기존 폴더 흐름과 동일).
    saveBulkSettings(`snail_bulk_settings:${folderId}`, settings);
    set((s) => {
      const j = s.jobs[folderId];
      if (!j) return s;
      return { jobs: { ...s.jobs, [folderId]: { ...j, status: 'done', failures: failed.slice() } } };
    });
  },

  clearJob: (folderId) =>
    set((s) => {
      const next = { ...s.jobs };
      delete next[folderId];
      return { jobs: next };
    }),
}));
