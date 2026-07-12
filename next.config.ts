import type { NextConfig } from 'next';

/**
 * 배포(Vercel) 빌드에서 백엔드 URL 누락/오설정을 "빌드 실패"로 승격한다.
 *
 * NEXT_PUBLIC_API_BASE_URL 은 NEXT_PUBLIC_* 라서 빌드 시점에 번들로 인라인된다.
 * Vercel 프로젝트 env 에 값이 없으면 config.ts 의 기본값(http://localhost:8000/api/v1)이
 * 그대로 구워져 "백엔드에 연결 못 하는 배포본"이 조용히 나간다. CI 는 일부러 env 없이
 * 빌드하므로(코드 기본값 폴백) 이 사고를 절대 못 잡는다. → Vercel 빌드 단계에서 직접 막는다.
 *
 * - 강제 대상: Vercel 의 production / preview 배포(VERCEL_ENV 로 판별).
 * - 예외: 로컬 dev(`next dev`)와 CI 빌드(VERCEL_ENV 미설정)는 localhost 폴백을 그대로 허용.
 */
function assertApiBaseUrl(): void {
  // 'production' | 'preview' | 'development' | undefined. Vercel 이 빌드 환경에 주입한다.
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv !== 'production' && vercelEnv !== 'preview') return;

  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  const problems: string[] = [];

  if (!raw) {
    problems.push('환경변수가 설정되지 않았습니다(코드 기본값 localhost 로 빌드될 뻔했습니다).');
  } else {
    let url: URL | null = null;
    try {
      url = new URL(raw);
    } catch {
      problems.push(`URL 형식이 아닙니다: ${raw}`);
    }
    if (url) {
      if (/^(localhost$|127\.|0\.0\.0\.0$|\[?::1\]?$)/.test(url.hostname)) {
        problems.push(`localhost/루프백을 가리킵니다: ${raw}`);
      }
      // 프로덕션은 https 강제(Vercel 은 https 이므로 http 백엔드는 mixed-content 로 차단됨).
      if (vercelEnv === 'production' && url.protocol !== 'https:') {
        problems.push(`https 가 아닙니다(브라우저가 mixed-content 로 차단): ${raw}`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      [
        '',
        '──────────────────────────────────────────────────────────────',
        `[build] NEXT_PUBLIC_API_BASE_URL 설정 오류 (VERCEL_ENV=${vercelEnv})`,
        ...problems.map((p) => `  • ${p}`),
        '',
        '  Vercel 프로젝트 Settings → Environment Variables 에서',
        `  NEXT_PUBLIC_API_BASE_URL 을 실제 백엔드 https URL(예: https://<host>/api/v1)로`,
        '  설정한 뒤(Production/Preview 스코프 확인) 다시 배포하세요.',
        '  ※ NEXT_PUBLIC_* 는 빌드 시 인라인되므로, 값을 바꾸면 반드시 재배포(재빌드)해야 반영됩니다.',
        '──────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
  }
}

assertApiBaseUrl();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 백엔드(GCS/CDN) 이미지 도메인. 실제 배포 도메인이 정해지면 추가하세요.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.example.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
    ],
  },
};

export default nextConfig;
