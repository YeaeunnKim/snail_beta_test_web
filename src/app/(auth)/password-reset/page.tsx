'use client';

/**
 * 베타 비밀번호 재설정 — 2단계 플로우.
 *
 * 1) 인스타그램 아이디(또는 이메일)로 재설정 요청 → 백엔드가 이메일로 토큰을 발송한다.
 *    (인스타 핸들만 입력한 계정은 회원가입과 동일한 규칙으로 handle@beta.snail.app 로 매핑한다.)
 * 2) 이메일로 받은 토큰 + 새 비밀번호를 입력해 확정한다.
 *
 * 재설정 안내 링크에 ?token=... 이 붙어 있으면 1단계를 건너뛰고 바로 2단계로 진입한다.
 */
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authApi } from '@/services';
import { toUserMessage } from '@/lib/error-messages';
import { instagramToEmail } from '@/lib/beta-account';

const requestSchema = z.object({
  instagram: z.string().min(1, '인스타그램 아이디를 입력해주세요.'),
});
type RequestForm = z.infer<typeof requestSchema>;

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

type Step = 'request' | 'confirm' | 'done';

export default function PasswordResetPage() {
  return (
    <Suspense fallback={<p className="text-center text-body-sm text-primary-50">불러오는 중…</p>}>
      <PasswordResetFlow />
    </Suspense>
  );
}

function PasswordResetFlow() {
  const searchParams = useSearchParams();
  const tokenFromLink = searchParams.get('token');
  const [step, setStep] = useState<Step>(tokenFromLink ? 'confirm' : 'request');
  const [requestedHandle, setRequestedHandle] = useState('');

  if (step === 'done') {
    return (
      <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-heading-lg font-bold text-primary">비밀번호가 변경되었습니다</h1>
        <p className="text-body-sm text-primary-50">새 비밀번호로 다시 로그인해주세요.</p>
        <a href="/login" className="inline-block font-semibold text-secondary underline">
          로그인하러 가기
        </a>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <ConfirmStep
        defaultToken={tokenFromLink ?? ''}
        requestedHandle={requestedHandle}
        onDone={() => setStep('done')}
        onBack={tokenFromLink ? undefined : () => setStep('request')}
      />
    );
  }

  return (
    <RequestStep
      onRequested={(handle) => {
        setRequestedHandle(handle);
        setStep('confirm');
      }}
    />
  );
}

function RequestStep({ onRequested }: { onRequested: (handle: string) => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RequestForm>({ resolver: zodResolver(requestSchema) });

  const onSubmit = async (values: RequestForm) => {
    setFormError(null);
    try {
      await authApi.requestPasswordReset(instagramToEmail(values.instagram));
      onRequested(values.instagram);
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
        <h1 className="text-heading-lg font-bold text-primary">비밀번호 재설정</h1>
        <p className="mt-1 text-caption text-primary-50">
          가입한 인스타 아이디를 입력하면 재설정 안내를 보내드립니다.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-body-sm font-medium" htmlFor="instagram">
          인스타그램 아이디
        </label>
        <div className="flex items-center rounded-lg border border-neutral-300 px-3 focus-within:border-secondary">
          <span className="text-body-sm text-primary-50">@</span>
          <input
            id="instagram"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="sujin_nail"
            className="w-full bg-transparent px-1.5 py-2.5 text-body-sm outline-none"
            {...register('instagram')}
          />
        </div>
        {errors.instagram && <p className="mt-1 text-caption text-danger">{errors.instagram.message}</p>}
      </div>

      {formError && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-caption text-danger">{formError}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-secondary py-2.5 text-body-sm font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? '요청 중…' : '재설정 코드 받기'}
      </button>

      <p className="text-center text-caption text-primary-50">
        <a href="/login" className="font-semibold text-secondary underline">
          로그인으로 돌아가기
        </a>
      </p>
    </form>
  );
}

function ConfirmStep({
  defaultToken,
  requestedHandle,
  onDone,
  onBack,
}: {
  defaultToken: string;
  requestedHandle: string;
  onDone: () => void;
  onBack?: () => void;
}) {
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
        <h1 className="text-heading-lg font-bold text-primary">새 비밀번호 설정</h1>
        <p className="mt-1 text-caption text-primary-50">
          {requestedHandle ? `@${requestedHandle} 로 발송된 ` : ''}재설정 코드와 새 비밀번호를 입력해주세요.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-body-sm font-medium" htmlFor="token">
          재설정 코드
        </label>
        <input
          id="token"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-body-sm outline-none focus:border-secondary"
          {...register('token')}
        />
        {errors.token && <p className="mt-1 text-caption text-danger">{errors.token.message}</p>}
      </div>

      <div>
        <label className="mb-1 block text-body-sm font-medium" htmlFor="newPassword">
          새 비밀번호
        </label>
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          placeholder="8자 이상, 대·소문자와 숫자 포함"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-body-sm outline-none focus:border-secondary"
          {...register('newPassword')}
        />
        {errors.newPassword && <p className="mt-1 text-caption text-danger">{errors.newPassword.message}</p>}
      </div>

      <div>
        <label className="mb-1 block text-body-sm font-medium" htmlFor="newPasswordConfirm">
          새 비밀번호 확인
        </label>
        <input
          id="newPasswordConfirm"
          type="password"
          autoComplete="new-password"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-body-sm outline-none focus:border-secondary"
          {...register('newPasswordConfirm')}
        />
        {errors.newPasswordConfirm && (
          <p className="mt-1 text-caption text-danger">{errors.newPasswordConfirm.message}</p>
        )}
      </div>

      {formError && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-caption text-danger">{formError}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-secondary py-2.5 text-body-sm font-semibold text-white disabled:opacity-50"
      >
        {isSubmitting ? '변경 중…' : '비밀번호 변경'}
      </button>

      <p className="text-center text-caption text-primary-50">
        {onBack ? (
          <button type="button" onClick={onBack} className="font-semibold text-secondary underline">
            다시 요청하기
          </button>
        ) : (
          <a href="/login" className="font-semibold text-secondary underline">
            로그인으로 돌아가기
          </a>
        )}
      </p>
    </form>
  );
}
