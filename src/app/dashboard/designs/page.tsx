import { PageStub } from '@/components/ui/page-stub';

export default function DesignsPage() {
  return (
    <PageStub
      title="디자인 관리"
      description="디자인 목록(AI 분석 상태 표시), 등록, 옵션 관리, AI 완료 후 공개 전환. ai_analysis_status는 폴링/새로고침으로 확인."
      apis={[
        'designsApi.listDesigns() / getDesign(id)',
        'designsApi.createDesign(body) / updateDesign(id, body) / deleteDesign(id)',
        'designsApi.listOptions/createOption/updateOption/deleteOption',
        'designsApi.reanalyze(id) / changeVisibility(id, { visibility })',
      ]}
    />
  );
}
