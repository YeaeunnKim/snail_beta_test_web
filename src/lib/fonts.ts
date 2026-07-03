/**
 * 셀프 호스팅 폰트 (Pretendard).
 *
 * 시스템에 프리텐다드가 설치돼 있지 않은 기기에서도 동일하게 보이도록,
 * next/font/local로 가변 폰트(woff2) 파일을 빌드에 포함해 직접 서빙한다.
 * layout.tsx의 <html>에 pretendard.variable을 붙이고,
 * globals.css @theme의 --font-sans가 이 CSS 변수를 참조한다.
 */
import localFont from 'next/font/local';

export const pretendard = localFont({
  src: '../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2',
  display: 'swap',
  weight: '45 920',
  variable: '--font-pretendard',
});
