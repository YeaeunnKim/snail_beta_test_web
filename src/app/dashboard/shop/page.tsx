'use client';

/**
 * 샵 관리.
 * 베타에서는 공개/숨김 상태만 사장님이 직접 전환한다.
 */
import Link from 'next/link';
import { useState } from 'react';
import type { Shop } from '@/services';
import { isApiError } from '@/lib/api-error';
import { toUserMessage } from '@/lib/error-messages';
import { useMyShop } from '@/hooks/use-my-shop';
import { useSetShopVisibility, type SetShopVisibility } from '@/hooks/use-set-shop-visibility';
import { ShopEditModal } from '@/components/shop-edit-modal';

type Notice = { type: 'ok' | 'err'; text: string; verification?: boolean };

const VISIBILITY_META: Record<Shop['visibility'], { label: string; cls: string; description: string }> = {
  active: {
    label: '공개 중',
    cls: 'bg-success-bg text-success',
    description: '고객 앱에서 샵이 노출됩니다.',
  },
  hidden: {
    label: '숨김',
    cls: 'bg-primary-10 text-primary-50',
    description: '고객 앱에서 샵이 보이지 않습니다.',
  },
  draft: {
    label: '준비 중',
    cls: 'bg-warning-bg text-warning',
    description: '아직 공개 전 상태입니다.',
  },
};

const VERIFICATION_BLOCKED_CODES = new Set(['VERIFICATION_REQUIRED', 'OWNER_NOT_APPROVED']);

function isVerificationBlocked(error: unknown): boolean {
  return isApiError(error) && error.status === 403 && VERIFICATION_BLOCKED_CODES.has(error.code);
}

export default function ShopPage() {
  const shopQuery = useMyShop();

  if (shopQuery.isLoading) {
    return <p className="py-12 text-center text-body-sm text-primary-50">불러오는 중…</p>;
  }

  if (shopQuery.isError) {
    return (
      <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">
        {toUserMessage(shopQuery.error)}
      </p>
    );
  }

  if (!shopQuery.data) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-body-sm text-primary-50">
        등록된 샵 정보가 없습니다.
      </p>
    );
  }

  return <ShopManageView shop={shopQuery.data} />;
}

function ShopManageView({ shop }: { shop: Shop }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-heading-lg font-bold text-primary">샵 관리</h1>
          <p className="mt-1 text-body-sm text-primary-50">샵 공개 상태와 정보를 관리합니다.</p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 rounded-lg border border-secondary px-3 py-1.5 text-caption font-semibold text-secondary"
        >
          정보 수정
        </button>
      </div>

      <VisibilityControl shop={shop} />

      {editing && <ShopEditModal shop={shop} onClose={() => setEditing(false)} />}
    </div>
  );
}

function VisibilityControl({ shop }: { shop: Shop }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const mutation = useSetShopVisibility();
  const meta = VISIBILITY_META[shop.visibility];
  const approved = shop.verification_status === 'approved';
  const isActive = shop.visibility === 'active';
  const nextVisibility: SetShopVisibility = isActive ? 'hidden' : 'active';
  const publishingBlocked = nextVisibility === 'active' && !approved;

  const changeVisibility = () => {
    setNotice(null);
    mutation.mutate(nextVisibility, {
      onSuccess: (updated) => {
        setNotice({
          type: 'ok',
          text: updated.visibility === 'active' ? '샵을 공개했어요.' : '샵을 숨겼어요.',
        });
      },
      onError: (error) => {
        if (isVerificationBlocked(error)) {
          setNotice({
            type: 'err',
            text: '사업자 인증 완료 후 공개할 수 있습니다.',
            verification: true,
          });
          return;
        }
        setNotice({ type: 'err', text: toUserMessage(error) });
      },
    });
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-body-md font-bold text-primary">{shop.name}</h2>
          <p className="mt-1 text-caption text-primary-50">{shop.region ?? shop.address}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-caption font-bold ${meta.cls}`}>
          {meta.label}
        </span>
      </div>

      <div className="mt-4 rounded-lg bg-neutral-50 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-caption font-semibold text-primary-50">현재 공개 상태</p>
            <p className="mt-0.5 text-body-sm font-bold text-primary">{meta.label}</p>
          </div>
          <button
            type="button"
            onClick={changeVisibility}
            disabled={mutation.isPending || publishingBlocked}
            className={`shrink-0 rounded-lg px-4 py-2 text-body-sm font-semibold disabled:opacity-50 ${
              isActive ? 'bg-neutral-100 text-primary' : 'bg-secondary text-white'
            }`}
          >
            {mutation.isPending ? '변경 중…' : isActive ? '숨기기' : '공개하기'}
          </button>
        </div>
        <p className="mt-2 text-caption text-primary-50">{meta.description}</p>
        {publishingBlocked && (
          <p className="mt-2 text-caption text-danger">사업자 인증 완료 후 공개할 수 있습니다.</p>
        )}
      </div>

      {notice && (
        <div
          className={`mt-3 rounded-md px-3 py-2 text-caption ${
            notice.type === 'ok' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
          }`}
        >
          <p>{notice.text}</p>
          {notice.verification && (
            <Link href="/business-verification" className="mt-1 inline-block font-semibold underline">
              인증 상태 확인하기
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
