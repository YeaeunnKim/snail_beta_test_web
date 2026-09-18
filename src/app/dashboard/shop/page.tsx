'use client';

/**
 * 샵 관리.
 *
 * 섹션별(기본 정보/영업 정보/예약 정보/SNS 채널)로 나열하고, 섹션마다 "정보 수정"을
 * 누르면 그 섹션만 페이지 내에서 인라인 편집 모드로 바뀐다(팝업 없음). 저장하면 바로
 * 읽기 모드로 돌아온다.
 *
 * 디자이너 관리와 예약금/정산 계좌 편집은 이 화면에서 뺐다(2026-09-17 확정) — 디자이너는
 * 디자인 쪽에서 별도로 다룰 예정이고, 예약금은 전부 Toss PG로 받는 구조라 사장님 계좌
 * 정보가 예약 흐름에 필요 없다(백엔드 데이터/필드 자체는 남아있다).
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { shopApi, uploadsApi } from '@/services';
import type { Shop, ShopImage } from '@/services';
import { isApiError } from '@/lib/api-error';
import { toUserMessage } from '@/lib/error-messages';
import { MY_SHOP_KEY, useMyShop } from '@/hooks/use-my-shop';
import { useSetShopVisibility, type SetShopVisibility } from '@/hooks/use-set-shop-visibility';
import { useRegions } from '@/hooks/use-regions';
import { BusinessHoursField } from '@/components/business-hours-field';
import { defaultBusinessHours, fromEntries, hhmm, toEntries, type BusinessHoursValue } from '@/lib/business-hours';
import { WEEKDAYS } from '@/lib/weekday';
import { DEPOSIT_AMOUNT_MAX, DEPOSIT_AMOUNT_MAX_MESSAGE, DEPOSIT_AMOUNT_MIN } from '@/lib/payment-policy';

type RefundTierRow = { daysBefore: string; refundPercent: string };

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-body-sm outline-none focus:border-secondary';
const labelCls = 'mb-1 block text-caption font-semibold text-primary-50';

/** 필수 입력 라벨 — 이름/전화번호/지역/주소/영업시간(2026-09-18 확정, 상세주소는 제외). */
function RequiredMark() {
  return (
    <span className="ml-0.5 text-danger" aria-hidden="true">
      *
    </span>
  );
}

const VISIBILITY_META: Record<Shop['visibility'], { label: string; cls: string; description: string }> = {
  active: { label: '공개 중', cls: 'bg-success-bg text-success', description: '고객 앱에서 샵이 노출됩니다.' },
  hidden: { label: '숨김', cls: 'bg-primary-10 text-primary-50', description: '고객 앱에서 샵이 보이지 않습니다.' },
  draft: { label: '준비 중', cls: 'bg-warning-bg text-warning', description: '아직 공개 전 상태입니다.' },
};

const VERIFICATION_BLOCKED_CODES = new Set(['VERIFICATION_REQUIRED', 'OWNER_NOT_APPROVED']);

function isVerificationBlocked(error: unknown): boolean {
  return isApiError(error) && error.status === 403 && VERIFICATION_BLOCKED_CODES.has(error.code);
}

/** 이미지 URL에서 업로드 object_key를 역추출(버킷명 무관). 기존 사진 보존용. */
function urlToObjectKey(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/[^/]+\//, '');
  } catch {
    return url;
  }
}

/** 숫자만 남기고 국번 자릿수에 맞춰 자동으로 하이픈을 넣는다(02는 2자리 지역번호로 취급). */
function formatKoreanPhone(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 11);
  if (digits.startsWith('02')) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}

const DAUM_POSTCODE_SCRIPT_ID = 'daum-postcode-script';
const DAUM_POSTCODE_SCRIPT_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: {
        oncomplete: (data: { roadAddress?: string; jibunAddress?: string; address?: string }) => void;
      }) => { open: () => void };
    };
  }
}

function loadDaumPostcodeScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.daum?.Postcode) {
      resolve();
      return;
    }
    const existing = document.getElementById(DAUM_POSTCODE_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('주소 검색을 불러오지 못했어요.')));
      return;
    }
    const script = document.createElement('script');
    script.id = DAUM_POSTCODE_SCRIPT_ID;
    script.src = DAUM_POSTCODE_SCRIPT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('주소 검색을 불러오지 못했어요.'));
    document.body.appendChild(script);
  });
}

function openAddressSearch(onComplete: (address: string) => void, onError: (message: string) => void) {
  loadDaumPostcodeScript()
    .then(() => {
      new window.daum!.Postcode({
        oncomplete: (data) => {
          onComplete(data.roadAddress || data.jibunAddress || data.address || '');
        },
      }).open();
    })
    .catch((e: Error) => onError(e.message));
}

export default function ShopPage() {
  const shopQuery = useMyShop();

  if (shopQuery.isLoading) {
    return <p className="py-12 text-center text-body-sm text-primary-50">불러오는 중…</p>;
  }
  if (shopQuery.isError) {
    return <p className="rounded-md bg-danger-bg px-3 py-2 text-body-sm text-danger">{toUserMessage(shopQuery.error)}</p>;
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
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-heading-lg font-bold text-primary">샵 관리</h1>
      </div>
      <VisibilityToggle shop={shop} />
      <BasicInfoSection shop={shop} />
      <BusinessHoursSection shop={shop} />
      <ReservationInfoSection shop={shop} />
      <SnsSection shop={shop} />
    </div>
  );
}

/* ───────────── 공용: 섹션 뼈대 + 읽기용 필드 줄 ───────────── */

function SectionShell({
  title,
  editing,
  onEdit,
  onCancel,
  onSave,
  saving,
  children,
}: {
  title: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-body-md font-bold text-primary">{title}</h2>
        {editing ? (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-caption font-semibold text-primary disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-lg bg-secondary px-3 py-1.5 text-caption font-semibold text-white disabled:opacity-50"
            >
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 rounded-lg border border-secondary px-3 py-1.5 text-caption font-semibold text-secondary"
          >
            정보 수정
          </button>
        )}
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-caption font-semibold text-primary-50">{label}</span>
      <span className="min-w-0 flex-1 whitespace-pre-line text-body-sm text-primary">{value}</span>
    </div>
  );
}

/* ───────────── 앱 공개 여부 ───────────── */

