import type { Metadata } from 'next';
import '@/styles/globals.css';
import { AuthBootstrap } from '@/components/auth-bootstrap';
import { QueryProvider } from '@/components/query-provider';
import { config } from '@/lib/config';

export const metadata: Metadata = {
  title: config.appName,
  description: 'Snail 네일 예약 플랫폼 사장님 관리 웹',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <QueryProvider>
          <AuthBootstrap>{children}</AuthBootstrap>
        </QueryProvider>
      </body>
    </html>
  );
}
