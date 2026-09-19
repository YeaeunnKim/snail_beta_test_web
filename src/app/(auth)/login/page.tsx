'use client';

/**
 * 베타 로그인 — 인스타그램 아이디(또는 이메일)로 로그인.
 *
 * 입력한 인스타 핸들을 회원가입과 동일한 규칙으로 이메일(handle@beta.snail.app)로
 * 매핑해 백엔드에 로그인 요청한다. 이메일을 직접 입력하면(운영자 시드 계정 등) 그대로 사용.
 */
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/hooks/use-auth';
import { toUserMessage } from '@/lib/error-messages';
import { resolveAuthedHome } from '@/lib/auth-routing';
import { instagramToEmail } from '@/lib/beta-account';

const loginSchema = z.object({
  instagram: z.string().min(1, '인스타그램 아이디를 입력해주세요.'),
  password: z.string().min(1, '비밀번호를 입력해주세요.'),
});

type LoginForm = z.infer<typeof loginSchema>;

/**
 * ?redirect= 값의 오픈 리다이렉트 방지.
 *
 * '/'로 시작하는 내부 경로만 허용한다. '//evil.com'(프로토콜-상대 URL)이나
 * '/\evil.com'(브라우저가 //로 해석하는 백슬래시 트릭)은 외부 사이트로 튈 수 있으므로 거부한다.
 */
function safeRedirectPath(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  return raw;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<p className="text-body-sm text-primary-50 text-center">불러오는 중…</p>}>
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
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (values: LoginForm) => {
    setFormError(null);
    try {
      const owner = await login({
        email: instagramToEmail(values.instagram),
        password: values.password,
      });
      const redirect = safeRedirectPath(searchParams.get('redirect'));
      const dest =
        owner.verification_status === 'approved' && redirect ? redirect : resolveAuthedHome(owner);
      router.replace(dest);
    } catch (e) {
      setFormError(toUserMessage(e));
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
      noValidate
    >
      <div className="text-center">
        <h1 className="text-heading-lg text-primary font-bold">로그인</h1>
        <p className="text-caption text-primary-50 mt-1">가입한 인스타 아이디로 로그인하세요.</p>
      </div>

      <div>
        <label className="text-body-sm mb-1 block font-medium" htmlFor="instagram">
          인스타그램 아이디
        </label>
        <div className="focus-within:border-secondary flex items-center rounded-lg border border-neutral-300 px-3">
          <span className="text-body-sm text-primary-50">@</span>
          <input
            id="instagram"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="sujin_nail"
            className="text-body-sm w-full bg-transparent px-1.5 py-2.5 outline-none"
            {...register('instagram')}
          />
        </div>
        {errors.instagram && (
          <p className="text-caption text-danger mt-1">{errors.instagram.message}</p>
        )}
      </div>

      <div>
        <label className="text-body-sm mb-1 block font-medium" htmlFor="password">
          비밀번호
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className="text-body-sm focus:border-secondary w-full rounded-lg border border-neutral-300 px-3 py-2.5 outline-none"
          {...register('password')}
        />
        {errors.password && (
          <p className="text-caption text-danger mt-1">{errors.password.message}</p>
        )}
      </div>

      {formError && (
        <p className="bg-danger-bg text-caption text-danger rounded-lg px-3 py-2.5">{formError}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="bg-secondary text-body-sm w-full rounded-lg py-2.5 font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? '로그인 중…' : '로그인'}
      </button>

      <p className="text-caption text-primary-50 text-center">
        아직 계정이 없으신가요?{' '}
        <a href="/register" className="text-secondary font-semibold underline">
          회원가입
        </a>
      </p>
      <p className="text-caption text-primary-50 text-center">
        <a href="/password-reset" className="text-secondary font-semibold underline">
          비밀번호를 잊으셨나요?
        </a>
      </p>
    </form>
  );
}
