'use client';

import { useEffect } from 'react';

/** 모달이 떠 있는 동안 뒷배경 스크롤을 막는다. 모달 내부(overflow-y-auto 컨테이너)는 그대로 스크롤된다. */
export function useLockBodyScroll() {
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);
}
