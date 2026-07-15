'use client';

/**
 * 베타 회원가입 — 인스타그램 아이디 기반.
 *
 * 백엔드는 이메일+비밀번호로 가입받지만, 베타 테스터는 인스타 아이디로만 가입한다.
 * 인스타 핸들을 결정적 이메일(handle@beta.snail.app)로 매핑해 백엔드에 전달한다.
 * 대표자명·연락처는 베타에서 받지 않고, 대표자명은 핸들, 연락처는 자리표시자로 채운다.
 *
 * 흐름: 가입(POST /auth/owner/signup) → 자동 로그인 → resolveAuthedHome.
 *       신규 가입자는 pending → /pending(운영자 승인 대기).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authApi } from '@/services';
import { useAuth } from '@/hooks/use-auth';
import { toUserMessage } from '@/lib/error-messages';
import { resolveAuthedHome } from '@/lib/auth-routing';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal';
import { instagramToEmail, isValidInstagramHandle, normalizeInstagramHandle } from '@/lib/beta-account';

const registerSchema = z
  .object({
    instagram: z
      .string()
      .min(1, '인스타그램 아이디를 입력해주세요.')
      .refine((v) => isValidInstagramHandle(normalizeInstagramHandle(v)), {
        message: '올바른 인스타 아이디를 입력해주세요. (영문/숫자/밑줄/마침표)',
      }),
    password: z
      .string()
      .min(8, '비밀번호는 8자 이상이어야 합니다.')
      .regex(/[A-Z]/, '대문자를 최소 1자 포함해주세요.')
      .regex(/[a-z]/, '소문자를 최소 1자 포함해주세요.')
      .regex(/[0-9]/, '숫자를 최소 1자 포함해주세요.'),
    passwordConfirm: z.string(),
    agree: z.literal(true, { errorMap: () => ({ message: '약관에 동의해주세요.' }) }),
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
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const handle = normalizeInstagramHandle(watch('instagram') ?? '');

  const onSubmit = async (values: RegisterForm) => {
    setFormError(null);
    const email = instagramToEmail(values.instagram);
    const handleName = normalizeInstagramHandle(values.instagram);
    try {
      await authApi.signup({
        email,
        password: values.password,
        representative_name: handleName,
        phone_number: '000-0000-0000', // 베타에서는 연락처를 받지 않는다(백엔드 필수 필드 자리표시자).
        accepted_terms_version: TERMS_VERSION,
        accepted_privacy_version: PRIVACY_VERSION,
      });
      const owner = await login({ email, password: values.password });
      router.replace(resolveAuthedHome(owner));
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
        <h1 className="text-heading-lg font-bold text-primary">베타 회원가입</h1>
        <p className="mt-1 text-caption text-primary-50">인스타 아이디로 간편하게 시작하세요.</p>
      </div>

      <div>
        <label className="mb-1 block text-body-sm font-medium">인스타그램 아이디</label>
        <div className="flex items-center rounded-lg border border-neutral-300 px-3 focus-within:border-secondary">
          <span className="text-body-sm text-primary-50">@</span>
          <input
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="sujin_nail"
            className="w-full bg-transparent px-1.5 py-2.5 text-body-sm outline-none"
            {...register('instagram')}
          />
        </div>
        {handle && !errors.instagram && (
          <p className="mt-1 text-caption text-primary-50">로그인 아이디로 @{handle} 를 사용합니다.</p>
        )}
        {errors.instagram && <p className="mt-1 text-caption text-danger">{errors.instagram.message}</p>}
      </div>

      <div>
        <label className="mb-1 block text-body-sm font-medium">비밀번호</label>
        <input
          type="password"
          autoComplete="new-password"
          placeholder="8자 이상, 대·소문자와 숫자 포함"
          className={inputCls}
          {...register('password')}
        />
        {errors.password && <p className="mt-1 text-caption text-danger">{errors.password.message}</p>}
      </div>

      <div>
        <label className="mb-1 block text-body-sm font-medium">비밀번호 확인</label>
        <input type="password" autoComplete="new-password" className={inputCls} {...register('passwordConfirm')} />
        {errors.passwordConfirm && (
          <p className="mt-1 text-caption text-danger">{errors.passwordConfirm.message}</p>
        )}
      </div>

      <label className="flex items-start gap-2 text-body-sm">
        <input type="checkbox" className="mt-0.5" {...register('agree')} />
        <span>
          [필수] 이용약관 및 개인정보 처리방침에 동의합니다.
          <span className="text-primary-50">
            {' '}
            (약관 v{TERMS_VERSION} · 개인정보 v{PRIVACY_VERSION})
          </span>
        </span>
      </label>
      {errors.agree && <p className="-mt-2 text-caption text-danger">{errors.agree.message}</p>}

      {formError && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-caption text-danger">{formError}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-secondary py-2.5 text-body-sm font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? '가입 중…' : '회원가입'}
      </button>

      <p className="text-center text-caption text-primary-50">
        이미 계정이 있으신가요?{' '}
        <a href="/login" className="font-semibold text-secondary underline">
          로그인
        </a>
      </p>
      <p className="text-center text-caption text-primary-50">
        <a href="/password-reset" className="font-semibold text-secondary underline">
          비밀번호를 잊으셨나요?
        </a>
      </p>
    </form>
  );
}

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-body-sm outline-none focus:border-secondary';
