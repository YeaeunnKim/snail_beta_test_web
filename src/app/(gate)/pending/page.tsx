'use client';

/**
 * 베타 승인 대기 안내.
 *
 * 베타 테스터는 인스타 아이디로 가입한 뒤 운영자(사장님)의 승인을 기다린다.
 * 사업자 서류 제출 흐름은 베타에서 쓰지 않는다.
 *  - "상태 확인" 버튼으로 내 정보를 다시 불러와 승인되면 게이트가 /dashboard로 보낸다.
 *    (게이트 레이아웃의 AuthGate가 approved 감지 시 자동 이동)
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';

export default function PendingPage() {
  const router = useRouter();
  const { owner, refreshOwner, logout } = useAuth();
  const [checking, setChecking] = useState(false);
  const [checkedNotYet, setCheckedNotYet] = useState(false);

  const onCheck = async () => {
    setChecking(true);
    setCheckedNotYet(false);
    try {
      const updated = await refreshOwner();
      if (updated?.verification_status === 'approved') {
        router.replace('/dashboard');
      } else {
        setCheckedNotYet(true);
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warning-bg text-2xl">
        ⏳
      </div>
      <div>
        <h2 className="text-heading-md font-bold text-primary">승인 대기 중이에요</h2>
        <p className="mt-2 text-body-sm text-primary">
          가입이 완료됐어요! 운영자가 <strong>@{owner?.representative_name}</strong> 계정을 확인하고
          승인하면 디자인 등록과 일정 관리를 바로 시작할 수 있어요.
        </p>
        <p className="mt-2 text-caption text-primary-50">
          승인은 보통 영업일 기준 하루 이내에 처리돼요.
        </p>
      </div>

      {checkedNotYet && (
        <p className="rounded-md bg-warning-bg px-3 py-2 text-caption text-warning">
          아직 승인 전이에요. 잠시 후 다시 확인해주세요.
        </p>
      )}

      <button
        onClick={onCheck}
        disabled={checking}
        className="w-full rounded-lg bg-secondary py-2.5 text-body-sm font-semibold text-white disabled:opacity-50"
      >
        {checking ? '확인 중…' : '승인 상태 확인'}
      </button>

      <button onClick={logout} className="text-caption font-semibold text-primary-50 underline">
        로그아웃
      </button>
    </div>
  );
}
