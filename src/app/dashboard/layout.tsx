'use client';

/**
 * 대시보드 공통 레이아웃 = 인증 가드 + 사이드바.
 *
 * 가드: 부팅 후 미인증이면 /login으로 보낸다.
 * 사이드바/헤더 디자인은 디자인팀이 다듬는 영역이며, 여기서는 라우팅이
 * 동작하는 최소 골격만 제공한다.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { config } from '@/lib/config';

const NAV = [
  { href: '/dashboard', label: '홈' },
  { href: '/dashboard/verification', label: '사업자 인증' },
  { href: '/dashboard/shop', label: '샵 관리' },
  { href: '/dashboard/designers', label: '디자이너' },
  { href: '/dashboard/designs', label: '디자인' },
  { href: '/dashboard/reservations', label: '예약' },
  { href: '/dashboard/reviews', label: '리뷰' },
  { href: '/dashboard/notifications', label: '알림' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, owner, logout } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-neutral-500">
        불러오는 중…
      </div>
    );
  }

  if (status !== 'authenticated') return null;

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-neutral-200 bg-neutral-50 p-4">
        <p className="mb-6 text-sm font-bold text-brand">{config.appName}</p>
        <nav className="space-y-1">
          {NAV.map((item) => {
            const active =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-md px-3 py-2 text-sm ${
                  active ? 'bg-brand text-white' : 'text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
          <span className="text-sm text-neutral-600">{owner?.representative_name ?? owner?.email}</span>
          <button
            onClick={() => {
              logout();
              router.replace('/login');
            }}
            className="text-xs text-neutral-500 underline"
          >
            로그아웃
          </button>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
