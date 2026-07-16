'use client';

/**
 * ± 스테퍼 연타를 한 번의 저장으로 합친다.
 * 마지막 값만 delayMs 후 1회 저장하고, 언마운트 시 대기 중인 저장을 버린다.
 */
import { useCallback, useEffect, useRef } from 'react';

export function useDebouncedSave<T>(save: (v: T) => void, delayMs = 800): (v: T) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);

  // 최신 save를 항상 참조 — 의존성 때문에 타이머가 재설정되는 걸 막는다
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return useCallback(
    (v: T) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => saveRef.current(v), delayMs);
    },
    [delayMs],
  );
}
