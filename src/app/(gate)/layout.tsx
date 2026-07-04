/**
 * 승인 전 사장님 게이트 레이아웃.
 * /business-verification, /pending 공통 — 중앙 정렬 + 인증 게이트.
 */
import { AuthGate } from '@/components/auth-gate';
import { config } from '@/lib/config';

export default function GateLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/snail-logo.png" alt={config.appName} className="mx-auto mb-6 h-8 w-auto" />
        <AuthGate>{children}</AuthGate>
      </div>
    </main>
  );
}
