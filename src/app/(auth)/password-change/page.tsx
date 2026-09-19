'use client';

/**
 * 비밀번호 변경 — 임시 비밀번호로 들어온 계정이 잠금을 푸는 화면.
 *
 * 베타 사장님의 복구 경로는 운영자의 임시 비밀번호 발급뿐이다(메일이 닿지 않는다 —
 * `/password-reset` 도크 참고). 그 값은 통화에 평문으로 남으므로, 서버가
 * `/owners/me` 와 이 변경 호출을 제외한 모든 경로를 403 으로 막는다
 * (`deps.current_owner_id`). 여기로 보내는 것은 그 403 을 빈 화면으로 만나지 않게
 * 하는 안내이지 차단이 아니다.
 *
 * 잠기지 않은 사장님도 스스로 들어와 바꿀 수 있다 — 그때는 돌아갈 길을 남긴다.
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

const schema = z
  .object({
    currentPassword: z.string().min(1, '현재 비밀번호를 입력해주세요.'),
    // 서버 정책(`_validate_password_policy`)과 같은 규칙을 화면에서 먼저 본다 — 제출 후
    // 거절되면 임시 비밀번호를 다시 받아 적어야 해서 두 번 손이 간다.
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

type Form = z.infer<typeof schema>;

export default function PasswordChangePage() {
  const router = useRouter();
  const { owner, refreshOwner } = useAuth();
  const locked = owner?.must_change_password === true;
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: Form) => {
    setFormError(null);
    try {
      await authApi.changePassword({
        current_password: values.currentPassword,
        new_password: values.newPassword,
      });
      // 스토어의 owner 가 옛 `must_change_password: true` 를 들고 있으면 레이아웃 가드가
      // 방금 푼 계정을 이 화면으로 다시 돌려보낸다.
      const updated = await refreshOwner();
      router.replace(resolveAuthedHome(updated));
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
        <h1 className="text-heading-lg text-primary font-bold">비밀번호 변경</h1>
        <p className="text-caption text-primary-50 mt-1">
          {locked
            ? '운영자가 발급한 임시 비밀번호입니다. 새 비밀번호를 정해야 다른 화면을 쓸 수 있어요.'
            : '현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다.'}
        </p>
      </div>

      <div>
        <label className="text-body-sm mb-1 block font-medium" htmlFor="currentPassword">
          {locked ? '임시 비밀번호' : '현재 비밀번호'}
        </label>
        <input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          className="text-body-sm focus:border-secondary w-full rounded-lg border border-neutral-300 px-3 py-2.5 outline-none"
          {...register('currentPassword')}
        />
        {errors.currentPassword && (
          <p className="text-caption text-danger mt-1">{errors.currentPassword.message}</p>
        )}
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

      {/* 잠긴 계정에는 돌아갈 곳이 없다 — 링크를 두면 눌러서 403 빈 화면을 만난다. */}
      {!locked && (
        <p className="text-caption text-primary-50 text-center">
          <a href={resolveAuthedHome(owner)} className="text-secondary font-semibold underline">
            돌아가기
          </a>
        </p>
      )}
    </form>
  );
}
