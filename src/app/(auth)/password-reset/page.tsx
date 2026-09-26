'use client';

/**
 * 베타 비밀번호 재설정 — 운영자가 임시 비밀번호를 발급한다.
 *
 * **메일로 코드를 보내지 않는다.** 예전에는 이 화면이 인스타 아이디를 받아
 * `POST /auth/password-reset` 을 부르고 "재설정 코드를 보냈다" 고 안내했는데, 그 코드는
 * 어디에도 도착하지 않았다. 이유가 둘이다.
 *
 * 1. 백엔드에 메일 발송 연동이 없다 — 토큰은 개발 로그로만 나간다.
 * 2. 연동돼도 닿지 않는다 — 베타 계정의 이메일은 인스타 핸들로 만든 합성 주소
 *    (`handle@beta.snail.app`, `lib/beta-account.ts`)라 받는 사람이 없다.
 *
 * 즉 "코드를 보냈으니 확인하세요" 는 처음부터 성립하지 않는 안내였다. 사장님은 오지 않는
 * 메일을 기다리다 스팸함까지 뒤진 뒤에야 전화하게 되고, 화면이 거짓말을 한 만큼 복구가
 * 늦어진다. 그래서 실제로 동작하는 경로 하나만 안내한다: 운영자가 어드민 콘솔에서 임시
 * 비밀번호를 발급해 전화로 불러 준다. 받은 뒤에는 `/password-change` 에서 새 비밀번호를
 * 정한다(그 전까지 서버가 다른 API 를 403 으로 막는다).
 *
 * 링크에 `?token=` 이 붙어 있으면 확정 폼을 그대로 연다 — 발송이 연결되는 날, 그리고
 * 운영자가 개발 로그에서 토큰을 꺼내 전달한 예외 상황에 필요하다.
 */
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authApi } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import { config } from '@/lib/config';

const confirmSchema = z
  .object({
    token: z.string().min(1, '재설정 코드를 입력해주세요.'),
    newPassword: z
      .string()
      .min(8, '비밀번호는 8자 이상이어야 합니다.')
      .regex(/[A-Z]/, '대문자를 최소 1자 포함해주세요.')
      .regex(/[a-z]/, '소문자를 최소 1자 포함해주세요.')
      .regex(/[0-9]/, '숫자를 최소 1자 포함해주세요.'),
    newPasswordConfirm: z.string(),
  })
  .refine((v) => v.newPassword === v.newPasswordConfirm, {
    path: ['newPasswordConfirm'],
    message: '비밀번호가 일치하지 않습니다.',
  });
type ConfirmForm = z.infer<typeof confirmSchema>;

type Step = 'guide' | 'confirm' | 'done';

export default function PasswordResetPage() {
  return (
    <Suspense fallback={<p className="text-body-sm text-primary-50 text-center">불러오는 중…</p>}>
      <PasswordResetFlow />
    </Suspense>
  );
}

function PasswordResetFlow() {
  const searchParams = useSearchParams();
  const tokenFromLink = searchParams.get('token');
  const [step, setStep] = useState<Step>(tokenFromLink ? 'confirm' : 'guide');

  if (step === 'done') {
    return (
      <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-heading-lg text-primary font-bold">비밀번호가 변경되었습니다</h1>
        <p className="text-body-sm text-primary-50">새 비밀번호로 다시 로그인해주세요.</p>
        <a href="/login" className="text-secondary inline-block font-semibold underline">
          로그인하러 가기
        </a>
      </div>
    );
  }

  if (step === 'confirm') {
    return <ConfirmStep defaultToken={tokenFromLink ?? ''} onDone={() => setStep('done')} />;
  }

  return <ContactGuide />;
}

