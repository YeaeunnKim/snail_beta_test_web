'use client';

/**
 * 베타 모바일 셸 — 하단 탭(디자인 / 예약 / 문의 / 채팅 / 일정 / 샵) + 진입 가드.
 *
 * 가드 순서:
 *  - 미인증          → /login
 *  - 임시 비밀번호    → /password-change (이 셸의 화면들이 부르는 API 가 전부 403)
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
  { href: '/dashboard/notifications', label: '예약', icon: '🔔' },
  { href: '/dashboard/inquiries', label: '문의', icon: '💬' },
  { href: '/dashboard/chat', label: '채팅', icon: '📨' },
  { href: '/dashboard/schedule', label: '일정', icon: '🗓️' },
  { href: '/dashboard/shop', label: '샵', icon: '🏠' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, isApproved, owner, logout } = useAuth();
  const shopQuery = useMyShop();
  // 임시 비밀번호면 서버가 `/owners/me` 외 모든 경로를 403 으로 막는다. 여기서 미리
  // 보내는 것은 그 403 을 빈 화면으로 만나지 않게 하는 안내다 — 차단은 서버가 한다.
  const mustChangePassword = owner?.must_change_password === true;

  // 가드 1: 인증/비밀번호 잠금/승인
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    } else if (status === 'authenticated' && mustChangePassword) {
      router.replace('/password-change');
    } else if (status === 'authenticated' && !isApproved) {
      router.replace('/pending');
    }
  }, [status, isApproved, mustChangePassword, router]);

  // 가드 2: 승인됐지만 샵이 없으면 온보딩
  useEffect(() => {
    if (
      status === 'authenticated' &&
      !mustChangePassword &&
      isApproved &&
      shopQuery.isSuccess &&
      shopQuery.data === null
    ) {
      router.replace('/onboarding');
    }
  }, [status, mustChangePassword, isApproved, shopQuery.isSuccess, shopQuery.data, router]);

  const booting = status === 'idle' || status === 'loading';
  // 잠긴 계정에서는 기다리지 않는다 — 샵 조회가 403 으로 끝날 때까지 로딩 화면이 남는다.
  const waitingShop =
    status === 'authenticated' && !mustChangePassword && isApproved && shopQuery.isLoading;

  if (booting || waitingShop) {
    return (
      <div className="text-body-sm text-primary-50 flex min-h-screen items-center justify-center">
        불러오는 중…
      </div>
    );
  }

  // 리다이렉트 대상은 화면을 그리지 않는다.
  if (status !== 'authenticated' || mustChangePassword || !isApproved) return null;
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
              onClick={() => {
                // 디자인 탭: 이미 이 경로에 있으면 Link가 내비게이션을 안 하므로(같은 URL),
                // 폴더 목록 화면으로 강제로 되돌리라는 이벤트를 쏴서 DesignsPage가 직접 리셋하게 한다.
                if (tab.href === '/dashboard/designs' && pathname.startsWith(tab.href)) {
                  window.dispatchEvent(new Event('snail:designs-tab-reset'));
                }
              }}
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
