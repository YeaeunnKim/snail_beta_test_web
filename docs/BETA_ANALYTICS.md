# 베타 사장 웹 지표

- 수동 페이지뷰와 로그인, 예약 상태 전이, 디자인 정렬 요청/완료만 PostHog로 전송한다.
- 자동 클릭 수집, 세션 리플레이, 프론트 오류, web vitals, survey, feature flag 요청은 끈다.
- 대표자명, 이메일, 전화번호, 예약자 정보, 답변·취소 사유, 폴더명, 이미지 URL은 전송하지 않는다.
- 예약 상태와 디자인 생성 수량의 권위 데이터는 백엔드 DB이며 PostHog는 사용 흐름만 본다.

배포 환경에 아래 변수를 넣어 활성화한다. `NEXT_PUBLIC_ANALYTICS_ENABLED=0`이거나 키가
비어 있으면 초기화 및 네트워크 전송이 모두 생략된다.

```text
NEXT_PUBLIC_ANALYTICS_ENABLED=1
NEXT_PUBLIC_POSTHOG_KEY=<public project key>
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

PostHog 프로젝트 설정에서도 autocapture와 session replay를 꺼 두고, 베타 종료 시 enabled를
`0`으로 바꾼 뒤 재배포한다.
