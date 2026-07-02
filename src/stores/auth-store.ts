/**
 * 인증 전역 상태 (Zustand).
 *
 * - 토큰 저장은 lib/token.ts가 담당하고, 여기서는 "현재 로그인한 사장님"과
 *   인증 진행 상태(status)를 들고 있는다.
 * - 화면에서는 useAuthStore 또는 hooks/use-auth.ts의 useAuth()를 사용한다.
 */
import { create } from 'zustand';
import { authApi, ownersApi } from '@/services';
import type { Owner, OwnerLoginRequest } from '@/services/types';
import { clearTokens, hasTokens } from '@/lib/token';
import { config } from '@/lib/config';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  owner: Owner | null;
  status: AuthStatus;
  /** 로그인 → 토큰 저장 → 내 정보 로드 */
  login: (credentials: OwnerLoginRequest) => Promise<Owner>;
  /** 앱 부팅 시 저장된 토큰으로 세션 복원 */
  bootstrap: () => Promise<void>;
  /** 내 정보 갱신 (인증 상태 변경 후 등) */
  refreshOwner: () => Promise<Owner | null>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  owner: null,
  status: 'idle',

  login: async (credentials) => {
    set({ status: 'loading' });
    try {
      await authApi.login(credentials);
      const owner = await ownersApi.getMe();
      set({ owner, status: 'authenticated' });
      return owner;
    } catch (e) {
      set({ status: 'unauthenticated' });
      throw e;
    }
  },

  bootstrap: async () => {
    if (!hasTokens()) {
      // 개발용 자동 로그인: 토큰이 없고 플래그가 켜져 있으면 시드 계정으로 로그인.
      if (config.devAutoLogin.enabled) {
        set({ status: 'loading' });
        try {
          await authApi.login({
            email: config.devAutoLogin.email,
            password: config.devAutoLogin.password,
          });
          const owner = await ownersApi.getMe();
          set({ owner, status: 'authenticated' });
          return;
        } catch {
          clearTokens();
          set({ status: 'unauthenticated', owner: null });
          return;
        }
      }
      set({ status: 'unauthenticated', owner: null });
      return;
    }
    set({ status: 'loading' });
    try {
      const owner = await ownersApi.getMe();
      set({ owner, status: 'authenticated' });
    } catch {
      // 토큰이 만료/무효면 정리하고 비로그인 처리
      clearTokens();
      set({ owner: null, status: 'unauthenticated' });
    }
  },

  refreshOwner: async () => {
    try {
      const owner = await ownersApi.getMe();
      set({ owner, status: 'authenticated' });
      return owner;
    } catch {
      return null;
    }
  },

  logout: () => {
    clearTokens();
    set({ owner: null, status: 'unauthenticated' });
  },
}));
