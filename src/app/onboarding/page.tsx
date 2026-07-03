'use client';

/**
 * 샵 등록 온보딩 (4스텝).
 *
 *  1. 기본 정보   — 샵 이름/주소/연락처/소개
 *  2. 다인샵 여부 — 1인샵/다인샵 + 디자이너 이름(앱 노출용)
 *  3. 결제 정책   — 현장결제 / 계좌이체(예약금·은행·계좌·예금주)
 *  4. 운영 시간   — 요일별 영업시간 + 휴무
 *
 * 완료 시 순차 저장: POST /shops/me → PUT /shops/me/business-hours → 디자이너 N건 생성.
 * 부분 실패 시 진행 상태(progressRef)를 기억해 재시도 시 이미 끝난 단계는 건너뛴다.
 *
 * 가드: 미인증→/login, 미승인→인증 게이트, 이미 샵 있음→/dashboard.
 *
 * NOTE: 점심/쉬는시간은 샵 영업시간 스키마(BusinessHourEntry)에 없고 디자이너 스케줄
 * (ScheduleEntry.break_*)에 속한다. 온보딩에서는 샵 영업시간/휴무만 받고, 점심·쉬는시간은
 * 5단계(시간표 관리)에서 디자이너별로 설정한다.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { designersApi, shopApi } from '@/services';
import { useAuth } from '@/hooks/use-auth';
import { isApiError } from '@/lib/api-error';
import { toUserMessage } from '@/lib/error-messages';
import { resolveAuthedHome } from '@/lib/auth-routing';
import { TIME_RE, WEEKDAYS } from '@/lib/weekday';

const onboardingSchema = z
  .object({
    // step 1
    name: z.string().min(1, '샵 이름을 입력해주세요.'),
    address: z.string().min(1, '주소를 입력해주세요.'),
    address_detail: z.string().optional(),
    region: z.string().optional(),
    phone_number: z.string().min(1, '연락처를 입력해주세요.'),
    introduction: z.string().optional(),
    // step 2
    is_multi: z.boolean(),
    designers: z.array(z.object({ name: z.string() })),
    // step 3
    payment_method: z.enum(['on_site', 'bank_transfer_guide']),
    deposit_amount: z.coerce.number().int().min(0).optional(),
    bank_name: z.string().optional(),
    bank_account_number: z.string().optional(),
    bank_account_holder: z.string().optional(),
    // step 4
    hours: z.array(
      z.object({
        weekday: z.number(),
        is_closed: z.boolean(),
        open_time: z.string().optional().or(z.literal('')),
        close_time: z.string().optional().or(z.literal('')),
      }),
    ),
  })
  .superRefine((v, ctx) => {
    // step 2: 다인샵이면 최소 1명, 모든 입력 이름은 공백 불가
    const names = v.designers.map((d) => d.name.trim());
    if (v.is_multi && names.filter(Boolean).length < 1) {
      ctx.addIssue({ code: 'custom', path: ['designers'], message: '디자이너를 1명 이상 추가해주세요.' });
    }
    v.designers.forEach((d, i) => {
      if (v.is_multi && d.name.trim() === '') {
        ctx.addIssue({ code: 'custom', path: ['designers', i, 'name'], message: '이름을 입력해주세요.' });
      }
    });

    // step 3: 계좌이체면 계좌 정보 필수
    if (v.payment_method === 'bank_transfer_guide') {
      if (!v.deposit_amount || v.deposit_amount <= 0)
        ctx.addIssue({ code: 'custom', path: ['deposit_amount'], message: '예약금을 입력해주세요.' });
      if (!v.bank_name?.trim())
        ctx.addIssue({ code: 'custom', path: ['bank_name'], message: '은행명을 입력해주세요.' });
      if (!v.bank_account_number?.trim())
        ctx.addIssue({ code: 'custom', path: ['bank_account_number'], message: '계좌번호를 입력해주세요.' });
      if (!v.bank_account_holder?.trim())
        ctx.addIssue({ code: 'custom', path: ['bank_account_holder'], message: '예금주를 입력해주세요.' });
    }

    // step 4: 영업일은 open<close 형식·순서 검증
    v.hours.forEach((h, i) => {
      if (h.is_closed) return;
      if (!h.open_time || !TIME_RE.test(h.open_time))
        ctx.addIssue({ code: 'custom', path: ['hours', i, 'open_time'], message: '시작' });
      if (!h.close_time || !TIME_RE.test(h.close_time))
        ctx.addIssue({ code: 'custom', path: ['hours', i, 'close_time'], message: '종료' });
      if (h.open_time && h.close_time && TIME_RE.test(h.open_time) && TIME_RE.test(h.close_time) && h.open_time >= h.close_time)
        ctx.addIssue({ code: 'custom', path: ['hours', i, 'close_time'], message: '종료가 시작보다 늦어야 합니다.' });
    });
  });

type OnboardingForm = z.infer<typeof onboardingSchema>;

const STEP_FIELDS: (keyof OnboardingForm)[][] = [
  ['name', 'address', 'phone_number'],
  ['is_multi', 'designers'],
  ['payment_method', 'deposit_amount', 'bank_name', 'bank_account_number', 'bank_account_holder'],
  ['hours'],
];

const STEP_TITLES = ['기본 정보', '디자이너', '결제 정책', '운영 시간'];

export default function OnboardingPage() {
  const router = useRouter();
  const { status, owner, isApproved } = useAuth();
  const [gate, setGate] = useState<'checking' | 'ready'>('checking');
  const [step, setStep] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const progressRef = useRef({ shopId: null as string | null, hoursDone: false, designersDone: false });

  const form = useForm<OnboardingForm>({
    resolver: zodResolver(onboardingSchema),
    mode: 'onTouched',
    defaultValues: {
      name: '',
      address: '',
      phone_number: '',
      is_multi: false,
      designers: [{ name: '' }],
      payment_method: 'on_site',
      hours: WEEKDAYS.map((w) => ({
        weekday: w.value,
        is_closed: false,
        open_time: '10:00',
        close_time: '20:00',
      })),
    },
  });

  const { register, handleSubmit, trigger, watch, control, formState } = form;
  const { errors, isSubmitting } = formState;
  const designerArray = useFieldArray({ control, name: 'designers' });

  const isMulti = watch('is_multi');
  const paymentMethod = watch('payment_method');
  const hours = watch('hours');

  // 가드: 인증/승인/기존 샵 확인
  useEffect(() => {
    if (status === 'idle' || status === 'loading') return;
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    if (!isApproved) {
      router.replace(resolveAuthedHome(owner));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await shopApi.getMyShop();
        // 이미 샵이 있으면 온보딩 불필요
        if (!cancelled) router.replace('/dashboard');
      } catch (e) {
        if (isApiError(e) && e.status === 404) {
          if (!cancelled) setGate('ready');
        } else if (!cancelled) {
          setSubmitError(toUserMessage(e));
          setGate('ready');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, isApproved, owner, router]);

  const next = async () => {
    const ok = await trigger(STEP_FIELDS[step]);
    if (ok) setStep((s) => Math.min(s + 1, STEP_FIELDS.length - 1));
  };
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async (values: OnboardingForm) => {
    setSubmitError(null);
    try {
      // 1) 샵 생성 (이미 생성됐으면 건너뜀)
      if (!progressRef.current.shopId) {
        const shop = await shopApi.createMyShop({
          name: values.name,
          address: values.address,
          address_detail: values.address_detail || null,
          region: values.region || null,
          phone_number: values.phone_number,
          introduction: values.introduction || null,
          payment_method: values.payment_method,
          deposit_amount: values.payment_method === 'bank_transfer_guide' ? values.deposit_amount ?? null : null,
          bank_name: values.bank_name || null,
          bank_account_number: values.bank_account_number || null,
          bank_account_holder: values.bank_account_holder || null,
          auto_accept: false,
        });
        progressRef.current.shopId = shop.id;
      }
      // 2) 영업시간 설정
      if (!progressRef.current.hoursDone) {
        await shopApi.setBusinessHours({
          entries: values.hours.map((h) => ({
            weekday: h.weekday,
            is_closed: h.is_closed,
            open_time: h.is_closed ? null : h.open_time || null,
            close_time: h.is_closed ? null : h.close_time || null,
          })),
        });
        progressRef.current.hoursDone = true;
      }
      // 3) 디자이너 생성 (이름 있는 것만)
      if (!progressRef.current.designersDone) {
        const names = (
          values.is_multi ? values.designers.map((d) => d.name) : [values.designers[0]?.name ?? '']
        )
          .map((n) => n.trim())
          .filter(Boolean);
        for (const name of names) {
          await designersApi.createDesigner({ name });
        }
        progressRef.current.designersDone = true;
      }
      router.replace('/dashboard');
    } catch (e) {
      setSubmitError(toUserMessage(e));
    }
  };

  if (gate === 'checking') {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-neutral-500">
        불러오는 중…
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="text-center text-xl font-bold text-secondary">샵 등록</h1>
        <p className="mt-1 text-center text-sm text-neutral-500">
          {step + 1} / {STEP_FIELDS.length} · {STEP_TITLES[step]}
        </p>

        {/* 스텝 인디케이터 */}
        <div className="mt-4 flex gap-1.5">
          {STEP_TITLES.map((t, i) => (
            <div
              key={t}
              className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-secondary' : 'bg-neutral-200'}`}
            />
          ))}
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-6 space-y-5 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
          noValidate
        >
          {/* STEP 1 — 기본 정보 */}
          {step === 0 && (
            <>
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
                <Field label="지역" error={errors.region?.message}>
                  <input className={inputCls} {...register('region')} />
                </Field>
                <Field label="연락처" error={errors.phone_number?.message} required>
                  <input className={inputCls} {...register('phone_number')} />
                </Field>
              </div>
              <Field label="샵 소개" error={errors.introduction?.message}>
                <textarea rows={3} className={inputCls} {...register('introduction')} />
              </Field>
            </>
          )}

          {/* STEP 2 — 다인샵 여부 + 디자이너 */}
          {step === 1 && (
            <>
              <Field label="운영 형태">
                <div className="flex gap-2">
                  <Toggle active={!isMulti} onClick={() => form.setValue('is_multi', false)}>
                    1인샵
                  </Toggle>
                  <Toggle active={isMulti} onClick={() => form.setValue('is_multi', true)}>
                    다인샵
                  </Toggle>
                </div>
              </Field>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  디자이너 이름 <span className="text-neutral-400">(앱에 노출됩니다)</span>
                </label>
                {!isMulti ? (
                  <input
                    className={inputCls}
                    placeholder="대표 디자이너 이름 (선택)"
                    {...register('designers.0.name')}
                  />
                ) : (
                  <div className="space-y-2">
                    {designerArray.fields.map((f, i) => (
                      <div key={f.id} className="flex gap-2">
                        <input
                          className={inputCls}
                          placeholder={`디자이너 ${i + 1}`}
                          {...register(`designers.${i}.name` as const)}
                        />
                        {designerArray.fields.length > 1 && (
                          <button
                            type="button"
                            onClick={() => designerArray.remove(i)}
                            className="shrink-0 rounded-md border border-neutral-300 px-3 text-sm text-neutral-500"
                          >
                            삭제
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => designerArray.append({ name: '' })}
                      className="text-sm font-medium text-secondary"
                    >
                      + 디자이너 추가
                    </button>
                  </div>
                )}
                {errors.designers?.message && (
                  <p className="mt-1 text-xs text-red-600">{errors.designers.message}</p>
                )}
              </div>
            </>
          )}

          {/* STEP 3 — 결제 정책 */}
          {step === 2 && (
            <>
              <Field label="결제 방식" error={errors.payment_method?.message} required>
                <div className="flex gap-2">
                  <Toggle
                    active={paymentMethod === 'on_site'}
                    onClick={() => form.setValue('payment_method', 'on_site')}
                  >
                    현장 결제
                  </Toggle>
                  <Toggle
                    active={paymentMethod === 'bank_transfer_guide'}
                    onClick={() => form.setValue('payment_method', 'bank_transfer_guide')}
                  >
                    계좌이체
                  </Toggle>
                </div>
              </Field>

              {paymentMethod === 'bank_transfer_guide' && (
                <div className="space-y-4 rounded-md border border-neutral-200 p-4">
                  <Field label="예약금(원)" error={errors.deposit_amount?.message} required>
                    <input type="number" min={0} className={inputCls} {...register('deposit_amount')} />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="은행명" error={errors.bank_name?.message} required>
                      <input className={inputCls} {...register('bank_name')} />
                    </Field>
                    <Field label="예금주" error={errors.bank_account_holder?.message} required>
                      <input className={inputCls} {...register('bank_account_holder')} />
                    </Field>
                  </div>
                  <Field label="계좌번호" error={errors.bank_account_number?.message} required>
                    <input className={inputCls} {...register('bank_account_number')} />
                  </Field>
                </div>
              )}
            </>
          )}

          {/* STEP 4 — 운영 시간 */}
          {step === 3 && (
            <>
              <p className="text-xs text-neutral-500">
                요일별 영업시간과 휴무를 설정하세요. 점심·쉬는시간은 디자이너별 시간표에서
                설정합니다.
              </p>
              <div className="space-y-2">
                {WEEKDAYS.map((w, i) => {
                  const closed = hours?.[i]?.is_closed;
                  return (
                    <div key={w.value} className="flex items-center gap-2">
                      <span className="w-6 text-sm font-medium">{w.label}</span>
                      <label className="flex items-center gap-1 text-xs text-neutral-500">
                        <input type="checkbox" {...register(`hours.${i}.is_closed` as const)} />
                        휴무
                      </label>
                      <input
                        type="time"
                        disabled={closed}
                        className={`${inputCls} flex-1 disabled:bg-neutral-100`}
                        {...register(`hours.${i}.open_time` as const)}
                      />
                      <span className="text-neutral-400">~</span>
                      <input
                        type="time"
                        disabled={closed}
                        className={`${inputCls} flex-1 disabled:bg-neutral-100`}
                        {...register(`hours.${i}.close_time` as const)}
                      />
                    </div>
                  );
                })}
              </div>
              {Array.isArray(errors.hours) &&
                errors.hours.some(Boolean) && (
                  <p className="text-xs text-red-600">영업일의 시작/종료 시간을 확인해주세요.</p>
                )}
            </>
          )}

          {submitError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>
          )}

          {/* 네비게이션 */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={prev}
              disabled={step === 0}
              className="rounded-md px-4 py-2 text-sm text-neutral-500 disabled:opacity-0"
            >
              이전
            </button>
            {step < STEP_FIELDS.length - 1 ? (
              <button
                type="button"
                onClick={next}
                className="rounded-md bg-secondary px-5 py-2 text-sm font-semibold text-white"
              >
                다음
              </button>
            ) : (
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-secondary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {isSubmitting ? '저장 중…' : '샵 등록 완료'}
              </button>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}

const inputCls =
  'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-secondary';

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
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
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md border px-4 py-2 text-sm font-medium ${
        active ? 'border-secondary bg-secondary text-white' : 'border-neutral-300 text-neutral-600'
      }`}
    >
      {children}
    </button>
  );
}
