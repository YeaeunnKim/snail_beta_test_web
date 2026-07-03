'use client';

/**
 * 사장님 회원가입.
 *
 * 흐름: 가입(POST /auth/owner/signup) → 같은 자격증명으로 자동 로그인 →
 *       verification_status에 따라 분기(resolveAuthedHome). 신규 가입자는
 *       보통 pending → /pending → (미제출이면) /business-verification 로 이어진다.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authApi } from '@/services';
import { useAuth } from '@/hooks/use-auth';
import { isApiError } from '@/lib/api-error';
import { toUserMessage } from '@/lib/error-messages';
import { resolveAuthedHome } from '@/lib/auth-routing';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal';

const registerSchema = z
  .object({
    email: z.string().email('올바른 이메일 형식이 아닙니다.'),
    password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.'),
    passwordConfirm: z.string(),
    representative_name: z.string().min(1, '대표자명을 입력해주세요.'),
    phone_number: z.string().min(1, '연락처를 입력해주세요.'),
    agree_terms: z.literal(true, { errorMap: () => ({ message: '이용약관에 동의해주세요.' }) }),
    agree_privacy: z.literal(true, {
      errorMap: () => ({ message: '개인정보 처리방침에 동의해주세요.' }),
    }),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    path: ['passwordConfirm'],
    message: '비밀번호가 일치하지 않습니다.',
  });

type RegisterForm = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (values: RegisterForm) => {
    setFormError(null);
    try {
      await authApi.signup({
        email: values.email,
        password: values.password,
        representative_name: values.representative_name,
        phone_number: values.phone_number,
        accepted_terms_version: TERMS_VERSION,
        accepted_privacy_version: PRIVACY_VERSION,
      });
      // 가입 직후 자동 로그인 → 상태별 진입 경로로 이동
      const owner = await login({ email: values.email, password: values.password });
      router.replace(resolveAuthedHome(owner));
    } catch (e) {
      if (isApiError(e) && e.fieldErrors) {
        for (const [field, message] of Object.entries(e.fieldErrors)) {
          setError(field as keyof RegisterForm, { message });
        }
      }
      setFormError(toUserMessage(e));
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      noValidate
    >
      <Field label="이메일" error={errors.email?.message} required>
        <input type="email" autoComplete="email" className={inputCls} {...register('email')} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="비밀번호" error={errors.password?.message} required>
          <input
            type="password"
            autoComplete="new-password"
            className={inputCls}
            {...register('password')}
          />
        </Field>
        <Field label="비밀번호 확인" error={errors.passwordConfirm?.message} required>
          <input
            type="password"
            autoComplete="new-password"
            className={inputCls}
            {...register('passwordConfirm')}
          />
        </Field>
      </div>

      <Field label="대표자명" error={errors.representative_name?.message} required>
        <input className={inputCls} {...register('representative_name')} />
      </Field>

      <Field label="연락처" error={errors.phone_number?.message} required>
        <input type="tel" autoComplete="tel" className={inputCls} {...register('phone_number')} />
      </Field>

      <div className="space-y-2 rounded-md border border-neutral-200 p-3">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" {...register('agree_terms')} />
          <span>
            [필수] 이용약관에 동의합니다.{' '}
            <span className="text-neutral-400">(v{TERMS_VERSION})</span>
          </span>
        </label>
        {errors.agree_terms && <p className="text-xs text-red-600">{errors.agree_terms.message}</p>}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" {...register('agree_privacy')} />
          <span>
            [필수] 개인정보 처리방침에 동의합니다.{' '}
            <span className="text-neutral-400">(v{PRIVACY_VERSION})</span>
          </span>
        </label>
        {errors.agree_privacy && (
          <p className="text-xs text-red-600">{errors.agree_privacy.message}</p>
        )}
      </div>

      {formError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{formError}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-md bg-secondary py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? '가입 중…' : '회원가입'}
      </button>

      <p className="text-center text-xs text-neutral-500">
        이미 계정이 있으신가요?{' '}
        <a href="/login" className="underline">
          로그인
        </a>
      </p>
    </form>
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
