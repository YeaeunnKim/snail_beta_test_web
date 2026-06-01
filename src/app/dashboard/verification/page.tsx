import { PageStub } from '@/components/ui/page-stub';

export default function VerificationPage() {
  return (
    <PageStub
      title="사업자 인증"
      description="사업자등록번호 + 등록증 object key 제출. 현재 인증 상태도 함께 표시하세요. (업로드 계약은 백엔드와 별도 확인)"
      apis={[
        'ownersApi.getBusinessVerification()',
        'ownersApi.submitBusinessVerification({ business_registration_number, document_object_key })',
      ]}
    />
  );
}
