/**
 * 서비스 레이어 배럴.
 * 화면에서는 네임스페이스로 가져다 쓴다.
 *   import { authApi, shopApi } from '@/services';
 *   await authApi.login({ email, password });
 */
export * as authApi from './auth';
export * as ownersApi from './owners';
export * as shopApi from './shop';
export * as designersApi from './designers';
export * as designsApi from './designs';
export * as reservationsApi from './reservations';
export * as reviewsApi from './reviews';
export * as inquiriesApi from './inquiries';
export * as chatApi from './chat';
export * as notificationsApi from './notifications';
export * as snailsApi from './snails';
export * as uploadsApi from './uploads';

export * from './types';
