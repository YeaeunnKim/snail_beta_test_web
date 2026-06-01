import { PageStub } from '@/components/ui/page-stub';

export default function DesignersPage() {
  return (
    <PageStub
      title="디자이너 관리"
      description="디자이너 등록/수정/삭제, 주간 스케줄(요일별 7건), 휴무 관리."
      apis={[
        'designersApi.listDesigners()',
        'designersApi.createDesigner(body) / updateDesigner(id, body) / deleteDesigner(id)',
        'designersApi.setSchedule(id, { entries })',
        'designersApi.addTimeOff(id, body) / deleteTimeOff(id, timeOffId)',
      ]}
    />
  );
}
