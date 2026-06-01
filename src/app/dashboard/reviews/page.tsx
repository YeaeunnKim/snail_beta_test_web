import { PageStub } from '@/components/ui/page-stub';

export default function ReviewsPage() {
  return (
    <PageStub
      title="리뷰 관리"
      description="내 샵 리뷰를 조회하고 답글을 작성합니다. shop_id는 shopApi.getMyShop()의 id를 사용하세요."
      apis={['reviewsApi.listReviewsForShop(shopId, query)', 'reviewsApi.createReply(reviewId, body)']}
    />
  );
}