/** 토큰이 없을 때 — 유일하게 동작하는 복구 경로를 안내한다. */
function ContactGuide() {
  return (
    <section className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="text-center">
        <h1 className="text-heading-lg text-primary font-bold">비밀번호를 잊으셨나요?</h1>
        <p className="text-caption text-primary-50 mt-1">
          운영팀에 연락 주시면 임시 비밀번호를 바로 발급해 드립니다.
        </p>
      </div>

      <ol className="text-body-sm text-primary space-y-2">
        <li>
          <b>1.</b> 아래 연락처로 가입하신 인스타 아이디를 알려 주세요.
        </li>
        <li>
          <b>2.</b> 운영자가 임시 비밀번호를 전화로 불러 드립니다.
        </li>
        <li>
          <b>3.</b> 그 비밀번호로 로그인하면 새 비밀번호를 정하는 화면이 바로 열립니다.
        </li>
      </ol>

      <div className="bg-surface rounded-lg px-4 py-3">
        <p className="text-caption text-primary-50">운영팀 문의</p>
        {config.ownerLinkSupportHref ? (
          <a
            href={config.ownerLinkSupportHref}
            className="text-body-sm text-secondary mt-0.5 block font-semibold underline"
          >
            {config.ownerLinkSupportLabel}
          </a>
        ) : (
          <p className="text-body-sm text-primary mt-0.5 font-semibold">
            {config.ownerLinkSupportLabel}
          </p>
        )}
      </div>

      <p className="text-caption text-primary-50 text-center">
        <a href="/login" className="text-secondary font-semibold underline">
          로그인으로 돌아가기
        </a>
      </p>
    </section>
  );
}

function ConfirmStep({ defaultToken, onDone }: { defaultToken: string; onDone: () => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ConfirmForm>({
    resolver: zodResolver(confirmSchema),
    defaultValues: { token: defaultToken },
  });

  const onSubmit = async (values: ConfirmForm) => {
    setFormError(null);
    try {
      await authApi.confirmPasswordReset({ token: values.token, new_password: values.newPassword });
      onDone();
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
        <h1 className="text-heading-lg text-primary font-bold">새 비밀번호 설정</h1>
        <p className="text-caption text-primary-50 mt-1">
          받으신 재설정 코드와 새 비밀번호를 입력해주세요.
        </p>
      </div>

      <div>
        <label className="text-body-sm mb-1 block font-medium" htmlFor="token">
          재설정 코드
        </label>
        <input
          id="token"
          className="text-body-sm focus:border-secondary w-full rounded-lg border border-neutral-300 px-3 py-2.5 outline-none"
          {...register('token')}
        />
        {errors.token && <p className="text-caption text-danger mt-1">{errors.token.message}</p>}
      </div>

      <div>
        <label className="text-body-sm mb-1 block font-medium" htmlFor="newPassword">
          새 비밀번호
        </label>
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          placeholder="8자 이상, 대·소문자와 숫자 포함"
          className="text-body-sm focus:border-secondary w-full rounded-lg border border-neutral-300 px-3 py-2.5 outline-none"
          {...register('newPassword')}
        />
        {errors.newPassword && (
          <p className="text-caption text-danger mt-1">{errors.newPassword.message}</p>
        )}
      </div>

      <div>
        <label className="text-body-sm mb-1 block font-medium" htmlFor="newPasswordConfirm">
          새 비밀번호 확인
        </label>
        <input
          id="newPasswordConfirm"
          type="password"
          autoComplete="new-password"
          className="text-body-sm focus:border-secondary w-full rounded-lg border border-neutral-300 px-3 py-2.5 outline-none"
          {...register('newPasswordConfirm')}
        />
        {errors.newPasswordConfirm && (
          <p className="text-caption text-danger mt-1">{errors.newPasswordConfirm.message}</p>
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
        {isSubmitting ? '변경 중…' : '비밀번호 변경'}
      </button>

      <p className="text-caption text-primary-50 text-center">
        <a href="/login" className="text-secondary font-semibold underline">
          로그인으로 돌아가기
        </a>
      </p>
    </form>
  );
}
