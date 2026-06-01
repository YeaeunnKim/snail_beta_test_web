import { redirect } from 'next/navigation';

/** 루트 진입 시 대시보드로 보낸다. 미인증이면 미들웨어가 /login으로 다시 보낸다. */
export default function Home() {
  redirect('/dashboard');
}
