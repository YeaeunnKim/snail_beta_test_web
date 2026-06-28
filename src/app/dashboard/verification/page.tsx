import { redirect } from 'next/navigation';

/**
 * 사업자 인증은 게이트 화면(/business-verification)으로 통합되었다.
 * 기존 경로/링크 호환을 위해 리다이렉트만 유지한다.
 */
export default function VerificationRedirect() {
  redirect('/business-verification');
}
