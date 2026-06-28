'use client';

/**
 * 디자인 등록/관리.
 *
 *  - 등록 폼: 제목·가격·소요시간·디자이너·owner_tags + 사진 UI(업로드는 TODO)
 *  - 목록: 카드별 AI 분석 상태 배지. pending/in_progress면 폴링(refetchInterval).
 *  - failed 시 재분석(reanalyze) 버튼.
 *
 * TODO(업로드): 사진은 미리보기(로컬 objectURL)만 동작한다. 실제 업로드 엔드포인트
 * (presigned URL 등) 계약이 없어 image_upload_keys를 채울 수 없다. 계약 확정 시
 * PhotoPicker가 업로드 후 받은 object key를 image_upload_keys로 넘기도록 연결할 것.
 * 그 전까지는 개발용 "object key 직접 입력"으로 디자인 생성을 테스트한다.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designersApi, designsApi, uploadsApi } from '@/services';
import type { Design } from '@/services';
import { toUserMessage } from '@/lib/error-messages';

interface PhotoItem {
  id: string;
  name: string;
  previewUrl: string;
  objectKey?: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

const AI_LABEL: Record<string, string> = {
  pending: 'AI 분석 대기',
  in_progress: 'AI 분석 중',
  done: '분석 완료',
  failed: '분석 실패',
};
const AI_CLS: Record<string, string> = {
  pending: 'bg-neutral-100 text-neutral-600',
  in_progress: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

const createSchema = z.object({
  title: z.string().min(1, '제목을 입력해주세요.'),
  description: z.string().optional(),
  base_price: z.coerce.number().int().min(0, '가격을 입력해주세요.'),
  duration_minutes: z.coerce.number().int().min(1, '소요시간을 입력해주세요.'),
  designer_ids: z.array(z.string()).min(1, '디자이너를 1명 이상 선택해주세요.'),
  owner_tags: z.string().optional(),
});
type CreateForm = z.infer<typeof createSchema>;

const splitList = (s?: string) =>
  (s ?? '')
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);

export default function DesignsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const designsQuery = useQuery({
    queryKey: ['designs'],
    queryFn: () => designsApi.listDesigns(),
  });
  const designers = useQuery({
    queryKey: ['designers'],
    queryFn: () => designersApi.listDesigners(),
  });

  const designs = designsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">디자인 관리</h1>
          <p className="mt-1 text-sm text-neutral-500">디자인을 등록하면 AI가 자동 분석합니다.</p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white"
        >
          {open ? '닫기' : '+ 새 디자인'}
        </button>
      </div>

      {open && (
        <CreateForm
          designers={designers.data ?? []}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['designs'] });
            setOpen(false);
          }}
        />
      )}

      {designsQuery.isLoading ? (
        <p className="text-sm text-neutral-400">불러오는 중…</p>
      ) : designsQuery.isError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {toUserMessage(designsQuery.error)}
        </p>
      ) : designs.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          아직 등록된 디자인이 없습니다.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {designs.map((d) => (
            <DesignCard key={d.id} design={d} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateForm({ designers, onCreated }: { designers: import('@/services').Designer[]; onCreated: () => void }) {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { designer_ids: [] },
  });

  const uploading = photos.some((p) => p.status === 'uploading');

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const chosen = Array.from(files).slice(0, 5 - photos.length);
    for (const file of chosen) {
      const id = crypto.randomUUID();
      setPhotos((p) =>
        [...p, { id, name: file.name, previewUrl: URL.createObjectURL(file), status: 'uploading' as const }].slice(0, 5),
      );
      uploadsApi
        .uploadFile(file)
        .then((r) =>
          setPhotos((p) =>
            p.map((it) => (it.id === id ? { ...it, status: 'done', objectKey: r.object_key } : it)),
          ),
        )
        .catch((e) =>
          setPhotos((p) =>
            p.map((it) => (it.id === id ? { ...it, status: 'error', error: toUserMessage(e) } : it)),
          ),
        );
    }
  };
  const removePhoto = (id: string) => setPhotos((p) => p.filter((it) => it.id !== id));

  const onSubmit = async (values: CreateForm) => {
    setFormError(null);
    const keys = photos.filter((p) => p.status === 'done' && p.objectKey).map((p) => p.objectKey!);
    if (keys.length === 0) {
      setFormError('사진을 1장 이상 업로드해주세요.');
      return;
    }
    try {
      await designsApi.createDesign({
        title: values.title,
        description: values.description || null,
        base_price: values.base_price,
        duration_minutes: values.duration_minutes,
        designer_ids: values.designer_ids,
        owner_tags: splitList(values.owner_tags),
        image_upload_keys: keys,
      });
      onCreated();
    } catch (e) {
      setFormError(toUserMessage(e));
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5"
      noValidate
    >
      <h2 className="text-sm font-semibold text-neutral-700">새 디자인 등록</h2>

      {/* 사진 (업로드 TODO) */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          <label className="text-sm font-medium">사진 (최대 5장)</label>
          <span className="text-[11px] text-neutral-400">1장 이상 필요</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative h-20 w-20 overflow-hidden rounded-md border border-neutral-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.previewUrl} alt={p.name} className="h-full w-full object-cover" />
              {p.status === 'uploading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] text-white">
                  업로드 중…
                </div>
              )}
              {p.status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-600/70 px-1 text-center text-[9px] text-white">
                  실패
                </div>
              )}
              <button
                type="button"
                onClick={() => removePhoto(p.id)}
                className="absolute right-0 top-0 bg-black/50 px-1 text-xs text-white"
              >
                ×
              </button>
            </div>
          ))}
          {photos.length < 5 && (
            <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-md border border-dashed border-neutral-300 text-2xl text-neutral-400">
              +
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  addPhotos(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      </div>

      <Field label="제목" error={errors.title?.message} required>
        <input className={inputCls} {...register('title')} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="가격(원)" error={errors.base_price?.message} required>
          <input type="number" min={0} className={inputCls} {...register('base_price')} />
        </Field>
        <Field label="소요시간(분)" error={errors.duration_minutes?.message} required>
          <input type="number" min={1} className={inputCls} {...register('duration_minutes')} />
        </Field>
      </div>

      <Field label="설명" error={errors.description?.message}>
        <textarea rows={2} className={inputCls} {...register('description')} />
      </Field>

      {/* 디자이너 선택 */}
      <div>
        <label className="mb-1 block text-sm font-medium">
          디자이너<span className="ml-0.5 text-red-500">*</span>
        </label>
        {designers.length === 0 ? (
          <p className="text-xs text-neutral-500">
            등록된 디자이너가 없습니다.{' '}
            <Link href="/dashboard/designers" className="text-brand underline">
              시간표 관리
            </Link>
            에서 먼저 추가하세요.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {designers.map((d) => (
              <label key={d.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" value={d.id} {...register('designer_ids')} />
                {d.name}
              </label>
            ))}
          </div>
        )}
        {errors.designer_ids && <p className="mt-1 text-xs text-red-600">{errors.designer_ids.message}</p>}
      </div>

      <Field label="사장님 태그 (owner_tags)" error={errors.owner_tags?.message} hint="쉼표로 구분 (예: 심플, 그라데이션)">
        <input className={inputCls} {...register('owner_tags')} />
      </Field>

      {formError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}

      <button
        type="submit"
        disabled={isSubmitting || uploading}
        className="rounded-md bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? '등록 중…' : uploading ? '사진 업로드 중…' : '디자인 등록'}
      </button>
    </form>
  );
}

function DesignCard({ design }: { design: Design }) {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  // pending/in_progress면 폴링해서 최신 상태 반영
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['designs'] }),
    onError: (e) => setActionError(toUserMessage(e)),
  });

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{d.title}</p>
          <p className="mt-0.5 text-sm text-neutral-500">
            {d.base_price.toLocaleString('ko-KR')}원 · {d.duration_minutes}분
          </p>
        </div>
        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${AI_CLS[d.ai_analysis_status]}`}>
          {AI_LABEL[d.ai_analysis_status]}
          {(d.ai_analysis_status === 'pending' || d.ai_analysis_status === 'in_progress') && ' …'}
        </span>
      </div>

      {/* 태그 */}
      {(d.owner_tags.length > 0 || d.ai_tags.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {d.owner_tags.map((t) => (
            <span key={`o-${t}`} className="rounded bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
              #{t}
            </span>
          ))}
          {d.ai_analysis_status === 'done' &&
            d.ai_tags.map((t) => (
              <span key={`a-${t}`} className="rounded bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
                AI #{t}
              </span>
            ))}
        </div>
      )}

      {/* 실패 사유 + 재분석 */}
      {d.ai_analysis_status === 'failed' && (
        <div className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">
          {d.ai_error_message ?? 'AI 분석에 실패했습니다.'}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {d.ai_analysis_status === 'failed' && (
          <button
            onClick={() => reanalyze.mutate()}
            disabled={reanalyze.isPending}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {reanalyze.isPending ? '요청 중…' : '재분석'}
          </button>
        )}
        <button
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 disabled:opacity-50"
        >
          삭제
        </button>
      </div>

      {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
    </li>
  );
}

const inputCls =
  'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand';

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
      <label className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
