import { PageStub } from '@/components/ui/page-stub';

export default function ShopPage() {
  return (
    <PageStub
      title="샵 관리"
      description="샵 정보(이름/주소/결제 정책/계좌), 영업시간(요일별 7건), 샵 이미지 관리. 샵이 없으면 생성 폼을 노출하세요."
      apis={[
        'shopApi.getMyShop()',
        'shopApi.createMyShop(body) / shopApi.updateMyShop(body)',
        'shopApi.setBusinessHours({ entries })',
        'shopApi.addImage(body) / shopApi.deleteImage(imageId)',
      ]}
    />
  );
}
