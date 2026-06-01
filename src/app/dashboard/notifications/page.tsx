import { PageStub } from '@/components/ui/page-stub';

export default function NotificationsPage() {
  return (
    <PageStub
      title="알림"
      description="사장님 인박스/샵 알림을 조회하고 읽음 처리합니다."
      apis={[
        'notificationsApi.listOwnerNotifications() / markOwnerNotificationRead(id) / markAllOwnerNotificationsRead()',
        'notificationsApi.listShopNotifications() / markShopNotificationRead(id)',
      ]}
    />
  );
}
