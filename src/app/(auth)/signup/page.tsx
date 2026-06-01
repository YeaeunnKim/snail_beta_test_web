import { PageStub } from '@/components/ui/page-stub';

export default function SignupPage() {
  return (
    <PageStub
      title="회원가입"
      description="로그인 화면(login/page.tsx)의 폼 패턴을 그대로 활용하세요. 가입 후 로그인으로 이동합니다."
      apis={['authApi.signup(body)', 'authApi.login({ email, password })']}
    />
  );
}
