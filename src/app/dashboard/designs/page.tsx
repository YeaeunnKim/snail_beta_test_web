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
 *
 * 목록: 카드별 AI 분석 상태 배지(pending/in_progress면 폴링), failed 시 재분석.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designersApi, designsApi, uploadsApi } from '@/services';
import type { Design, Designer, DesignFolder } from '@/services';
import { collectAll } from '@/lib/api-client';
import { toUserMessage } from '@/lib/error-messages';
import { useMyShop } from '@/hooks/use-my-shop';

interface PhotoItem {
  id: string;
  name: string;
  previewUrl: string;
  objectKey?: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

/** 샵마다 기본으로 만들어 두는 디자인 폴더 */
const DEFAULT_FOLDERS = ['7월의 아트', '8월의 아트'];

const MAX_DETAIL_PHOTOS = 5;
const MAX_OWNER_TAGS = 10;
const TAG_MAXLEN = 40;
const DURATION_MIN = 30;
const DURATION_MAX = 600;
const DURATION_STEP = 10;

const createSchema = z.object({
  title: z.string().min(1, '제목을 입력해주세요.'),
  description: z.string().optional(),
  base_price: z.coerce.number().int().min(0, '가격을 입력해주세요.'),
  duration_minutes: z.coerce
    .number()
    .int()
    .min(DURATION_MIN, `소요시간은 ${DURATION_MIN}분 이상이어야 합니다.`)
    .max(DURATION_MAX, `소요시간은 ${DURATION_MAX}분 이하여야 합니다.`),
});
type CreateFormValues = z.infer<typeof createSchema>;

const clampDuration = (n: number) => Math.max(DURATION_MIN, Math.min(DURATION_MAX, n));

type FolderView = { label: string; folderId?: string; unfiled?: boolean };

export default function DesignsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
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

