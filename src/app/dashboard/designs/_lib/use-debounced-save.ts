'use client';

/**
 * ± 스테퍼 연타를 한 번의 저장으로 합친다.
 * 마지막 값만 delayMs 후 1회 저장하고, 언마운트 시 대기 중인 저장이 있으면 버리지 않고 즉시 발화한다.
 * (편집 직후 컴포넌트가 사라져도 — 예: "수정 OFF" 토글로 DesignerRows 언마운트 — 마지막 값이 유실되지 않도록.)
 */
import { useCallback, useEffect, useRef } from 'react';

export function useDebouncedSave<T>(save: (v: T) => void, delayMs = 800): (v: T) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  const pending = useRef<{ value: T } | null>(null); // 아직 발화 안 된 마지막 값(없으면 null)

  // 최신 save를 항상 참조 — 의존성 때문에 타이머가 재설정되는 걸 막는다
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      // 언마운트 시 대기 중인 저장이 있으면 flush한다(무음 유실 방지).
      if (pending.current) {
        saveRef.current(pending.current.value);
        pending.current = null;
      }
    };
  }, []);

  return useCallback(
    (v: T) => {
      if (timer.current) clearTimeout(timer.current);
      pending.current = { value: v };
      timer.current = setTimeout(() => {
        pending.current = null;
        saveRef.current(v);
      }, delayMs);
    },
    [delayMs],
  );
}
