import { redirect } from 'next/navigation';

/** 대시보드 진입 → 첫 탭(디자인 등록)으로. 가드는 dashboard/layout이 담당. */
export default function DashboardHome() {
  redirect('/dashboard/designs');
}
