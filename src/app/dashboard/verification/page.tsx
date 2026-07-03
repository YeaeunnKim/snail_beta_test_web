'use client';

/**
 * 사업자 인증 상태 (대시보드 내부).
 *
 * 승인된 사장님은 이 탭에서 인증 상태만 확인한다. 제출/재제출이 필요한 상태
 * (미제출·심사대기·반려)에서는 인증 제출 화면(/business-verification, 게이트 폼)으로 연결한다.
 * 예전에는 곧바로 게이트로 리다이렉트해 대시보드 밖으로 나가며 404처럼 보였는데,
 * 이제 대시보드 셸 안에서 상태 카드로 보여준다.
 */
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';

type Status = 'approved' | 'pending' | 'rejected' | 'none';

const META: Record<Status, { badge: string; cls: string; title: string; desc: string }> = {
  approved: {
    badge: '승인 완료',
    cls: 'border-[#cfe0c4] bg-[#eef4e8] text-[#4f6b3d]',
    title: '사업자 인증이 완료되었어요.',
    desc: '샵 등록·운영과 예약 접수가 모두 가능한 상태입니다.',
  },
  pending: {
    badge: '심사 대기 중',
    cls: 'border-amber-300 bg-amber-50 text-amber-800',
    title: '제출한 인증을 심사하고 있어요.',
    desc: '심사가 끝나면 알림으로 안내해 드릴게요. 보통 1~2 영업일이 걸립니다.',
  },
  rejected: {
    badge: '반려됨',
    cls: 'border-red-300 bg-red-50 text-red-800',
    title: '이전 제출이 반려되었어요.',
    desc: '반려 사유를 확인하고 정보를 수정해 다시 제출해주세요.',
  },
  none: {
    badge: '미제출',
    cls: 'border-neutral-300 bg-neutral-50 text-neutral-600',
    title: '아직 사업자 인증을 제출하지 않았어요.',
    desc: '사업자 정보를 제출하면 승인 후 샵을 운영할 수 있습니다.',
  },
};

export default function VerificationStatusPage() {
  const { owner } = useAuth();
  const raw = owner?.verification_status ?? null;
  const status: Status =
    raw === 'approved' || raw === 'pending' || raw === 'rejected' ? raw : 'none';
  const meta = META[status];
  const rejectedReason = owner?.verification_rejected_reason ?? null;
  const canSubmit = status === 'none' || status === 'rejected';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-heading-lg font-bold">사업자 인증</h1>
        <p className="mt-1 text-body-sm text-neutral-500">사업자 인증 상태를 확인하고 관리합니다.</p>
      </div>

      <div className={`rounded-xl border p-6 ${meta.cls}`}>
        <span className="inline-block rounded-full bg-white/70 px-3 py-1 text-caption font-bold">
          {meta.badge}
        </span>
        <h2 className="mt-3 text-heading-md font-bold">{meta.title}</h2>
        <p className="mt-1 text-body-sm opacity-90">{meta.desc}</p>

        {status === 'rejected' && rejectedReason && (
          <p className="mt-3 rounded-lg bg-white/60 px-3 py-2 text-body-sm">반려 사유: {rejectedReason}</p>
        )}

        {canSubmit && (
          <Link
            href="/business-verification"
            className="mt-4 inline-block rounded-lg bg-secondary px-4 py-2 text-body-sm font-bold text-white"
          >
            {status === 'rejected' ? '다시 제출하기' : '인증 제출하기'}
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-primary-10 bg-white p-5 text-body-sm text-neutral-600">
        <h3 className="mb-2 text-body-sm font-bold text-neutral-800">안내</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>사업자등록증과 사업자등록번호로 인증합니다.</li>
          <li>승인 후 샵 정보 등록 · 디자인 공개 · 예약 접수가 가능합니다.</li>
          <li>정보가 변경되면 반려될 수 있으며, 이 화면에서 다시 제출할 수 있어요.</li>
        </ul>
      </div>
    </div>
  );
}
