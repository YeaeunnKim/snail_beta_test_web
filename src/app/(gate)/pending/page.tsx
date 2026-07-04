'use client';

/**
 * 사업자 인증 심사 대기 안내.
 *
 *  - 제출 내역이 없으면(404) → /business-verification 로 유도(아직 미제출).
 *  - 반려 상태면 → /business-verification (사유 확인·재제출).
 *  - "상태 확인" 버튼으로 내 정보를 다시 불러와 승인되면 /dashboard 로 이동.
 *    (게이트 레이아웃의 AuthGate가 approved 감지 시 자동으로 /dashboard 로 보낸다.)
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ownersApi } from '@/services';
import type { BusinessVerification } from '@/services';
import { useAuth } from '@/hooks/use-auth';
import { isApiError } from '@/lib/api-error';
import { toUserMessage } from '@/lib/error-messages';

export default function PendingPage() {
  const router = useRouter();
  const { owner, refreshOwner, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submission, setSubmission] = useState<BusinessVerification | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 반려 상태면 인증 화면으로 (사유 확인·재제출)
  useEffect(() => {
    if (owner?.verification_status === 'rejected') {
      router.replace('/business-verification');
    }
  }, [owner?.verification_status, router]);

  // 제출 내역 조회 — 없으면 아직 미제출이므로 인증 화면으로 유도
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await ownersApi.getBusinessVerification();
        if (!cancelled) setSubmission(data);
      } catch (e) {
        if (isApiError(e) && e.status === 404) {
          router.replace('/business-verification');
          return;
        }
        if (!cancelled) setError(toUserMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const onCheck = async () => {
    setChecking(true);
    setError(null);
    try {
      const updated = await refreshOwner();
      if (updated?.verification_status === 'approved') {
        router.replace('/dashboard');
      } else if (updated?.verification_status === 'rejected') {
        router.replace('/business-verification');
      }
      // pending 이면 그대로 머문다.
    } finally {
      setChecking(false);
    }
  };

  if (loading) {
    return <p className="text-center text-body-sm text-primary-50">불러오는 중…</p>;
  }

  return (
    <div className="space-y-5 rounded-lg border border-neutral-200 bg-white p-6 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl">
        ⏳
      </div>
      <div>
        <h2 className="text-heading-md font-bold">사업자 인증 심사 중</h2>
        <p className="mt-2 text-body-sm text-primary">
          제출하신 사업자 인증을 검토하고 있습니다. 승인이 완료되면 샵 등록과 운영을 시작할 수
          있어요.
        </p>
        {submission?.created_at && (
          <p className="mt-2 text-caption text-primary-50">
            제출일: {new Date(submission.created_at).toLocaleString('ko-KR')}
          </p>
        )}
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-caption text-red-700">{error}</p>}

      <button
        onClick={onCheck}
        disabled={checking}
        className="w-full rounded-md bg-secondary py-2 text-body-sm font-semibold text-white disabled:opacity-50"
      >
        {checking ? '확인 중…' : '심사 상태 확인'}
      </button>

      <button onClick={logout} className="text-caption font-semibold text-primary-50 underline">
        로그아웃
      </button>
    </div>
  );
}
