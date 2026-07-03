'use client';

/**
 * 샵 관리 — 동작하는 레퍼런스 화면.
 *
 * 보여주는 패턴:
 *  - 진입 시 GET /shops/me 로 기존 샵 조회 → 있으면 수정, 없으면(404) 생성 모드
 *  - react-hook-form + zod 검증 (비즈니스 규칙: auto_accept는 on_site에서만)
 *  - 서비스 호출(create/update) + ApiError 처리(필드 에러 매핑, 인증 게이트)
 *  - verification_status 게이트(approved 아니면 생성 차단)
 *
 * 프론트팀은 이 흐름을 토대로 영업시간/이미지 섹션과 실제 디자인을 더하면 됩니다.
 */
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { shopApi } from '@/services';
import type { Shop } from '@/services';
import { ApiError, isApiError } from '@/lib/api-error';
import { useAuth } from '@/hooks/use-auth';

const shopSchema = z
  .object({
    name: z.string().min(1, '샵 이름을 입력해주세요.'),
    address: z.string().min(1, '주소를 입력해주세요.'),
    address_detail: z.string().optional(),
    region: z.string().optional(),
    location_tags: z.string().optional(), // 쉼표 구분 입력 → 배열 변환
    phone_number: z.string().min(1, '연락처를 입력해주세요.'),
    introduction: z.string().optional(),
    payment_method: z.enum(['on_site', 'bank_transfer_guide']),
    deposit_amount: z.coerce.number().int().min(0).optional(),
    bank_name: z.string().optional(),
    bank_account_number: z.string().optional(),
    bank_account_holder: z.string().optional(),
    auto_accept: z.boolean(),
    reservation_policy: z.string().optional(),
  })
  .refine((v) => !(v.auto_accept && v.payment_method !== 'on_site'), {
    path: ['auto_accept'],
    message: '자동 수락은 현장 결제(on_site)에서만 가능합니다.',
  });

type ShopForm = z.infer<typeof shopSchema>;

function toFormValues(shop: Shop | null): Partial<ShopForm> {
  if (!shop) return { payment_method: 'on_site', auto_accept: false };
  return {
    name: shop.name,
    address: shop.address,
    address_detail: shop.address_detail ?? '',
    region: shop.region ?? '',
    location_tags: (shop.location_tags ?? []).join(', '),
    phone_number: shop.phone_number,
    introduction: shop.introduction ?? '',
    payment_method: shop.payment_method,
    deposit_amount: shop.deposit_amount ?? undefined,
    bank_name: shop.bank_name ?? '',
    bank_account_number: shop.bank_account_number ?? '',
    bank_account_holder: shop.bank_account_holder ?? '',
    auto_accept: shop.auto_accept,
    reservation_policy: shop.reservation_policy ?? '',
  };
}

function buildPayload(values: ShopForm) {
  const tags = (values.location_tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    name: values.name,
    address: values.address,
    address_detail: values.address_detail || null,
    region: values.region || null,
    location_tags: tags,
    phone_number: values.phone_number,
    introduction: values.introduction || null,
    payment_method: values.payment_method,
    deposit_amount: values.deposit_amount ?? null,
    bank_name: values.bank_name || null,
    bank_account_number: values.bank_account_number || null,
    bank_account_holder: values.bank_account_holder || null,
    auto_accept: values.auto_accept,
    reservation_policy: values.reservation_policy || null,
  };
}

