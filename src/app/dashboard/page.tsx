'use client';

/**
 * 대시보드 홈.
 *
 * 현재는 "백엔드 연결 + 인증 세션"이 실제 동작함을 보여주는 검증 화면이다.
 * GET /owners/me 로 받아온 사장님 정보와 인증 상태를 표시한다.
 * 실제 대시보드 위젯(오늘의 예약 요약 등)은 프론트팀이 채운다.
 */
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';

const VERIFICATION_LABEL: Record<string, string> = {
  pending: '심사 대기 중',
  approved: '승인 완료',
  rejected: '반려됨',
};

export default function DashboardHome() {
  const { owner, verificationStatus, isApproved, needsVerification } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">대시보드</h1>
        <p className="mt-1 text-sm text-neutral-500">백엔드 연결 확인용 기본 화면입니다.</p>
      </div>

      {/* 인증 상태 배너 */}
      {needsVerification && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          사업자 인증이 필요합니다 ({VERIFICATION_LABEL[verificationStatus ?? ''] ?? verificationStatus}).{' '}
          <Link href="/business-verification" className="font-semibold underline">
            인증 화면으로 이동
          </Link>
          {owner?.verification_rejected_reason && (
            <p className="mt-1">반려 사유: {owner.verification_rejected_reason}</p>
          )}
        </div>
      )}

      {/* 연결 검증: /owners/me 응답 */}
      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">내 계정 (GET /owners/me)</h2>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-neutral-500">대표자명</dt>
          <dd>{owner?.representative_name}</dd>
          <dt className="text-neutral-500">이메일</dt>
          <dd>{owner?.email}</dd>
          <dt className="text-neutral-500">연락처</dt>
          <dd>{owner?.phone_number}</dd>
          <dt className="text-neutral-500">인증 상태</dt>
          <dd>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                isApproved ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-600'
              }`}
            >
              {VERIFICATION_LABEL[verificationStatus ?? ''] ?? verificationStatus}
            </span>
          </dd>
        </dl>
      </section>
    </div>
  );
}
