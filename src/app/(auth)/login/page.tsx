'use client';

/**
 * 동작하는 로그인 레퍼런스 화면.
 *
 * 이 화면은 "백엔드 연결이 실제로 동작함"을 검증하기 위한 참조 구현이다.
 * 프론트/디자인팀은 이 흐름(react-hook-form + zod + 서비스 호출 + ApiError 처리)을
 * 패턴으로 삼아 실제 디자인으로 다시 만들면 된다.
 */
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/hooks/use-auth';
import { isApiError } from '@/lib/api-error';
import { toUserMessage } from '@/lib/error-messages';
import { resolveAuthedHome } from '@/lib/auth-routing';

const loginSchema = z.object({
  email: z.string().email('올바른 이메일 형식이 아닙니다.'),
  password: z.string().min(1, '비밀번호를 입력해주세요.'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="text-center text-body-sm text-neutral-500">불러오는 중…</p>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (values: LoginForm) => {
    setFormError(null);
    try {
      const owner = await login(values);
      // 승인 완료 + 딥링크(redirect)면 그곳으로, 아니면 인증 상태별 진입 경로로.
      const redirect = searchParams.get('redirect');
      const dest =
        owner.verification_status === 'approved' && redirect
          ? redirect
          : resolveAuthedHome(owner);
      router.replace(dest);
    } catch (e) {
      if (isApiError(e) && e.fieldErrors) {
        // 서버 필드 에러를 폼에 매핑
        for (const [field, message] of Object.entries(e.fieldErrors)) {
          setError(field as keyof LoginForm, { message });
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
      <div>
        <label className="mb-1 block text-body-sm font-medium" htmlFor="email">
          이메일
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
          {...register('email')}
        />
        {errors.email && <p className="mt-1 text-caption text-red-600">{errors.email.message}</p>}
      </div>

      <div>
        <label className="mb-1 block text-body-sm font-medium" htmlFor="password">
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-body-sm outline-none focus:border-secondary"
          {...register('password')}
        />
        {errors.password && <p className="mt-1 text-caption text-red-600">{errors.password.message}</p>}
      </div>

      {formError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-caption text-red-700">{formError}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-md bg-secondary py-2 text-body-sm font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? '로그인 중…' : '로그인'}
      </button>

      <p className="text-center text-caption text-neutral-500">
        <a href="/register" className="underline">
          회원가입
        </a>{' '}
        ·{' '}
        <a href="/password-reset" className="underline">
          비밀번호 재설정
        </a>
      </p>
    </form>
  );
}
