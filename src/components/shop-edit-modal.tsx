'use client';

/**
 * 샵 정보 수정 모달. 온보딩에서 처음 입력한 정보를 한 곳에서 수정한다.
 *  - 샵 이름 · 결제 방식(+계좌) · 지역 · 영업시간
 *  - 디자이너: 이름 변경 + 추가 (삭제는 운영자 연락 안내)
 * 저장: updateMyShop(PATCH) + setBusinessHours(PUT) + 디자이너 이름변경(PATCH)/추가(POST).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designersApi, shopApi } from '@/services';
import type { Shop } from '@/services';
import { MY_SHOP_KEY } from '@/hooks/use-my-shop';
import { toUserMessage } from '@/lib/error-messages';
import { BusinessHoursField } from '@/components/business-hours-field';
import { fromEntries, toEntries, type BusinessHoursValue } from '@/lib/business-hours';
import { SHOP_REGIONS, isKnownRegion } from '@/lib/regions';

type PaymentMethod = 'on_site' | 'bank_transfer_guide';
type DesignerRow = { id?: string; name: string };

const inputCls =
  'w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-body-sm outline-none focus:border-secondary';
const labelCls = 'mb-1 block text-caption font-semibold text-primary-50';

export function ShopEditModal({ shop, onClose }: { shop: Shop; onClose: () => void }) {
  const qc = useQueryClient();

  const [name, setName] = useState(shop.name);
  const [region, setRegion] = useState(shop.region ?? '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    (shop.payment_method as PaymentMethod) ?? 'on_site',
  );
  const [depositAmount, setDepositAmount] = useState<string>(
    shop.deposit_amount != null ? String(shop.deposit_amount) : '',
  );
  const [bankName, setBankName] = useState(shop.bank_name ?? '');
  const [bankHolder, setBankHolder] = useState(shop.bank_account_holder ?? '');
  const [bankAccount, setBankAccount] = useState(shop.bank_account_number ?? '');
  const [hours, setHours] = useState<BusinessHoursValue>(() => fromEntries(shop.business_hours));
  const [err, setErr] = useState<string | null>(null);

  const designersQuery = useQuery({ queryKey: ['designers'], queryFn: () => designersApi.listDesigners() });
  const [rows, setRows] = useState<DesignerRow[] | null>(null);
  useEffect(() => {
    if (designersQuery.data && rows === null) {
      setRows(designersQuery.data.map((d) => ({ id: d.id, name: d.name })));
    }
  }, [designersQuery.data, rows]);

  const originalNames = new Map((designersQuery.data ?? []).map((d) => [d.id, d.name]));

  const save = useMutation({
    mutationFn: async () => {
      const bank = paymentMethod === 'bank_transfer_guide';
      await shopApi.updateMyShop({
        name: name.trim(),
        region: region.trim() || null,
        payment_method: paymentMethod,
        deposit_amount: bank ? Number(depositAmount) || 0 : null,
        bank_name: bank ? bankName.trim() || null : null,
        bank_account_number: bank ? bankAccount.trim() || null : null,
        bank_account_holder: bank ? bankHolder.trim() || null : null,
      });
      await shopApi.setBusinessHours({ entries: toEntries(hours) });
      for (const r of rows ?? []) {
        const nm = r.name.trim();
        if (!nm) continue;
        if (r.id) {
          if (originalNames.get(r.id) !== nm) await designersApi.updateDesigner(r.id, { name: nm });
        } else {
          await designersApi.createDesigner({ name: nm });
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_SHOP_KEY });
      qc.invalidateQueries({ queryKey: ['designers'] });
      onClose();
    },
    onError: (e) => setErr(toUserMessage(e)),
  });

  const attemptSave = () => {
    if (!name.trim()) {
      setErr('샵 이름을 입력해주세요.');
      return;
    }
    if (paymentMethod === 'bank_transfer_guide') {
      if (!depositAmount || Number(depositAmount) <= 0) return setErr('예약금을 입력해주세요.');
      if (!bankName.trim()) return setErr('은행명을 입력해주세요.');
      if (!bankHolder.trim()) return setErr('예금주를 입력해주세요.');
      if (!bankAccount.trim()) return setErr('계좌번호를 입력해주세요.');
    }
    if ((rows ?? []).every((r) => !r.name.trim())) {
      setErr('디자이너를 1명 이상 남겨주세요.');
      return;
    }
    setErr(null);
    save.mutate();
  };

  const setRow = (i: number, nm: string) =>
    setRows((prev) => (prev ?? []).map((r, idx) => (idx === i ? { ...r, name: nm } : r)));
  const addRow = () => setRows((prev) => [...(prev ?? []), { name: '' }]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={save.isPending ? undefined : onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-heading-md font-bold text-primary">샵 정보 수정</h2>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg bg-neutral-100 text-primary-50">
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-5">
          {/* 샵 이름 */}
          <div>
            <label className={labelCls}>샵 이름</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {/* 지역 — 자유입력 불가, 아래 목록에서만 선택 */}
          <div>
            <label className={labelCls}>지역</label>
            <select
              className={`${inputCls} bg-white`}
              value={isKnownRegion(region) ? region : ''}
              onChange={(e) => setRegion(e.target.value)}
            >
              <option value="">지역 선택</option>
              {SHOP_REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* 영업시간 */}
          <div>
            <label className="mb-1 block text-body-sm font-medium text-primary">영업시간</label>
            <BusinessHoursField value={hours} onChange={setHours} />
          </div>

          {/* 결제 방식 */}
          <div>
            <label className="mb-1 block text-body-sm font-medium text-primary">결제 방식</label>
            <div className="flex gap-2">
              {(
                [
                  ['on_site', '현장 결제'],
                  ['bank_transfer_guide', '계좌이체'],
                ] as const
              ).map(([v, lbl]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPaymentMethod(v)}
                  className={`flex-1 rounded-lg border px-4 py-2 text-body-sm font-semibold ${
                    paymentMethod === v ? 'border-secondary bg-secondary text-white' : 'border-neutral-300 text-primary'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            {paymentMethod === 'bank_transfer_guide' && (
              <div className="mt-3 space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                <div>
                  <label className={labelCls}>예약금(원)</label>
                  <input
                    type="number"
                    min={0}
                    className={inputCls}
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="예: 20000"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className={labelCls}>은행</label>
                    <input className={inputCls} value={bankName} onChange={(e) => setBankName(e.target.value)} />
                  </div>
                  <div className="flex-1">
                    <label className={labelCls}>예금주</label>
                    <input className={inputCls} value={bankHolder} onChange={(e) => setBankHolder(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>계좌번호</label>
                  <input
                    inputMode="numeric"
                    className={inputCls}
                    value={bankAccount}
                    onChange={(e) => setBankAccount(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 디자이너 */}
          <div>
            <label className="mb-1 block text-body-sm font-medium text-primary">디자이너</label>
            {rows === null ? (
              <p className="text-caption text-primary-50">불러오는 중…</p>
            ) : (
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <input
                    key={r.id ?? `new-${i}`}
                    className={inputCls}
                    value={r.name}
                    onChange={(e) => setRow(i, e.target.value)}
                    placeholder={`디자이너 ${i + 1}`}
                  />
                ))}
                <button type="button" onClick={addRow} className="text-caption font-semibold text-secondary">
                  + 디자이너 추가
                </button>
              </div>
            )}
            <p className="mt-2 text-caption text-primary-50">
              디자이너 삭제를 원하시면 운영자에게 연락해주세요.
            </p>
          </div>

          {err && <p className="rounded-md bg-danger-bg px-3 py-2 text-caption text-danger">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={attemptSave}
              disabled={save.isPending}
              className="flex-1 rounded-lg bg-secondary py-2.5 text-body-sm font-semibold text-white disabled:opacity-50"
            >
              {save.isPending ? '저장 중…' : '저장'}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-neutral-300 px-4 py-2.5 text-body-sm font-semibold text-primary"
            >
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
