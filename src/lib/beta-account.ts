/**
 * 베타 계정 헬퍼 — 인스타그램 아이디 기반 회원가입/로그인.
 *
 * 백엔드 인증은 이메일+비밀번호를 요구하지만, 베타 테스터는 인스타 아이디로만
 * 가입/로그인한다. 그래서 인스타 핸들을 결정적(deterministic) 이메일로 매핑한다.
 *   "@Sujin_nail" → "sujin_nail@beta.snail.app"
 * 같은 핸들이면 항상 같은 이메일이 나오므로 로그인 때도 동일하게 매핑하면 된다.
 */

/** 인스타 핸들 도메인 (백엔드에 실제 메일 발송은 하지 않는 더미 도메인) */
export const BETA_EMAIL_DOMAIN = 'beta.snail.app';

/** 입력에서 @, 공백, URL 접두어 등을 제거해 핸들만 남긴다. */
export function normalizeInstagramHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** 유효한 인스타 핸들 형식인지 (영문/숫자/밑줄/마침표, 1~30자). */
export function isValidInstagramHandle(handle: string): boolean {
  return /^[a-z0-9._]{1,30}$/.test(handle);
}

/** 인스타 핸들 → 로그인용 이메일. 이미 이메일 형식이면 그대로 사용. */
export function instagramToEmail(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('@') && trimmed.includes('.') && !trimmed.startsWith('@')) {
    // 이미 이메일을 입력한 경우(운영자 시드 계정 등)는 그대로 로그인 허용.
    return trimmed.toLowerCase();
  }
  return `${normalizeInstagramHandle(raw)}@${BETA_EMAIL_DOMAIN}`;
}