function VisibilityToggle({ shop }: { shop: Shop }) {
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string; verification?: boolean } | null>(null);
  const mutation = useSetShopVisibility();
  const isActive = shop.visibility === 'active';
  const approved = shop.verification_status === 'approved';
  const nextVisibility: SetShopVisibility = isActive ? 'hidden' : 'active';
  const publishingBlocked = nextVisibility === 'active' && !approved;

  const toggle = () => {
    setNotice(null);
    mutation.mutate(nextVisibility, {
      onSuccess: (updated) => {
        setNotice({ type: 'ok', text: updated.visibility === 'active' ? '샵을 공개했어요.' : '샵을 숨겼어요.' });
      },
      onError: (error) => {
        if (isVerificationBlocked(error)) {
          setNotice({ type: 'err', text: '사업자 인증 완료 후 공개할 수 있습니다.', verification: true });
          return;
        }
        setNotice({ type: 'err', text: toUserMessage(error) });
      },
    });
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-body-md font-bold text-primary">앱 공개 여부</h2>
          <p className="mt-0.5 text-caption text-primary-50">{VISIBILITY_META[shop.visibility].description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isActive}
          onClick={toggle}
          disabled={mutation.isPending || (publishingBlocked && !isActive)}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            isActive ? 'bg-success' : 'bg-neutral-300'
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
              isActive ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      {notice && (
        <div className={`mt-3 rounded-md px-3 py-2 text-caption ${notice.type === 'ok' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
          <p>{notice.text}</p>
          {notice.verification && (
            <Link href="/business-verification" className="mt-1 inline-block font-semibold underline">
              인증 상태 확인하기
            </Link>
          )}
        </div>
      )}
      {publishingBlocked && (
        <p className="mt-2 text-caption text-danger">사업자 인증 완료 후 공개할 수 있습니다.</p>
      )}
    </section>
  );
}

/* ───────────── 기본 정보 (샵 사진 + 이름/전화번호/지역/주소/소개글) ───────────── */

function BasicInfoSection({ shop }: { shop: Shop }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(shop.name);
  const [phoneNumber, setPhoneNumber] = useState(shop.phone_number ?? '');
  const [address, setAddress] = useState(shop.address ?? '');
  const [addressDetail, setAddressDetail] = useState(shop.address_detail ?? '');
  const [region, setRegion] = useState(shop.region ?? '');
  const [introduction, setIntroduction] = useState(shop.introduction ?? '');
  const regionsQuery = useRegions();
  const regions = regionsQuery.data ?? [];
  const isKnownRegion = regions.includes(region);

  const startEdit = () => {
    setName(shop.name);
    setPhoneNumber(shop.phone_number ?? '');
    setAddress(shop.address ?? '');
    setAddressDetail(shop.address_detail ?? '');
    setRegion(shop.region ?? '');
    setIntroduction(shop.introduction ?? '');
    setErr(null);
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: () =>
      shopApi.updateMyShop({
        name: name.trim(),
        phone_number: phoneNumber.trim(),
        address: address.trim(),
        address_detail: addressDetail.trim() || null,
        region: region.trim() || null,
        introduction: introduction.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_SHOP_KEY });
      setEditing(false);
    },
    onError: (e) => setErr(toUserMessage(e)),
  });

  const attemptSave = () => {
    if (!name.trim()) return setErr('샵 이름을 입력해주세요.');
    if (!phoneNumber.trim()) return setErr('전화번호를 입력해주세요.');
    if (!region.trim()) return setErr('지역을 선택해주세요.');
    if (!address.trim()) return setErr('주소를 입력해주세요.');
    setErr(null);
    save.mutate();
  };

  return (
    <SectionShell
      title="기본 정보"
      editing={editing}
      onEdit={startEdit}
      onCancel={() => {
        setEditing(false);
        setErr(null);
      }}
      onSave={attemptSave}
      saving={save.isPending}
    >
      {editing ? (
        <div className="space-y-3">
          <ShopPhotosField shop={shop} editable />
          <div className="border-t border-neutral-100 pt-3">
            <label className={labelCls}>샵 이름<RequiredMark /></label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>전화번호<RequiredMark /></label>
            <input
              className={inputCls}
              inputMode="numeric"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(formatKoreanPhone(e.target.value))}
              placeholder="예: 02-0000-0000"
            />
          </div>
          <div>
            <label className={labelCls}>지역<RequiredMark /></label>
            <div className="relative">
              <select
                className={`${inputCls} h-[42px] appearance-none bg-white pr-9`}
                value={isKnownRegion ? region : ''}
                onChange={(e) => setRegion(e.target.value)}
                disabled={regionsQuery.isLoading}
              >
                {regionsQuery.isLoading && <option value="">지역 불러오는 중…</option>}
                {regionsQuery.isError && <option value="">지역을 불러오지 못했어요</option>}
                {regionsQuery.isSuccess && (
                  <>
                    <option value="">지역 선택</option>
                    {regions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </>
                )}
              </select>
              <svg
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary-50"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
              >
                <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          <div>
            <label className={labelCls}>주소<RequiredMark /></label>
            <div className="flex gap-2">
              <input className={`${inputCls} bg-neutral-50`} value={address} readOnly placeholder="주소 검색을 눌러주세요" />
              <button
                type="button"
                onClick={() => openAddressSearch(setAddress, setErr)}
                className="shrink-0 rounded-lg border border-secondary px-3 text-caption font-semibold text-secondary"
              >
                주소 검색
              </button>
            </div>
          </div>
          <div>
            <label className={labelCls}>상세주소</label>
            <input className={inputCls} value={addressDetail} onChange={(e) => setAddressDetail(e.target.value)} placeholder="예: 3층 301호" />
          </div>
          <div>
            <label className={labelCls}>소개글</label>
            <textarea
              className={`${inputCls} min-h-24 resize-y`}
              value={introduction}
              onChange={(e) => setIntroduction(e.target.value)}
              placeholder="샵을 소개하는 문구를 입력해주세요."
            />
          </div>
          {err && <p className="rounded-md bg-danger-bg px-3 py-2 text-caption text-danger">{err}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <ShopPhotosField shop={shop} editable={false} />
          <div className="space-y-2 border-t border-neutral-100 pt-3">
            <FieldRow label="샵 이름" value={shop.name} />
            <FieldRow label="전화번호" value={shop.phone_number || '미입력'} />
            <FieldRow label="지역" value={shop.region || '미입력'} />
            <FieldRow label="주소" value={[shop.address, shop.address_detail].filter(Boolean).join(' ') || '미입력'} />
            <FieldRow label="소개글" value={shop.introduction || '미입력'} />
          </div>
        </div>
      )}
    </SectionShell>
  );
}

function ShopPhotosField({ shop, editable }: { shop: Shop; editable: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const ordered = useMemo(() => {
    const all = [...(shop.images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    const thumb = all.find((i) => i.is_thumbnail);
    const rest = all.filter((i) => !i.is_thumbnail);
    return thumb ? [thumb, ...rest] : rest;
  }, [shop.images]);

  const invalidate = () => qc.invalidateQueries({ queryKey: MY_SHOP_KEY });

  const addImages = useMutation({
    mutationFn: async (files: File[]) => {
      const needsThumbnail = ordered.length === 0;
      let order = ordered.length;
      for (let i = 0; i < files.length; i += 1) {
        const uploaded = await uploadsApi.uploadFile(files[i], 'shop');
        await shopApi.addImage({
          upload_object_key: uploaded.object_key,
          is_thumbnail: needsThumbnail && i === 0,
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

  // 기존 사진을 대표로 지정 — 별도 "순서 변경" API가 없어 대상/기존 대표를 지우고
  // (이미 올라간 파일이라 재업로드 없이 object_key만 재사용) 다시 등록한다.
  const makeThumbnail = useMutation({
    mutationFn: async (target: ShopImage) => {
      const currentThumb = ordered.find((i) => i.is_thumbnail && i.id !== target.id) ?? null;
      const targetKey = urlToObjectKey(target.image_url);
      await shopApi.deleteImage(target.id);
      if (currentThumb) await shopApi.deleteImage(currentThumb.id);
      await shopApi.addImage({ upload_object_key: targetKey, is_thumbnail: true, sort_order: 0 });
      if (currentThumb) {
        await shopApi.addImage({
          upload_object_key: urlToObjectKey(currentThumb.image_url),
          is_thumbnail: false,
          sort_order: ordered.length,
        });
      }
    },
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(toUserMessage(e)),
  });

  const busy = addImages.isPending || deleteImage.isPending || makeThumbnail.isPending;

  const onDelete = (img: ShopImage) => {
    if (!window.confirm('이 사진을 삭제할까요?')) return;
    deleteImage.mutate(img.id);
  };

  return (
    <div>
      <label className={labelCls}>샵 사진</label>
      <div className="flex flex-wrap gap-2">
        {ordered.map((img, idx) => (
          <div key={img.id} className="relative h-24 w-24 overflow-hidden rounded-md border border-neutral-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.image_url} alt="" className="h-full w-full object-cover" />
            {idx === 0 && (
              <span className="absolute left-0 top-0 bg-secondary px-1.5 py-0.5 text-caption font-semibold text-white">
                대표
              </span>
            )}
            {editable && (
              <button
                type="button"
                onClick={() => onDelete(img)}
                disabled={busy}
                className="absolute right-0 top-0 bg-black/50 px-1 text-caption text-white disabled:opacity-50"
                aria-label="사진 삭제"
              >
                ×
              </button>
            )}
            {editable && idx !== 0 && (
              <button
                type="button"
                onClick={() => makeThumbnail.mutate(img)}
                disabled={busy}
                className="absolute inset-x-0 bottom-0 bg-black/50 py-0.5 text-center text-caption text-white hover:bg-black/70 disabled:opacity-50"
              >
                대표로
              </button>
            )}
          </div>
        ))}
        {editable && (
          <label
            className={`flex h-24 w-24 flex-col items-center justify-center rounded-md border border-dashed border-neutral-300 text-primary-50 ${
              busy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-secondary'
            }`}
          >
            <span className="text-2xl leading-none">+</span>
            <span className="mt-1 text-caption">추가</span>
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
              className="hidden"
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files).filter((f) => f.type.startsWith('image/')) : [];
                if (files.length > 0) addImages.mutate(files);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      {addImages.isPending && <p className="mt-2 text-caption text-primary-50">사진 업로드 중…</p>}
      {error && <p className="mt-2 rounded-md bg-danger-bg px-3 py-2 text-caption text-danger">{error}</p>}
    </div>
  );
}

/* ───────────── 영업 정보 ───────────── */

function BusinessHoursSection({ shop }: { shop: Shop }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hours, setHours] = useState<BusinessHoursValue>(() => fromEntries(shop.business_hours ?? []));

  const startEdit = () => {
    const entries = shop.business_hours ?? [];
    setHours(entries.length > 0 ? fromEntries(entries) : defaultBusinessHours());
    setErr(null);
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: () => shopApi.setBusinessHours({ entries: toEntries(hours) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_SHOP_KEY });
      setEditing(false);
    },
    onError: (e) => setErr(toUserMessage(e)),
  });

  const entriesByWeekday = useMemo(() => {
    const map = new Map((shop.business_hours ?? []).map((e) => [e.weekday, e]));
    return WEEKDAYS.map((w) => ({ ...w, entry: map.get(w.value) }));
  }, [shop.business_hours]);

  return (
    <SectionShell
      title="영업 정보"
      editing={editing}
      onEdit={startEdit}
      onCancel={() => {
        setEditing(false);
        setErr(null);
      }}
      onSave={() => {
        setErr(null);
        save.mutate();
      }}
      saving={save.isPending}
    >
      {editing ? (
        <div>
          <BusinessHoursField value={hours} onChange={setHours} />
          {err && <p className="mt-2 rounded-md bg-danger-bg px-3 py-2 text-caption text-danger">{err}</p>}
        </div>
      ) : (
        <div>
          <p className="mb-2 text-caption font-semibold text-primary-50">영업 시간</p>
          <div className="space-y-1.5">
            {entriesByWeekday.map(({ value, label, entry }) => (
              <div key={value} className="flex items-center gap-3">
                <span className="w-6 shrink-0 text-caption font-semibold text-primary-50">{label}</span>
                <span className="text-body-sm text-primary">
                  {!entry || entry.is_closed ? '휴무' : `${hhmm(entry.open_time) ?? '--:--'} ~ ${hhmm(entry.close_time) ?? '--:--'}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </SectionShell>
  );
}

/* ───────────── 예약 정보 (예약 안내 문구 + 환불 규정) ───────────── */

function ReservationInfoSection({ shop }: { shop: Shop }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState<string>(shop.deposit_amount != null ? String(shop.deposit_amount) : '');
  const [reservationPolicy, setReservationPolicy] = useState(shop.reservation_policy ?? '');
  const [refundTiers, setRefundTiers] = useState<RefundTierRow[]>(() =>
    (shop.refund_tiers ?? []).map((t) => ({ daysBefore: String(t.days_before), refundPercent: String(t.refund_percent) })),
  );

  const startEdit = () => {
    setDepositAmount(shop.deposit_amount != null ? String(shop.deposit_amount) : '');
    setReservationPolicy(shop.reservation_policy ?? '');
    setRefundTiers((shop.refund_tiers ?? []).map((t) => ({ daysBefore: String(t.days_before), refundPercent: String(t.refund_percent) })));
    setErr(null);
    setEditing(true);
  };

  const addRefundTier = () => setRefundTiers((prev) => [...prev, { daysBefore: '', refundPercent: '' }]);
  const removeRefundTier = (i: number) => setRefundTiers((prev) => prev.filter((_, idx) => idx !== i));
  const setRefundTier = (i: number, patch: Partial<RefundTierRow>) =>
    setRefundTiers((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  const save = useMutation({
    mutationFn: () =>
      shopApi.updateMyShop({
        // 결제 방식 선택 없이 모든 샵이 예약금을 앱 내 Toss PG로 선결제받는 구조로
        // 고정한다(2026-09-18 확정) — 여기서 예약금을 저장할 때마다 항상 같이 보내서,
        // 예전에 현장결제(on_site)로 남아있던 샵도 자동으로 전환되게 한다.
        payment_method: 'bank_transfer_guide',
        deposit_amount: Math.round(Number(depositAmount)) || 0,
        reservation_policy: reservationPolicy.trim() || null,
        refund_tiers: refundTiers
          .filter((t) => t.daysBefore.trim() && t.refundPercent.trim())
          .map((t) => ({
            days_before: Math.max(0, Math.round(Number(t.daysBefore)) || 0),
            refund_percent: Math.min(100, Math.max(0, Math.round(Number(t.refundPercent)) || 0)),
          })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_SHOP_KEY });
      setEditing(false);
    },
    onError: (e) => setErr(toUserMessage(e)),
  });

  const attemptSave = () => {
    const depositNum = Number(depositAmount);
    if (!depositAmount.trim() || !Number.isFinite(depositNum) || depositNum < DEPOSIT_AMOUNT_MIN) {
      return setErr(`예약금은 ${DEPOSIT_AMOUNT_MIN.toLocaleString()}원 이상 입력해주세요.`);
    }
    if (depositNum > DEPOSIT_AMOUNT_MAX) {
      return setErr(DEPOSIT_AMOUNT_MAX_MESSAGE);
    }
    if (refundTiers.some((t) => t.daysBefore.trim() && !t.refundPercent.trim())) {
      return setErr('환불 규정의 환불 비율을 입력해주세요.');
    }
    setErr(null);
    save.mutate();
  };

  return (
    <SectionShell
      title="예약 정보"
      editing={editing}
      onEdit={startEdit}
      onCancel={() => {
        setEditing(false);
        setErr(null);
      }}
      onSave={attemptSave}
      saving={save.isPending}
    >
      {editing ? (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>예약금(원)<RequiredMark /></label>
            <input
              type="number"
              min={DEPOSIT_AMOUNT_MIN}
              max={DEPOSIT_AMOUNT_MAX}
              className={inputCls}
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="예: 20000"
            />
            <p className="mt-1 text-caption text-primary-50">
              고객이 예약할 때 결제하는 예약금이에요. 앱 내 결제(Toss)로 처리되며, 사장님
              계좌로 바로 들어오지 않고 정산일에 모아서 지급돼요.
            </p>
          </div>
          <div>
            <label className={labelCls}>예약 안내 문구</label>
            <textarea
              className={`${inputCls} min-h-20 resize-y`}
              value={reservationPolicy}
              onChange={(e) => setReservationPolicy(e.target.value)}
              placeholder="예: 노쇼 시 다음 예약이 제한될 수 있습니다."
            />
          </div>
          <div>
            <label className="mb-1 block text-body-sm font-medium text-primary">환불 규정</label>
            <p className="mb-2 text-caption text-primary-50">
              시술일 며칠 전까지 취소하면 몇 %를 환불할지 정해주세요. 비워두면 기본 규정(전날까지
              전액 환불)이 적용돼요.
            </p>
            <div className="space-y-2">
              {refundTiers.map((tier, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={tier.daysBefore}
                    onChange={(e) => setRefundTier(i, { daysBefore: e.target.value })}
                    placeholder="며칠 전"
                  />
                  <span className="text-caption text-primary-50">일 전까지</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={inputCls}
                    value={tier.refundPercent}
                    onChange={(e) => setRefundTier(i, { refundPercent: e.target.value })}
                    placeholder="환불 %"
                  />
                  <span className="text-caption text-primary-50">%</span>
                  <button type="button" onClick={() => removeRefundTier(i)} className="shrink-0 text-caption text-danger">
                    삭제
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addRefundTier} className="mt-2 text-caption font-semibold text-secondary">
              + 환불 규정 추가
            </button>
          </div>
          {err && <p className="rounded-md bg-danger-bg px-3 py-2 text-caption text-danger">{err}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <FieldRow
            label="예약금"
            value={shop.deposit_amount != null ? `${shop.deposit_amount.toLocaleString()}원` : '미입력'}
          />
          <div>
            <p className="mb-1 text-caption font-semibold text-primary-50">예약 안내 문구</p>
            <p className="whitespace-pre-line text-body-sm text-primary">{shop.reservation_policy || '미입력'}</p>
          </div>
          <div>
            <p className="mb-1 text-caption font-semibold text-primary-50">환불 규정</p>
            {(shop.refund_tiers ?? []).length === 0 ? (
              <p className="text-body-sm text-primary-50">기본 규정(전날까지 전액 환불) 적용 중</p>
            ) : (
              <div className="space-y-1">
                {(shop.refund_tiers ?? []).map((t, i) => (
                  <div key={i} className="flex gap-3 text-body-sm">
                    <span className="font-semibold text-primary">{t.days_before}일 전</span>
                    <span className="text-primary">{t.refund_percent}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </SectionShell>
  );
}

/* ───────────── SNS 채널 ───────────── */

function SnsSection({ shop }: { shop: Shop }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [instagramHandle, setInstagramHandle] = useState(shop.instagram_handle ?? '');
  const [naverPlaceUrl, setNaverPlaceUrl] = useState(shop.naver_place_url ?? '');
  const [naverBookingUrl, setNaverBookingUrl] = useState(shop.naver_booking_url ?? '');
  const [kakaoUrl, setKakaoUrl] = useState(shop.kakao_url ?? '');

  const startEdit = () => {
    setInstagramHandle(shop.instagram_handle ?? '');
    setNaverPlaceUrl(shop.naver_place_url ?? '');
    setNaverBookingUrl(shop.naver_booking_url ?? '');
    setKakaoUrl(shop.kakao_url ?? '');
    setErr(null);
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: () =>
      shopApi.updateMyShop({
        instagram_handle: instagramHandle.trim() || null,
        naver_place_url: naverPlaceUrl.trim() || null,
        naver_booking_url: naverBookingUrl.trim() || null,
        kakao_url: kakaoUrl.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_SHOP_KEY });
      setEditing(false);
    },
    onError: (e) => setErr(toUserMessage(e)),
  });

  return (
    <SectionShell
      title="SNS 채널"
      editing={editing}
      onEdit={startEdit}
      onCancel={() => {
        setEditing(false);
        setErr(null);
      }}
      onSave={() => {
        setErr(null);
        save.mutate();
      }}
      saving={save.isPending}
    >
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>인스타그램 아이디</label>
            <input className={inputCls} value={instagramHandle} onChange={(e) => setInstagramHandle(e.target.value)} placeholder="예: snail_nail" />
          </div>
          <div>
            <label className={labelCls}>네이버 플레이스 링크</label>
            <input className={inputCls} value={naverPlaceUrl} onChange={(e) => setNaverPlaceUrl(e.target.value)} placeholder="https://naver.me/..." />
          </div>
          <div>
            <label className={labelCls}>네이버 예약 링크</label>
            <input className={inputCls} value={naverBookingUrl} onChange={(e) => setNaverBookingUrl(e.target.value)} placeholder="https://booking.naver.com/..." />
          </div>
          <div>
            <label className={labelCls}>카카오 채널 링크</label>
            <input className={inputCls} value={kakaoUrl} onChange={(e) => setKakaoUrl(e.target.value)} placeholder="https://pf.kakao.com/..." />
          </div>
          {err && <p className="rounded-md bg-danger-bg px-3 py-2 text-caption text-danger">{err}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <FieldRow label="인스타그램" value={shop.instagram_handle || '미입력'} />
          <FieldRow label="네이버 지도" value={shop.naver_place_url || '미입력'} />
          <FieldRow label="네이버 예약" value={shop.naver_booking_url || '미입력'} />
          <FieldRow label="카카오 채널" value={shop.kakao_url || '미입력'} />
        </div>
      )}
    </SectionShell>
  );
}
