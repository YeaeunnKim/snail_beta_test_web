import { config } from '@/lib/config';

/** 인증 페이지 공통 레이아웃 (센터 정렬). 디자인은 디자인팀이 다듬는 영역. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-xl font-bold text-brand">{config.appName}</h1>
        {children}
      </div>
    </main>
  );
}
