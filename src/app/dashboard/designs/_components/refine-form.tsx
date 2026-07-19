'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { designsApi } from '@/services';
import type { Design, Designer } from '@/services';
import { collectAll } from '@/lib/api-client';
import { useSortJobs } from '@/stores/sort-jobs';
import { UploadTile } from './photo';
import { FolderField } from './folder-field';
import {
  defaultBulkSettings,
  loadBulkSettings,
  saveBulkSettings,
  DesignSettingsFields,
} from '../design-settings';
import type { DesignSettings } from '../design-settings';

/* ───────────── 사진 다듬기(구 디자인 정렬) ───────────── */

const REFINE_INSTAGRAM_URL =
  'https://www.instagram.com/s_nail_official?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==';

/**
 * "사진 다듬기" 폼. 새 디자인 등록(CreateForm)과 같은 UI/설정을 쓰되,
 *  - 다듬을 사진은 딱 1장,
 *  - 등록 대신 백엔드 정렬(sort-jobs.startJob)로 넘겨 배경/정렬을 자동 처리한다.
 * 폴더 지정 규칙은 새 디자인과 동일(FolderField: 바깥이면 직접 선택/생성, 안이면 자동지정).
 */
export function RefineForm({
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
