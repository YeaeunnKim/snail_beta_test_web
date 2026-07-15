'use client';

/**
 * 샵 관리.
 * 베타에서는 공개/숨김 상태만 사장님이 직접 전환한다.
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { shopApi, uploadsApi } from '@/services';
import type { Shop, ShopImage } from '@/services';
import { isApiError } from '@/lib/api-error';
import { toUserMessage } from '@/lib/error-messages';
import { MY_SHOP_KEY, useMyShop } from '@/hooks/use-my-shop';
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

      <ShopImagesSection shop={shop} />

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

/* ───────────── 샵 사진 (대표/갤러리) ─────────────
 * 대표 사진 1장(is_thumbnail) + 갤러리 사진 여러 장. 업로드는 uploads 서비스(shop 용도)로 object_key를
 * 받은 뒤 addImage로 등록한다. 추가/삭제 후에는 내 샵 쿼리(MY_SHOP_KEY)를 재검증해 최신 이미지 목록을 받는다.
 */
function ShopImagesSection({ shop }: { shop: Shop }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const images = useMemo(
    () => [...(shop.images ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [shop.images],
  );
  const thumbnail = images.find((img) => img.is_thumbnail) ?? null;
  const gallery = images.filter((img) => !img.is_thumbnail);

  const invalidate = () => qc.invalidateQueries({ queryKey: MY_SHOP_KEY });

  const addImages = useMutation({
    mutationFn: async ({ files, isThumbnail }: { files: File[]; isThumbnail: boolean }) => {
      let order = images.length;
      for (const file of files) {
        const uploaded = await uploadsApi.uploadFile(file, 'shop');
        await shopApi.addImage({
          upload_object_key: uploaded.object_key,
          is_thumbnail: isThumbnail,
          sort_order: order,
        });
        order += 1;
      }
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(toUserMessage(e)),
  });

  const deleteImage = useMutation({
    mutationFn: (imageId: string) => shopApi.deleteImage(imageId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(toUserMessage(e)),
  });

  const busy = addImages.isPending || deleteImage.isPending;

  const pickThumbnail = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    addImages.mutate({ files: [file], isThumbnail: true });
  };
  const pickGallery = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    addImages.mutate({ files: Array.from(files), isThumbnail: false });
  };
  const onDelete = (img: ShopImage) => {
    if (!window.confirm('이 사진을 삭제할까요?')) return;
    deleteImage.mutate(img.id);
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-body-md font-bold text-primary">샵 사진</h2>
      <p className="mt-1 text-caption text-primary-50">고객 앱에 노출되는 대표 사진과 갤러리 사진을 관리합니다.</p>

      <div className="mt-3">
        <p className="mb-2 text-caption font-semibold text-primary-50">대표 사진</p>
        <div className="flex flex-wrap gap-2">
          {thumbnail ? (
            <ShopPhotoTile image={thumbnail} badge="대표" onDelete={() => onDelete(thumbnail)} disabled={busy} />
          ) : (
            <ShopUploadTile label="대표 사진" onFiles={pickThumbnail} disabled={busy} />
          )}
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-caption font-semibold text-primary-50">갤러리 사진</p>
        <div className="flex flex-wrap gap-2">
          {gallery.map((img) => (
            <ShopPhotoTile key={img.id} image={img} onDelete={() => onDelete(img)} disabled={busy} />
          ))}
          <ShopUploadTile label="추가" multiple onFiles={pickGallery} disabled={busy} />
        </div>
      </div>

      {addImages.isPending && <p className="mt-2 text-caption text-primary-50">사진 업로드 중…</p>}
      {error && <p className="mt-2 rounded-md bg-danger-bg px-3 py-2 text-caption text-danger">{error}</p>}
    </section>
  );
}

function ShopPhotoTile({
  image,
  badge,
  onDelete,
  disabled,
}: {
  image: ShopImage;
  badge?: string;
  onDelete: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative h-24 w-24 overflow-hidden rounded-md border border-neutral-200">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.image_url} alt="" className="h-full w-full object-cover" />
      {badge && (
        <span className="absolute left-0 top-0 bg-secondary px-1.5 py-0.5 text-caption font-semibold text-white">
          {badge}
        </span>
      )}
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        className="absolute right-0 top-0 bg-black/50 px-1 text-caption text-white disabled:opacity-50"
        aria-label="삭제"
      >
        ×
      </button>
    </div>
  );
}

function ShopUploadTile({
  label,
  multiple,
  onFiles,
  disabled,
}: {
  label: string;
  multiple?: boolean;
  onFiles: (files: FileList | null) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex h-24 w-24 flex-col items-center justify-center rounded-md border border-dashed border-neutral-300 text-primary-50 ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-secondary'
      }`}
    >
      <span className="text-2xl leading-none">+</span>
      <span className="mt-1 text-caption">{label}</span>
      <input
        type="file"
        accept="image/*"
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}
