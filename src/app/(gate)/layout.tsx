/**
 * 승인 전 사장님 게이트 레이아웃.
 * /business-verification, /pending 공통 — 중앙 정렬 + 인증 게이트.
 */
import { AuthGate } from '@/components/auth-gate';
import { config } from '@/lib/config';

export default function GateLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center text-xl font-bold text-brand">{config.appName}</h1>
        <AuthGate>{children}</AuthGate>
      </div>
    </main>
  );
}
