'use client';

/**
 * 베타 모바일 셸 — 하단 탭(디자인 / 일정 / 샵 / 문의 / 알림) + 진입 가드.
 *
 * 가드 순서:
 *  - 미인증          → /login
 *  - 인증 + 미승인    → /pending (운영자 승인 대기)
 *  - 인증 + 승인 + 샵 없음 → /onboarding (샵/디자이너 최초 설정)
 *  - 그 외           → 탭 화면 렌더
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useMyShop } from '@/hooks/use-my-shop';

const TABS = [
  { href: '/dashboard/designs', label: '디자인', icon: '🎨' },
  { href: '/dashboard/schedule', label: '일정', icon: '🗓️' },
  { href: '/dashboard/shop', label: '샵', icon: '🏠' },
  { href: '/dashboard/inquiries', label: '문의', icon: '💬' },
  { href: '/dashboard/chat', label: '채팅', icon: '📨' },
  { href: '/dashboard/notifications', label: '알림', icon: '🔔' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, isApproved, logout } = useAuth();
  const shopQuery = useMyShop();

  // 가드 1: 인증/승인
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    } else if (status === 'authenticated' && !isApproved) {
      router.replace('/pending');
    }
  }, [status, isApproved, router]);

  // 가드 2: 승인됐지만 샵이 없으면 온보딩
  useEffect(() => {
    if (
      status === 'authenticated' &&
      isApproved &&
      shopQuery.isSuccess &&
      shopQuery.data === null
    ) {
      router.replace('/onboarding');
    }
  }, [status, isApproved, shopQuery.isSuccess, shopQuery.data, router]);

  const booting = status === 'idle' || status === 'loading';
  const waitingShop = status === 'authenticated' && isApproved && shopQuery.isLoading;

  if (booting || waitingShop) {
    return (
      <div className="text-body-sm text-primary-50 flex min-h-screen items-center justify-center">
        불러오는 중…
      </div>
    );
  }

  // 리다이렉트 대상은 화면을 그리지 않는다.
  if (status !== 'authenticated' || !isApproved) return null;
  if (shopQuery.data == null) return null; // 온보딩으로 이동 중

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-white">
      {/* 헤더 */}
      <header className="border-primary-10 sticky top-0 z-20 flex items-center justify-between border-b bg-white/95 px-4 py-3 backdrop-blur">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/snail-logo.png" alt="스네일" className="h-6 w-auto" />
        <button
          onClick={() => {
            logout();
            router.replace('/login');
          }}
          className="text-caption text-primary-50 shrink-0 font-semibold underline"
        >
          로그아웃
        </button>
      </header>

      {/* 본문 */}
      <main className="flex-1 px-4 pt-4 pb-24">{children}</main>

      {/* 하단 탭바 */}
      <nav className="border-primary-10 fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-md border-t bg-white">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`text-caption flex flex-1 flex-col items-center gap-0.5 py-2.5 font-semibold ${
                active ? 'text-secondary' : 'text-primary-50'
              }`}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
