import { PageStub } from '@/components/ui/page-stub';

export default function PasswordResetPage() {
  return (
    <PageStub
      title="비밀번호 재설정"
      description="이메일로 재설정 요청 → 토큰으로 새 비밀번호 확정. 2단계 폼으로 구성하세요."
      apis={['authApi.requestPasswordReset(email)', 'authApi.confirmPasswordReset({ token, new_password })']}
    />
  );
}
