'use client';

/**
 * 사업자 인증 제출 / 재제출.
 *
 *  - 진입 시 GET /owners/me/business-verification 로 직전 제출 상태 조회(없으면 404).
 *  - 사업자등록증 파일을 업로드(POST /shops/me/uploads)해 object_key를 받고,
 *    사업자등록번호와 함께 제출(POST)한다.
 *  - rejected 면 반려 사유를 보여주고 재제출을 유도한다.
 *  - 제출 성공 → 내 정보 갱신 후 /pending(심사 대기)로 이동.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ownersApi, uploadsApi } from '@/services';
import type { BusinessVerification } from '@/services';
import { useAuth } from '@/hooks/use-auth';
import { isApiError } from '@/lib/api-error';
import { toUserMessage } from '@/lib/error-messages';

const schema = z.object({
  business_registration_number: z
    .string()
    .min(1, '사업자등록번호를 입력해주세요.')
    .regex(/^[0-9-]+$/, '숫자와 하이픈(-)만 입력해주세요.'),
});

type Form = z.infer<typeof schema>;

interface DocState {
  name: string;
  objectKey?: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

export default function BusinessVerificationPage() {
  const router = useRouter();
  const { owner, refreshOwner } = useAuth();
  const [loading, setLoading] = useState(true);
  const [latest, setLatest] = useState<BusinessVerification | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocState | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  // 직전 제출 내역 조회 (없으면 404 → 최초 제출)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await ownersApi.getBusinessVerification();
        if (!cancelled) setLatest(data);
      } catch (e) {
        if (!(isApiError(e) && e.status === 404) && !cancelled) {
          setFormError(toUserMessage(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const status = owner?.verification_status ?? null;
  const rejectedReason = owner?.verification_rejected_reason ?? latest?.rejected_reason ?? null;

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    setDoc({ name: file.name, status: 'uploading' });
    uploadsApi
      .uploadFile(file, 'business_license')
      .then((r) => setDoc({ name: file.name, status: 'done', objectKey: r.object_key }))
      .catch((e) => setDoc({ name: file.name, status: 'error', error: toUserMessage(e) }));
  };

  const onSubmit = async (values: Form) => {
    setFormError(null);
    if (!doc?.objectKey) {
      setFormError('사업자등록증 파일을 업로드해주세요.');
      return;
    }
    try {
      await ownersApi.submitBusinessVerification({
        business_registration_number: values.business_registration_number,
        document_object_key: doc.objectKey,
      });
      await refreshOwner(); // verification_status 최신화
      router.replace('/pending');
    } catch (e) {
      if (isApiError(e) && e.fieldErrors) {
        for (const [field, message] of Object.entries(e.fieldErrors)) {
          if (field === 'business_registration_number') setError(field, { message });
        }
      }
      setFormError(toUserMessage(e));
    }
  };

  if (loading) {
    return <p className="text-center text-body-sm text-primary-50">불러오는 중…</p>;
  }

  return (
    <div className="space-y-5 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-heading-md font-bold">사업자 인증</h2>
        <p className="mt-1 text-body-sm text-primary-50">
          승인 후 샵 등록·운영이 가능합니다. 사업자 정보를 제출해주세요.
        </p>
      </div>

      {/* 반려 안내 */}
      {status === 'rejected' && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-body-sm text-red-800">
          <p className="font-semibold">이전 제출이 반려되었습니다.</p>
          {rejectedReason && <p className="mt-1">사유: {rejectedReason}</p>}
          <p className="mt-1 text-red-700">정보를 수정해 다시 제출해주세요.</p>
        </div>
      )}

      {/* 이미 심사 중인 경우 안내 */}
      {status === 'pending' && latest && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-body-sm text-amber-800">
          이미 제출된 인증이 심사 중입니다.{' '}
          <a href="/pending" className="font-semibold underline">
            대기 화면으로 이동
          </a>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <label className="mb-1 block text-body-sm font-medium">
            사업자등록번호<span className="ml-0.5 text-red-500">*</span>
          </label>
          <input
            className={inputCls}
            placeholder="000-00-00000"
            {...register('business_registration_number')}
          />
          {errors.business_registration_number && (
            <p className="mt-1 text-caption text-red-600">
              {errors.business_registration_number.message}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-body-sm font-medium">
            사업자등록증<span className="ml-0.5 text-red-500">*</span>
          </label>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => onUpload(e.target.files?.[0])}
            className="block w-full text-body-sm text-primary file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-body-sm file:font-semibold file:text-white"
          />
          {doc && (
            <p className="mt-1 text-caption">
              {doc.status === 'uploading' && <span className="text-primary-50">업로드 중… ({doc.name})</span>}
              {doc.status === 'done' && <span className="text-green-600">업로드 완료: {doc.name}</span>}
              {doc.status === 'error' && <span className="text-red-600">{doc.error}</span>}
            </p>
          )}
        </div>

        {formError && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-caption text-red-700">{formError}</p>
        )}

        <button
          type="submit"
          disabled={isSubmitting || doc?.status === 'uploading'}
          className="w-full rounded-md bg-secondary py-2 text-body-sm font-semibold text-white disabled:opacity-50"
        >
          {isSubmitting ? '제출 중…' : status === 'rejected' ? '재제출' : '인증 제출'}
        </button>
      </form>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary';
