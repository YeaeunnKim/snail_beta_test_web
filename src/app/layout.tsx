import type { Metadata } from 'next';
import '@/styles/globals.css';
import { AuthBootstrap } from '@/components/auth-bootstrap';
import { AnalyticsProvider } from '@/components/analytics-provider';
import { QueryProvider } from '@/components/query-provider';
import { config } from '@/lib/config';
import { pretendard } from '@/lib/fonts';

export const metadata: Metadata = {
  title: config.appName,
  description: 'Snail 네일 예약 플랫폼 사장님 관리 웹',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body>
        <AnalyticsProvider>
          <QueryProvider>
            <AuthBootstrap>{children}</AuthBootstrap>
          </QueryProvider>
        </AnalyticsProvider>
      </body>
    </html>
  );
}
