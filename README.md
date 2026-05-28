# 🐌 Snail Owner Web — 사장님 관리 웹

네일 예약 플랫폼 **Snail**의 사장님(샵 오너) 관리 웹 대시보드입니다.

## 핵심 기능

- 🔐 **계정 관리** — 회원가입, 로그인, 비밀번호 재설정
- 📋 **사업자 인증** — 사업자등록증 제출 및 승인 상태 확인
- 🏪 **샵 관리** — 샵 정보, 영업시간, 이미지, 결제 설정
- 💅 **디자이너 관리** — 디자이너 등록, 스케줄, 휴무 관리
- 🎨 **디자인 관리** — 디자인 등록, AI 분석 상태, 옵션, 공개/비공개 전환
- 📅 **예약 관리** — 예약 승인/거절, 결제 확인, 완료/노쇼 처리
- ⭐ **리뷰 관리** — 리뷰 확인, 답글 작성
- 🔔 **알림** — 예약/리뷰 알림 확인

---

## 기술 스택

| 항목 | 선택 |
|---|---|
| 프레임워크 | **Next.js 15** (App Router) |
| 언어 | **TypeScript 5.5+** |
| 스타일링 | **Tailwind CSS 4** |
| 상태 관리 | React Server Components + **Zustand** (클라이언트) |
| 폼 | **React Hook Form** + **Zod** |
| HTTP | **fetch** (Next.js 내장) + 커스텀 API 클라이언트 |
| 타입 생성 | **openapi-typescript** (OpenAPI → TypeScript 타입) |
| 패키지 매니저 | **pnpm** |
| 배포 | **Vercel** (권장) 또는 Firebase Hosting |

## 개발 환경

| 항목 | 최소 요구 |
|---|---|
| Node.js | 20.0 이상 |
| pnpm | 9.0 이상 |
| 브라우저 | Chrome/Safari 최신 |

## 시작하기

```bash
# 1. 레포 클론
git clone https://github.com/poi82999/snail_owner_web.git
cd snail_owner_web

# 2. 의존성 설치
pnpm install

# 3. 환경 변수 설정
cp .env.example .env.local
# .env.local에서 API URL 등 수정

# 4. OpenAPI 타입 생성 (선택)
pnpm run generate:types

# 5. 개발 서버 실행
pnpm dev
# → http://localhost:3000
```

## 백엔드 API 참조

| 리소스 | URL |
|---|---|
| API 스펙 (GitHub Pages) | https://poi82999.github.io/snail_backend_specification/ |
| OpenAPI JSON | https://poi82999.github.io/snail_backend_specification/openapi.json |
| **사장님 웹 AI 컨텍스트** | https://poi82999.github.io/snail_backend_specification/owner_web.ai.txt |
| API 쿡북 | https://poi82999.github.io/snail_backend_specification/api_cookbook.ai.txt |

> 💡 **AI 코딩 시**: `owner_web.ai.txt`를 AI 도구에 컨텍스트로 넣으면 인증, 샵 관리, 디자인 등록, 예약 운영 화면을 바로 구현할 수 있습니다.

## 환경 변수

| 키 | 설명 | 기본값 |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | 백엔드 API 주소 | `http://localhost:8000/api/v1` |
| `NEXT_PUBLIC_APP_NAME` | 앱 이름 | `스네일 사장님` |
| `NEXT_PUBLIC_GITHUB_PAGES_URL` | API 문서 URL | (옵션) |

## 브랜치 전략

| 브랜치 | 용도 |
|---|---|
| `main` | 프로덕션 (Vercel 자동 배포) |
| `develop` | 통합 브랜치 (기능 머지 → QA) |
| `feature/이슈번호-설명` | 기능 개발 |
| `fix/이슈번호-설명` | 버그 수정 |

## 코드 스타일

- **ESLint** + **Prettier** 적용
- 커밋 메시지: [Conventional Commits](https://www.conventionalcommits.org/) 형식

자세한 기여 가이드는 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

## 페이지 구조 (예정)

```
app/
├── (auth)/
│   ├── login/page.tsx
│   ├── signup/page.tsx
│   └── password-reset/page.tsx
├── (dashboard)/
│   ├── layout.tsx                 # 사이드바 + 헤더
│   ├── page.tsx                   # 대시보드 홈
│   ├── verification/page.tsx      # 사업자 인증
│   ├── shop/
│   │   ├── page.tsx               # 샵 정보
│   │   ├── hours/page.tsx         # 영업시간
│   │   └── images/page.tsx        # 샵 이미지
│   ├── designers/
│   │   ├── page.tsx               # 디자이너 목록
│   │   └── [id]/page.tsx          # 디자이너 상세/스케줄
│   ├── designs/
│   │   ├── page.tsx               # 디자인 목록
│   │   ├── new/page.tsx           # 디자인 등록
│   │   └── [id]/page.tsx          # 디자인 상세/옵션
│   ├── reservations/
│   │   ├── page.tsx               # 예약 목록 (캘린더/리스트)
│   │   └── [id]/page.tsx          # 예약 상세
│   ├── reviews/page.tsx           # 리뷰 관리
│   └── notifications/page.tsx     # 알림
└── api/                           # (선택) BFF 엔드포인트
```

## 관련 레포

| 레포 | 설명 |
|---|---|
| [snail_backend_specification](https://github.com/poi82999/snail_backend_specification) | 백엔드 명세서 + API 코드 |
| [snail_ios](https://github.com/poi82999/snail_ios) | 유저 iOS 앱 |