export default function ShopPage() {
  const { isApproved } = useAuth();
  const [loading, setLoading] = useState(true);
  const [shop, setShop] = useState<Shop | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ShopForm>({
    resolver: zodResolver(shopSchema),
    defaultValues: { payment_method: 'on_site', auto_accept: false },
  });

  // 진입 시 기존 샵 로드. 404(SHOP_NOT_FOUND)면 생성 모드.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await shopApi.getMyShop();
        if (!cancelled) {
          setShop(data);
          reset(toFormValues(data));
        }
      } catch (e) {
        if (isApiError(e) && e.status === 404) {
          if (!cancelled) reset(toFormValues(null));
        } else if (!cancelled) {
          setFormError(isApiError(e) ? e.message : '샵 정보를 불러오지 못했습니다.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reset]);

  const isEdit = shop !== null;
  const paymentMethod = watch('payment_method');

  const onSubmit = async (values: ShopForm) => {
    setFormError(null);
    setSavedAt(null);
    const payload = buildPayload(values);
    try {
      const saved = isEdit
        ? await shopApi.updateMyShop(payload)
        : await shopApi.createMyShop(payload);
      setShop(saved);
      reset(toFormValues(saved));
      setSavedAt(new Date().toLocaleTimeString('ko-KR'));
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.fieldErrors) {
          for (const [field, message] of Object.entries(e.fieldErrors)) {
            setError(field as keyof ShopForm, { message });
          }
        }
        // 대표적 비즈니스 에러 친절 메시지
        if (e.code === 'OWNER_NOT_APPROVED') {
          setFormError('사업자 인증 승인 후 샵을 등록할 수 있습니다.');
        } else {
          setFormError(e.message);
        }
      } else {
        setFormError('저장 중 오류가 발생했습니다.');
      }
    }
  };

  if (loading) {
    return <p className="text-body-sm text-neutral-500">샵 정보를 불러오는 중…</p>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-heading-lg font-bold">샵 관리</h1>
        <p className="mt-1 text-body-sm text-neutral-500">
          {isEdit ? '샵 정보를 수정합니다.' : '아직 등록된 샵이 없습니다. 새 샵을 만들어주세요.'}
        </p>
      </div>

      {!isApproved && !isEdit && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-body-sm text-amber-800">
          사업자 인증이 승인되어야 샵을 등록할 수 있습니다. (현재 상태가 approved가 아니면 저장이 거부됩니다.)
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <Field label="샵 이름" error={errors.name?.message} required>
          <input className={inputCls} {...register('name')} />
        </Field>

        <Field label="주소" error={errors.address?.message} required>
          <input className={inputCls} {...register('address')} />
        </Field>

        <Field label="상세 주소" error={errors.address_detail?.message}>
          <input className={inputCls} {...register('address_detail')} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="지역(region)" error={errors.region?.message}>
            <input className={inputCls} {...register('region')} />
          </Field>
          <Field label="연락처" error={errors.phone_number?.message} required>
            <input className={inputCls} {...register('phone_number')} />
          </Field>
        </div>

        <Field
          label="위치 태그"
          error={errors.location_tags?.message}
          hint="쉼표로 구분 (예: 강남, 역삼)"
        >
          <input className={inputCls} {...register('location_tags')} />
        </Field>

        <Field label="샵 소개" error={errors.introduction?.message}>
          <textarea rows={3} className={inputCls} {...register('introduction')} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="결제 방식" error={errors.payment_method?.message} required>
            <select className={inputCls} {...register('payment_method')}>
              <option value="on_site">현장 결제 (on_site)</option>
              <option value="bank_transfer_guide">계좌이체 안내 (bank_transfer_guide)</option>
            </select>
          </Field>
          <Field label="예약금(원)" error={errors.deposit_amount?.message}>
            <input type="number" min={0} className={inputCls} {...register('deposit_amount')} />
          </Field>
        </div>

        {/* 계좌이체 안내일 때만 계좌 정보 노출 */}
        {paymentMethod === 'bank_transfer_guide' && (
          <div className="grid grid-cols-3 gap-4 rounded-md border border-neutral-200 p-4">
            <Field label="은행명" error={errors.bank_name?.message}>
              <input className={inputCls} {...register('bank_name')} />
            </Field>
            <Field label="계좌번호" error={errors.bank_account_number?.message}>
              <input className={inputCls} {...register('bank_account_number')} />
            </Field>
            <Field label="예금주" error={errors.bank_account_holder?.message}>
              <input className={inputCls} {...register('bank_account_holder')} />
            </Field>
          </div>
        )}

        <Field label="예약 정책" error={errors.reservation_policy?.message}>
          <textarea rows={2} className={inputCls} {...register('reservation_policy')} />
        </Field>

        <Field label="" error={errors.auto_accept?.message}>
          <label className="flex items-center gap-2 text-body-sm">
            <input type="checkbox" {...register('auto_accept')} />
            예약 자동 수락 (현장 결제에서만 가능)
          </label>
        </Field>

        {formError && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-body-sm text-red-700">{formError}</p>
        )}
        {savedAt && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-body-sm text-green-700">
            저장되었습니다. ({savedAt})
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-secondary px-5 py-2 text-body-sm font-semibold text-white disabled:opacity-50"
        >
          {isSubmitting ? '저장 중…' : isEdit ? '수정 저장' : '샵 만들기'}
        </button>
      </form>
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
      {label && (
        <label className="mb-1 block text-body-sm font-medium">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-caption text-neutral-400">{hint}</p>}
      {error && <p className="mt-1 text-caption text-red-600">{error}</p>}
    </div>
  );
}