  const folders = foldersQuery.data ?? [];
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
    qc.invalidateQueries({ queryKey: ['design-folders'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading-lg font-bold">디자인 관리</h1>
          <p className="mt-1 text-body-sm text-primary-50">폴더로 정리하고, 폴더를 열어 디자인을 관리합니다.</p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-md bg-secondary px-4 py-2 text-body-sm font-semibold text-white"
        >
          {showCreate ? '닫기' : '+ 새 디자인'}
        </button>
      </div>

      {showCreate && (
        <CreateForm
          designers={designers.data ?? []}
          onCreated={() => {
            refetchAll();
            setShowCreate(false);
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

/* ───────────── 폴더 목록 ───────────── */

function FolderGrid({
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
  if (loading) return <p className="text-body-sm text-primary-50">불러오는 중…</p>;

  return (
    <div className="grid grid-cols-2 gap-3">
      {folders.map((f) => (
        <FolderCard
          key={f.id}
          name={f.name}
          count={f.design_count}
          onClick={() => onOpen({ label: f.name, folderId: f.id })}
        />
      ))}
      {unfiledCount > 0 && (
        <FolderCard name="미분류" count={unfiledCount} muted onClick={() => onOpen({ label: '미분류', unfiled: true })} />
      )}
      <NewFolderCard />
    </div>
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

function NewFolderCard() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (n: string) => designsApi.createFolder({ name: n }),
    onSuccess: () => {
      setName('');
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
          if (e.key === 'Enter' && name.trim()) create.mutate(name.trim());
          if (e.key === 'Escape') setEditing(false);
        }}
        placeholder="폴더 이름"
        maxLength={60}
        className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-body-sm outline-none focus:border-secondary"
      />
      <div className="mt-2 flex gap-1.5">
        <button
          onClick={() => name.trim() && create.mutate(name.trim())}
          disabled={create.isPending || !name.trim()}
          className="flex-1 rounded-md bg-secondary py-1.5 text-caption font-semibold text-white disabled:opacity-50"
        >
          만들기
        </button>
        <button
          onClick={() => {
            setEditing(false);
            setName('');
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

/* ───────────── 폴더 내부 디자인 ───────────── */

function FolderDesigns({ view, onBack }: { view: FolderView; onBack: () => void }) {
  const q = useQuery({
    queryKey: ['designs', view.unfiled ? 'unfiled' : 'folder', view.folderId ?? 'none'],
    queryFn: () =>
      collectAll<Design>((cursor) =>
        designsApi.listDesigns({ folder_id: view.folderId, unfiled: view.unfiled, limit: 50, cursor }),
      ),
  });
  const designs = q.data ?? [];

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

function CreateForm({ designers, onCreated }: { designers: Designer[]; onCreated: () => void }) {
  const [thumbnail, setThumbnail] = useState<PhotoItem | null>(null);
  const [details, setDetails] = useState<PhotoItem[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [folderId, setFolderId] = useState<string>(''); // '' = 폴더 없음
  // designerId → 소요시간(분). 체크된 디자이너만 들어있다.
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { duration_minutes: 120 },
  });
  const baseDuration = clampDuration(Number(watch('duration_minutes')) || DURATION_MIN);

  const uploading =
    thumbnail?.status === 'uploading' || details.some((p) => p.status === 'uploading');

  // --- 사진 업로드 헬퍼 ---
  const startUpload = (file: File, onDone: (item: PhotoItem) => void) => {
    const id = crypto.randomUUID();
    const base: PhotoItem = {
      id,
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
    };
    onDone(base);
    uploadsApi
      .uploadFile(file, 'design')
      .then((r) => updatePhoto(id, { status: 'done', objectKey: r.object_key }))
      .catch((e) => updatePhoto(id, { status: 'error', error: toUserMessage(e) }));
  };

  const updatePhoto = (id: string, patch: Partial<PhotoItem>) => {
    setThumbnail((t) => (t && t.id === id ? { ...t, ...patch } : t));
    setDetails((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const pickThumbnail = (file: File | undefined) => {
    if (!file) return;
    startUpload(file, (item) => setThumbnail(item));
  };
  const addDetails = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_DETAIL_PHOTOS - details.length;
    for (const file of Array.from(files).slice(0, room)) {
      startUpload(file, (item) => setDetails((list) => [...list, item].slice(0, MAX_DETAIL_PHOTOS)));
    }
  };
  const removeDetail = (id: string) => setDetails((list) => list.filter((it) => it.id !== id));

  // --- 디자이너 토글 ---
  const toggleDesigner = (id: string) =>
    setPicked((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = baseDuration; // 선택 시 기본 소요시간으로 시작
      return next;
    });
  const setDesignerDuration = (id: string, minutes: number) =>
    setPicked((prev) => ({ ...prev, [id]: clampDuration(minutes) }));

  const onSubmit = async (values: CreateFormValues) => {
    setFormError(null);

    if (!thumbnail || thumbnail.status !== 'done' || !thumbnail.objectKey) {
      setFormError('대표 스네일 사진 1장을 등록해주세요.');
      return;
    }
    const designerIds = Object.keys(picked);
    if (designerIds.length === 0) {
      setFormError('이 디자인을 할 수 있는 디자이너를 1명 이상 선택해주세요.');
      return;
    }
    const detailKeys = details.filter((p) => p.status === 'done' && p.objectKey).map((p) => p.objectKey!);
    // 대표 사진이 image_upload_keys[0] → 썸네일로 사용된다.
    const imageKeys = [thumbnail.objectKey, ...detailKeys];

    // 기본값과 다른 디자이너만 오버라이드로 전송(나머지는 기본 소요시간 사용).
    const designerDurations = designerIds
      .filter((id) => picked[id] !== values.duration_minutes)
      .map((id) => ({ designer_id: id, duration_minutes: picked[id] }));

    try {
      await designsApi.createDesign({
        title: values.title,
        description: values.description || null,
        base_price: values.base_price,
        duration_minutes: values.duration_minutes,
        designer_ids: designerIds,
        designer_durations: designerDurations,
        folder_id: folderId || null,
        image_upload_keys: imageKeys,
        owner_tags: tags,
      });
      onCreated();
    } catch (e) {
      setFormError(toUserMessage(e));
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-5 rounded-lg border border-neutral-200 bg-white p-5"
      noValidate
    >
      <h2 className="text-body-sm font-semibold text-primary">새 디자인 등록</h2>

      {/* 대표 사진 */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          <label className="text-body-sm font-medium">대표 스네일 사진</label>
          <span className="text-danger">*</span>
        </div>
        <p className="mb-2 text-caption text-primary-50">
          고객에게 <strong className="text-primary-50">썸네일</strong>로 노출되는 사진입니다. 1장 필수.
        </p>
        <div className="flex flex-wrap gap-2">
          {thumbnail ? (
            <PhotoTile photo={thumbnail} onRemove={() => setThumbnail(null)} badge="대표" />
          ) : (
            <UploadTile label="대표 사진" onFiles={(f) => pickThumbnail(f?.[0])} />
          )}
        </div>
      </div>

      {/* 상세 사진 */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          <label className="text-body-sm font-medium">상세 사진</label>
          <span className="text-caption text-primary-50">선택 · 최대 {MAX_DETAIL_PHOTOS}장</span>
        </div>
        <p className="mb-2 text-caption text-primary-50">손 후기 사진 등 자유롭게 추가할 수 있어요.</p>
        <div className="flex flex-wrap gap-2">
          {details.map((p) => (
            <PhotoTile key={p.id} photo={p} onRemove={() => removeDetail(p.id)} />
          ))}
          {details.length < MAX_DETAIL_PHOTOS && (
            <UploadTile label="추가" multiple onFiles={(f) => addDetails(f)} />
          )}
        </div>
      </div>

      {/* 제목 (관리용) */}
      <Field
        label="제목 (관리용)"
        error={errors.title?.message}
        required
        hint="사장님 관리용 이름입니다. 고객에게는 노출되지 않습니다."
      >
        <input className={inputCls} {...register('title')} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="가격(원)" error={errors.base_price?.message} required>
          <input type="number" min={0} className={inputCls} {...register('base_price')} />
        </Field>
        <Field
          label="기본 소요시간(분)"
          error={errors.duration_minutes?.message}
          required
          hint="디자이너별로 아래에서 조정할 수 있어요."
        >
          <input
            type="number"
            min={DURATION_MIN}
            max={DURATION_MAX}
            step={DURATION_STEP}
            className={inputCls}
            {...register('duration_minutes')}
          />
        </Field>
      </div>

      {/* 설명 (미노출 메모) */}
      <Field label="설명 (메모)" error={errors.description?.message} hint="앱에는 노출되지 않는 내부 메모입니다.">
        <textarea rows={2} className={inputCls} {...register('description')} />
      </Field>

      {/* 폴더 */}
      <FolderField value={folderId} onChange={setFolderId} />

      {/* 디자이너 + 소요시간 */}
      <div>
        <label className="mb-1 block text-body-sm font-medium">
          가능한 디자이너<span className="ml-0.5 text-danger">*</span>
        </label>
        <p className="mb-2 text-caption text-primary-50">
          선택하면 디자이너별 소요시간을 조정할 수 있어요. 미조정 시 기본 소요시간({baseDuration}분)을 사용합니다.
        </p>
        {designers.length === 0 ? (
          <p className="text-caption text-primary-50">
            등록된 디자이너가 없습니다.{' '}
            <Link href="/dashboard/designers" className="text-secondary underline">
              디자이너
            </Link>{' '}
            탭에서 먼저 추가하세요.
          </p>
        ) : (
          <div className="space-y-2">
            {designers.map((d) => {
              const checked = d.id in picked;
              return (
                <div
                  key={d.id}
                  className={`flex flex-wrap items-center gap-3 rounded-md border p-2 ${
                    checked ? 'border-secondary/40 bg-secondary/5' : 'border-neutral-200'
                  }`}
                >
                  <label className="flex items-center gap-2 text-body-sm font-medium">
                    <input type="checkbox" checked={checked} onChange={() => toggleDesigner(d.id)} />
                    {d.name}
                  </label>
                  {checked && (
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-caption text-primary-50">소요시간</span>
                      <Stepper
                        value={picked[d.id]}
                        onChange={(v) => setDesignerDuration(d.id, v)}
                        suffix="분"
                      />
                      {picked[d.id] !== baseDuration && (
                        <span className="text-caption font-semibold text-secondary">조정됨</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 사장님 태그 */}
      <div>
        <label className="mb-1 block text-body-sm font-medium">
          사장님 태그 <span className="text-caption text-primary-50">최대 {MAX_OWNER_TAGS}개</span>
        </label>
        <TagInput tags={tags} onChange={setTags} />
      </div>

      {formError && <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">{formError}</p>}

      <button
        type="submit"
        disabled={isSubmitting || uploading}
        className="rounded-md bg-secondary px-5 py-2 text-body-sm font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? '등록 중…' : uploading ? '사진 업로드 중…' : '디자인 등록'}
      </button>
    </form>
  );
}

/* ───────────── 폴더 선택/만들기 ───────────── */

function FolderField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const foldersQuery = useQuery({
    queryKey: ['design-folders'],
    queryFn: () => designsApi.listFolders(),
  });
  const folders: DesignFolder[] = foldersQuery.data ?? [];

  const create = useMutation({
    mutationFn: (n: string) => designsApi.createFolder({ name: n }),
    onSuccess: (folder) => {
      setError(null);
      setName('');
      setCreating(false);
      qc.invalidateQueries({ queryKey: ['design-folders'] });
      onChange(folder.id);
    },
    onError: (e) => setError(toUserMessage(e)),
  });

  return (
    <div>
      <label className="mb-1 block text-body-sm font-medium">
        폴더 <span className="text-caption text-primary-50">선택</span>
      </label>
      {creating ? (
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
            onClick={() => name.trim() && create.mutate(name.trim())}
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
              setError(null);
            }}
            className="shrink-0 rounded-md border border-neutral-300 px-3 py-2 text-body-sm text-primary-50"
          >
            취소
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputCls} bg-white`}
          >
            <option value="">폴더 없음</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.design_count})
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

/* ───────────── 태그 입력(칩) ───────────── */

function TagInput({ tags, onChange }: { tags: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim().replace(/^#/, '').slice(0, TAG_MAXLEN);
    if (!v) return;
    if (tags.includes(v)) {
      setDraft('');
      return;
    }
    if (tags.length >= MAX_OWNER_TAGS) return;
    onChange([...tags, v]);
    setDraft('');
  };
  const remove = (t: string) => onChange(tags.filter((x) => x !== t));

  return (
    <div className="rounded-md border border-neutral-300 p-2 focus-within:border-secondary">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-secondary/10 py-1 pl-2.5 pr-1 text-caption text-secondary"
          >
            #{t}
            <button
              type="button"
              onClick={() => remove(t)}
              aria-label={`${t} 삭제`}
              className="grid h-4 w-4 place-items-center rounded-full text-secondary/70 hover:bg-secondary/20"
            >
              ×
            </button>
          </span>
        ))}
        {tags.length < MAX_OWNER_TAGS && (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                add();
              } else if (e.key === 'Backspace' && !draft && tags.length > 0) {
                remove(tags[tags.length - 1]);
              }
            }}
            onBlur={add}
            placeholder={tags.length === 0 ? '단어 입력 후 Enter (예: 심플)' : ''}
            maxLength={TAG_MAXLEN}
            className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-body-sm outline-none"
          />
        )}
      </div>
      <p className="mt-1 px-1 text-caption text-primary-50">
        {tags.length}/{MAX_OWNER_TAGS} · Enter로 등록, X로 삭제
      </p>
    </div>
  );
}

/* ───────────── +/- 스텝퍼 ───────────── */

function Stepper({
  value,
  onChange,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  // 직접 입력용 로컬 문자열 상태. +/- 또는 외부 값 변경 시 동기화하고, 입력은 blur/Enter에 확정한다.
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const n = parseInt(text, 10);
    if (Number.isFinite(n)) onChange(n);
    else setText(String(value));
  };

  return (
    <div className="flex items-center rounded-md border border-neutral-300">
      <button
        type="button"
        onClick={() => onChange(value - DURATION_STEP)}
        className="grid h-8 w-8 place-items-center text-primary-50 hover:bg-neutral-100"
        aria-label="감소"
      >
        −
      </button>
      <div className="flex items-center">
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-10 bg-transparent text-center text-body-sm tabular-nums outline-none"
          aria-label="소요시간 직접 입력"
        />
        {suffix && <span className="pr-1.5 text-body-sm text-primary-50">{suffix}</span>}
      </div>
      <button
        type="button"
        onClick={() => onChange(value + DURATION_STEP)}
        className="grid h-8 w-8 place-items-center text-primary-50 hover:bg-neutral-100"
        aria-label="증가"
      >
        +
      </button>
    </div>
  );
}

/* ───────────── 사진 타일 ───────────── */

function PhotoTile({ photo: p, onRemove, badge }: { photo: PhotoItem; onRemove: () => void; badge?: string }) {
  return (
    <div className="relative h-24 w-24 overflow-hidden rounded-md border border-neutral-200">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.previewUrl} alt={p.name} className="h-full w-full object-cover" />
      {badge && (
        <span className="absolute left-0 top-0 bg-secondary px-1.5 py-0.5 text-caption font-semibold text-white">
          {badge}
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
        onClick={onRemove}
        className="absolute right-0 top-0 bg-black/50 px-1 text-caption text-white"
        aria-label="삭제"
      >
        ×
      </button>
    </div>
  );
}

function UploadTile({
  label,
  multiple,
  onFiles,
}: {
  label: string;
  multiple?: boolean;
  onFiles: (files: FileList | null) => void;
}) {
  return (
    <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-neutral-300 text-primary-50 hover:border-secondary">
      <span className="text-2xl leading-none">+</span>
      <span className="mt-1 text-caption">{label}</span>
      <input
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/* ───────────── 디자인 카드 ───────────── */

function DesignCard({ design }: { design: Design }) {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPhotos, setShowPhotos] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const { data } = useQuery({
    queryKey: ['design', design.id],
    queryFn: () => designsApi.getDesign(design.id),
    initialData: design,
    refetchInterval: (q) => {
      const s = q.state.data?.ai_analysis_status;
      return s === 'pending' || s === 'in_progress' ? 3000 : false;
    },
  });
  const d = data ?? design;

  const reanalyze = useMutation({
    mutationFn: () => designsApi.reanalyze(d.id),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['design', d.id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
    },
    onError: (e) => setActionError(toUserMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => designsApi.deleteDesign(d.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['designs'] });
      qc.invalidateQueries({ queryKey: ['design-folders'] });
    },
    onError: (e) => setActionError(toUserMessage(e)),
  });

  const images = d.images ?? [];
  const photoCount = images.length || (d.thumbnail_url ? 1 : 0);

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start gap-3">
        {/* 대표 사진 — 클릭 시 상세 사진 펼침 */}
        <button
          type="button"
          onClick={() => setShowPhotos((v) => !v)}
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-neutral-200"
          title="사진 보기"
        >
          {d.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.thumbnail_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="block h-full w-full bg-neutral-100" />
          )}
          <span className="absolute inset-x-0 bottom-0 bg-black/40 py-0.5 text-center text-caption font-semibold text-white">
            {showPhotos ? '접기' : `사진 ${photoCount}`}
          </span>
        </button>

        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{d.title}</p>
            <p className="mt-0.5 text-body-sm text-primary-50">
              {d.base_price.toLocaleString('ko-KR')}원 · 기본 {d.duration_minutes}분
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
          </div>

          {!editing && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => {
                  setEditing(true);
                  setConfirmDel(false);
                  setActionError(null);
                }}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary hover:bg-neutral-50"
              >
                수정
              </button>
              {confirmDel ? (
                <span className="inline-flex items-center gap-1.5 text-caption text-primary-50">
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
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDel(true)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary-50 hover:bg-neutral-50"
                >
                  삭제
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 상세 사진 */}
      {showPhotos && (
        <div className="mt-3">
          {images.length === 0 ? (
            <p className="text-caption text-primary-50">등록된 사진이 없어요.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={img.id}
                  src={img.original_url}
                  alt=""
                  className={`h-20 w-20 rounded-xl border object-cover ${
                    img.is_thumbnail ? 'border-secondary' : 'border-neutral-200'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {d.ai_analysis_status === 'failed' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="rounded-md bg-danger-bg p-2 text-caption text-danger">
            {d.ai_error_message ?? 'AI 분석에 실패했습니다.'}
          </div>
          {!editing && (
            <button
              onClick={() => reanalyze.mutate()}
              disabled={reanalyze.isPending}
              className="rounded-md bg-secondary px-3 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
            >
              {reanalyze.isPending ? '요청 중…' : '재분석'}
            </button>
          )}
        </div>
      )}

      {editing && <DesignEditForm design={d} onClose={() => setEditing(false)} />}

      {actionError && <p className="mt-2 text-caption text-danger">{actionError}</p>}
    </li>
  );
}

/* ───────────── 디자인 수정 폼 ───────────── */

function DesignEditForm({ design: d, onClose }: { design: Design; onClose: () => void }) {
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

  const toggleDesigner = (id: string) =>
    setPicked((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = duration; // 선택 시 기본 소요시간으로 시작
      return next;
    });
  const setDesignerDuration = (id: string, minutes: number) =>
    setPicked((prev) => ({ ...prev, [id]: clampDuration(minutes) }));

  const save = useMutation({
    mutationFn: () => {
      const designerIds = Object.keys(picked);
      // 기본값과 다른 디자이너만 오버라이드로 전송(나머지는 기본 소요시간 사용) — 등록 폼과 동일한 규칙.
      const designerDurations = designerIds
        .filter((id) => picked[id] !== duration)
        .map((id) => ({ designer_id: id, duration_minutes: picked[id] }));

      return designsApi.updateDesign(d.id, {
        title: title.trim(),
        description: description.trim() || null,
        base_price: Number(price) || 0,
        duration_minutes: clampDuration(duration),
        owner_tags: tags,
        ...(multiDesigner ? { designer_ids: designerIds, designer_durations: designerDurations } : {}),
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
    if (multiDesigner && Object.keys(picked).length === 0) {
      setErr('이 디자인을 할 수 있는 디자이너를 1명 이상 선택해주세요.');
      return;
    }
    setErr(null);
    save.mutate();
  };

  const inputCls =
    'w-full rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary';
  const labelCls = 'mb-1 block text-caption font-semibold text-primary-50';

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-secondary/30 bg-secondary/5 p-3">
      <div>
        <label className={labelCls}>제목 (관리용 · 고객 미노출)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
      </div>

      <div className={multiDesigner ? '' : 'flex flex-wrap gap-3'}>
        <div className={multiDesigner ? '' : 'min-w-[8rem] flex-1'}>
          <label className={labelCls}>가격(원)</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={inputCls}
          />
        </div>
        {!multiDesigner && (
          <div>
            <label className={labelCls}>기본 소요시간</label>
            <Stepper value={duration} onChange={(v) => setDuration(clampDuration(v))} suffix="분" />
          </div>
        )}
      </div>

      {/* 다인샵: 가격 아래로 줄바꿈해 디자이너별 소요시간을 노출/조정 */}
      {multiDesigner && (
        <div>
          <label className={labelCls}>디자이너별 소요시간</label>
          <p className="mb-2 text-caption text-primary-50">
            체크한 디자이너만 이 디자인을 할 수 있어요. 소요시간은 디자이너별로 다르게 조정할 수 있어요.
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
                    <div className="ml-auto flex items-center gap-2">
                      <Stepper value={picked[dz.id]} onChange={(v) => setDesignerDuration(dz.id, v)} suffix="분" />
                      {picked[dz.id] !== duration && (
                        <span className="text-caption font-semibold text-secondary">조정됨</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
          disabled={!title.trim() || save.isPending || (multiDesigner && Object.keys(picked).length === 0)}
          onClick={attemptSave}
          className="rounded-md bg-secondary px-4 py-2 text-caption font-semibold text-white disabled:opacity-50"
        >
          {save.isPending ? '저장 중…' : '저장'}
        </button>
        <button
          onClick={onClose}
          className="rounded-md bg-neutral-100 px-4 py-2 text-caption font-semibold text-primary"
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
      <label className="mb-1 block text-body-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-caption text-primary-50">{hint}</p>}
      {error && <p className="mt-1 text-caption text-danger">{error}</p>}
    </div>
  );
}
