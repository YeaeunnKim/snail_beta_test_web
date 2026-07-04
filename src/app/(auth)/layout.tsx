import { config } from '@/lib/config';

/** 인증 페이지 공통 레이아웃 (센터 정렬). 디자인은 디자인팀이 다듬는 영역. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/snail-logo.png" alt={config.appName} className="mx-auto mb-6 h-8 w-auto" />
        {children}
      </div>
    </main>
  );
}
