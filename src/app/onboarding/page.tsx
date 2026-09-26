'use client';

/**
 * 베타 샵 설정 (첫 로그인 후).
 *
 * 받는 것: 샵 이름 · 운영 형태(1인샵/다인샵 + 디자이너 이름) · 예약금·정산 계좌(은행·예금주·계좌번호) · 지역(선택).
 * 모든 샵은 예약금을 Toss PG로 선결제받는 구조라 결제 방식 선택은 없다(payment_method는
 * 항상 bank_transfer_guide로 고정 전송).
 *   POST /shops/me → PUT /shops/me/business-hours(09:00~22:00 매일) → 디자이너 N명 생성
 *
 * 가드: 미인증→/login, 미승인→상태별 홈, 이미 샵 있음→/dashboard.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { designersApi, designsApi, shopApi } from '@/services';
import { useAuth } from '@/hooks/use-auth';
import { isApiError } from '@/lib/api-error';
import { toUserMessage } from '@/lib/error-messages';
import { resolveAuthedHome } from '@/lib/auth-routing';
import { BusinessHoursField } from '@/components/business-hours-field';
import { defaultBusinessHours, toEntries, type BusinessHoursValue } from '@/lib/business-hours';
import { useRegions } from '@/hooks/use-regions';
import { DEPOSIT_AMOUNT_MAX, DEPOSIT_AMOUNT_MAX_MESSAGE } from '@/lib/payment-policy';

const onboardingSchema = z
  .object({
    shopName: z.string().min(1, '샵 이름을 입력해주세요.'),
    isMulti: z.boolean(),
    designers: z.array(z.object({ name: z.string() })),
    depositAmount: z.coerce
      .number()
      .int()
      .min(0)
      .max(DEPOSIT_AMOUNT_MAX, DEPOSIT_AMOUNT_MAX_MESSAGE)
      .optional(),
    bankName: z.string().optional(),
    bankAccountNumber: z.string().optional(),
    bankAccountHolder: z.string().optional(),
    region: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const names = v.designers.map((d) => d.name.trim()).filter(Boolean);
    if (names.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['designers'],
        message: '디자이너를 1명 이상 입력해주세요.',
      });
    }
    if (v.isMulti) {
      v.designers.forEach((d, i) => {
        if (d.name.trim() === '')
          ctx.addIssue({
            code: 'custom',
            path: ['designers', i, 'name'],
            message: '이름을 입력해주세요.',
          });
      });
    }
    // 모든 샵이 예약금(Toss PG 선결제)을 받는다 — 결제 방식 선택 없이 항상 필수.
    if (!v.depositAmount || v.depositAmount <= 0)
      ctx.addIssue({ code: 'custom', path: ['depositAmount'], message: '예약금을 입력해주세요.' });
    if (!v.bankName?.trim()) ctx.addIssue({ code: 'custom', path: ['bankName'], message: '은행명을 입력해주세요.' });
    if (!v.bankAccountHolder?.trim())
      ctx.addIssue({ code: 'custom', path: ['bankAccountHolder'], message: '예금주를 입력해주세요.' });
    if (!v.bankAccountNumber?.trim())
      ctx.addIssue({ code: 'custom', path: ['bankAccountNumber'], message: '계좌번호를 입력해주세요.' });
  });

type OnboardingForm = z.infer<typeof onboardingSchema>;

export default function OnboardingPage() {
  const router = useRouter();
  const { status, owner, isApproved, logout } = useAuth();

  // 뒤로가기: 샵 설정을 중단하고 로그인 화면으로. (샵 미등록 상태라 그냥 이동하면
  // 가드가 다시 온보딩으로 돌려보내므로 로그아웃 후 이동한다.)
  const handleBack = () => {
    if (!window.confirm('입력한 내용이 저장되지 않고 로그인 화면으로 돌아갑니다. 계속할까요?'))
      return;
    logout();
    router.replace('/login');
  };
  const [gate, setGate] = useState<'checking' | 'ready'>('checking');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hours, setHours] = useState<BusinessHoursValue>(defaultBusinessHours());
  const progressRef = useRef({
    shopId: null as string | null,
    hoursDone: false,
    designersDone: false,
    designersCreatedCount: 0,
    foldersDone: false,
  });

  const form = useForm<OnboardingForm>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      shopName: '',
      isMulti: false,
      designers: [{ name: '' }],
      depositAmount: undefined,
      bankName: '',
      bankAccountNumber: '',
      bankAccountHolder: '',
      region: '',
    },
  });
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = form;
  const designerArray = useFieldArray({ control, name: 'designers' });
  const isMulti = watch('isMulti');
  const regionsQuery = useRegions();

  useEffect(() => {
    if (status === 'idle' || status === 'loading') return;
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    // 임시 비밀번호면 승인 여부와 무관하게 먼저 잠금을 풀어야 한다 — 아래 샵 조회부터
    // 403(`PASSWORD_CHANGE_REQUIRED`)이라 온보딩이 시작조차 되지 않는다.
    if (owner?.must_change_password) {
      router.replace('/password-change');
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

  const setMode = (multi: boolean) => {
    setValue('isMulti', multi);
    if (!multi) designerArray.replace([{ name: designerArray.fields[0]?.name ?? '' }]);
    else if (designerArray.fields.length < 2)
      designerArray.replace([{ name: designerArray.fields[0]?.name ?? '' }, { name: '' }]);
  };

  const onSubmit = async (values: OnboardingForm) => {
    setSubmitError(null);
    try {
      if (!progressRef.current.shopId) {
        // 재시도 시 이전 시도가 성공했지만 응답이 유실됐을 수 있으므로, 생성 전에
        // 이미 샵이 있는지 먼저 확인해 재사용한다(중복 생성/409 방지).
        let shop: { id: string } | undefined;
        try {
          shop = await shopApi.getMyShop();
        } catch (e) {
          if (!(isApiError(e) && e.status === 404)) throw e;
        }
        if (!shop) {
          shop = await shopApi.createMyShop({
            name: values.shopName.trim(),
            address: values.region?.trim() || '베타 테스트',
            region: values.region?.trim() || null,
            phone_number: '000-0000-0000',
            // 결제 방식은 항상 예약금 선결제(bank_transfer_guide) 고정 — 모든 샵이
            // Toss PG로 예약금을 받는다(2026-09-16 확정).
            payment_method: 'bank_transfer_guide',
            deposit_amount: values.depositAmount ?? null,
            bank_name: values.bankName?.trim() || null,
            bank_account_number: values.bankAccountNumber?.trim() || null,
            bank_account_holder: values.bankAccountHolder?.trim() || null,
            auto_accept: false,
          });
        }
        progressRef.current.shopId = shop.id;
      }
      if (!progressRef.current.hoursDone) {
        await shopApi.setBusinessHours({ entries: toEntries(hours) });
        progressRef.current.hoursDone = true;
      }
      if (!progressRef.current.designersDone) {
        const names = values.designers.map((d) => d.name.trim()).filter(Boolean);
        // 폴더 루프와 동일하게 per-item으로 진행 상황을 추적한다: 이미 생성에
        // 성공한 앞부분은 재시도 시 건너뛰어 중복 생성을 막는다.
        for (let i = progressRef.current.designersCreatedCount; i < names.length; i += 1) {
          await designersApi.createDesigner({ name: names[i] });
          progressRef.current.designersCreatedCount = i + 1;
        }
        progressRef.current.designersDone = true;
      }
      // 기본 디자인 폴더
      if (!progressRef.current.foldersDone) {
        for (const name of ['7월의 아트', '8월의 아트']) {
          try {
            await designsApi.createFolder({ name });
          } catch {
            /* 중복 등은 무시 */
          }
        }
        progressRef.current.foldersDone = true;
      }
      router.replace('/dashboard');
    } catch (e) {
      setSubmitError(toUserMessage(e));
    }
  };

  if (gate === 'checking') {
    return (
      <main className="text-body-sm text-primary-50 flex min-h-screen items-center justify-center">
        불러오는 중…
      </main>
    );
  }

  return (
    <main className="bg-surface min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        <button
          type="button"
          onClick={handleBack}
          className="text-body-sm text-primary-50 hover:text-primary mb-2 flex items-center gap-1 font-semibold"
        >
          <span className="text-lg leading-none">←</span> 뒤로
        </button>
        <h1 className="text-heading-lg text-secondary text-center font-bold">샵 설정</h1>
        <p className="text-caption text-primary-50 mt-1 text-center">
          시작하려면 아래 정보를 입력해주세요.
        </p>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-6 space-y-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
          noValidate
        >
          {/* 샵 이름 */}
          <div>
            <label className="text-body-sm mb-1 block font-medium">샵 이름</label>
            <input className={inputCls} placeholder="예: 스네일 네일" {...register('shopName')} />
            {errors.shopName && (
              <p className="text-caption text-danger mt-1">{errors.shopName.message}</p>
            )}
          </div>

          {/* 운영 형태 */}
          <div>
            <label className="text-body-sm mb-1 block font-medium">운영 형태</label>
            <div className="flex gap-2">
              <ModeToggle active={!isMulti} onClick={() => setMode(false)}>
                1인샵
              </ModeToggle>
              <ModeToggle active={isMulti} onClick={() => setMode(true)}>
                다인샵
              </ModeToggle>
            </div>
            <div className="mt-3">
              <label className="text-caption text-primary-50 mb-1 block font-semibold">
                디자이너 이름 (앱에 노출){isMulti && ` · ${designerArray.fields.length}명`}
              </label>
              {!isMulti ? (
                <input
                  className={inputCls}
                  placeholder="예: 수진"
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
                          className="text-caption text-primary-50 shrink-0 rounded-lg border border-neutral-300 px-3 font-semibold"
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => designerArray.append({ name: '' })}
                    className="text-caption text-secondary font-semibold"
                  >
                    + 디자이너 추가
                  </button>
                </div>
              )}
              {errors.designers && (
                <p className="text-caption text-danger mt-1">
                  {(errors.designers.message as string) ?? '디자이너 이름을 확인해주세요.'}
                </p>
              )}
            </div>
          </div>

          {/* 영업시간 */}
          <div>
            <label className="text-body-sm mb-1 block font-medium">영업시간</label>
            <BusinessHoursField value={hours} onChange={setHours} />
          </div>

          {/* 예약금 */}
          <div>
            <label className="mb-1 block text-body-sm font-medium">예약금(원)</label>
            <input
              type="number"
              min={0}
              max={DEPOSIT_AMOUNT_MAX}
              className={inputCls}
              placeholder="예: 20000"
              {...register('depositAmount')}
            />
            {errors.depositAmount && <p className="mt-1 text-caption text-danger">{errors.depositAmount.message}</p>}
            <p className="mt-1 text-caption text-primary-50">
              고객이 예약할 때 결제하는 예약금이에요. 앱 내 결제(Toss)로 처리되며, 사장님
              계좌로 바로 들어오지 않고 정산일에 모아서 지급돼요.
            </p>
          </div>

          {/* 정산받을 계좌 */}
          <div>
            <label className="mb-1 block text-body-sm font-medium">정산받을 계좌</label>
            <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-caption font-semibold text-primary-50">은행</label>
                  <input className={inputCls} placeholder="예: 국민" {...register('bankName')} />
                  {errors.bankName && <p className="mt-1 text-caption text-danger">{errors.bankName.message}</p>}
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-caption font-semibold text-primary-50">예금주</label>
                  <input className={inputCls} placeholder="예: 김수진" {...register('bankAccountHolder')} />
                  {errors.bankAccountHolder && (
                    <p className="mt-1 text-caption text-danger">{errors.bankAccountHolder.message}</p>
                  )}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-caption font-semibold text-primary-50">계좌번호</label>
                <input
                  inputMode="numeric"
                  className={inputCls}
                  placeholder="예: 12345678901234"
                  {...register('bankAccountNumber')}
                />
                {errors.bankAccountNumber && (
                  <p className="mt-1 text-caption text-danger">{errors.bankAccountNumber.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* 지역 — 자유입력 불가, 아래 목록에서만 선택 */}
          <div>
            <label className="text-body-sm mb-1 block font-medium">
              지역 <span className="text-primary-50">(선택)</span>
            </label>
            <select className={`${inputCls} bg-white`} {...register('region')}>
              {regionsQuery.isLoading && <option value="">지역 불러오는 중…</option>}
              {regionsQuery.isError && <option value="">지역을 불러오지 못했어요</option>}
              {regionsQuery.isSuccess && (
                <>
                  <option value="">지역 선택</option>
                  {regionsQuery.data.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>

          {submitError && (
            <p className="bg-danger-bg text-caption text-danger rounded-md px-3 py-2">
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="bg-secondary text-body-sm w-full rounded-lg py-2.5 font-semibold text-white disabled:opacity-50"
          >
            {isSubmitting ? '설정 중…' : '시작하기'}
          </button>
        </form>
      </div>
    </main>
  );
}

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-body-sm outline-none focus:border-secondary';

function ModeToggle({
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
      className={`text-body-sm flex-1 rounded-lg border px-4 py-2 font-semibold ${
        active ? 'border-secondary bg-secondary text-white' : 'text-primary border-neutral-300'
      }`}
    >
      {children}
    </button>
  );
}
