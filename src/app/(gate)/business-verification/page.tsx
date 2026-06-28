'use client';

/**
 * 사업자 인증 제출 / 재제출.
 *
 *  - 진입 시 GET /owners/me/business-verification 로 직전 제출 상태 조회(없으면 404).
 *  - rejected 면 반려 사유를 보여주고 재제출을 유도한다.
 *  - 제출(POST) 성공 → 내 정보 갱신 후 /pending(심사 대기)로 이동.
 *
 * NOTE(업로드 계약 미확정): 사업자등록증은 "이미 업로드된 object key"를 받는 구조인데
 * 파일 업로드(presigned URL 등) 엔드포인트가 백엔드 스펙에 아직 없다. 계약 확정 전까지
 * document_object_key 를 직접 입력받는다. 업로드 UI는 계약 확정 후 연결할 것.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ownersApi } from '@/services';
import type { BusinessVerification } from '@/services';
import { useAuth } from '@/hooks/use-auth';
import { isApiError } from '@/lib/api-error';
import { toUserMessage } from '@/lib/error-messages';

const schema = z.object({
  business_registration_number: z
    .string()
    .min(1, '사업자등록번호를 입력해주세요.')
    .regex(/^[0-9-]+$/, '숫자와 하이픈(-)만 입력해주세요.'),
  document_object_key: z.string().min(1, '등록증 파일 키를 입력해주세요.'),
});

type Form = z.infer<typeof schema>;

export default function BusinessVerificationPage() {
  const router = useRouter();
  const { owner, refreshOwner } = useAuth();
  const [loading, setLoading] = useState(true);
  const [latest, setLatest] = useState<BusinessVerification | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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

  const onSubmit = async (values: Form) => {
    setFormError(null);
    try {
      await ownersApi.submitBusinessVerification(values);
      await refreshOwner(); // verification_status 최신화
      router.replace('/pending');
    } catch (e) {
      if (isApiError(e) && e.fieldErrors) {
        for (const [field, message] of Object.entries(e.fieldErrors)) {
          setError(field as keyof Form, { message });
        }
      }
      setFormError(toUserMessage(e));
    }
  };

  if (loading) {
    return <p className="text-center text-sm text-neutral-500">불러오는 중…</p>;
  }

  return (
    <div className="space-y-5 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-bold">사업자 인증</h2>
        <p className="mt-1 text-sm text-neutral-500">
          승인 후 샵 등록·운영이 가능합니다. 사업자 정보를 제출해주세요.
        </p>
      </div>

      {/* 반려 안내 */}
      {status === 'rejected' && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">이전 제출이 반려되었습니다.</p>
          {rejectedReason && <p className="mt-1">사유: {rejectedReason}</p>}
          <p className="mt-1 text-red-700">정보를 수정해 다시 제출해주세요.</p>
        </div>
      )}

      {/* 이미 심사 중인 경우 안내 */}
      {status === 'pending' && latest && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          이미 제출된 인증이 심사 중입니다.{' '}
          <a href="/pending" className="font-semibold underline">
            대기 화면으로 이동
          </a>
        </div>
      )}

      {/* 업로드 계약 미확정 안내 */}
      <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-3 text-xs text-neutral-500">
        ⚠️ 파일 업로드 연동은 백엔드 업로드 계약 확정 후 추가됩니다. 현재는 사전 업로드된
        등록증의 <code>object key</code>를 직접 입력하세요.
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <label className="mb-1 block text-sm font-medium">
            사업자등록번호<span className="ml-0.5 text-red-500">*</span>
          </label>
          <input
            className={inputCls}
            placeholder="000-00-00000"
            {...register('business_registration_number')}
          />
          {errors.business_registration_number && (
            <p className="mt-1 text-xs text-red-600">
              {errors.business_registration_number.message}
            </p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            등록증 파일 키 (document_object_key)<span className="ml-0.5 text-red-500">*</span>
          </label>
          <input
            className={inputCls}
            placeholder="uploads/owner/.../document.png"
            {...register('document_object_key')}
          />
          {errors.document_object_key && (
            <p className="mt-1 text-xs text-red-600">{errors.document_object_key.message}</p>
          )}
        </div>

        {formError && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{formError}</p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isSubmitting ? '제출 중…' : status === 'rejected' ? '재제출' : '인증 제출'}
        </button>
      </form>
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand';
