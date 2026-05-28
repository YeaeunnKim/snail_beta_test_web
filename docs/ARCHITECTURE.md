# 🏗️ Snail Owner Web 아키텍처

## Next.js App Router 구조

### 라우트 그룹

```
app/
├── (auth)/              # 인증 관련 (로그인 레이아웃)
│   ├── layout.tsx       # 인증 페이지 전용 레이아웃 (센터 정렬, 로고)
│   ├── login/
│   ├── signup/
│   └── password-reset/
│
├── (dashboard)/         # 인증 필요 (대시보드 레이아웃)
│   ├── layout.tsx       # 사이드바 + 헤더 + 인증 가드
│   ├── page.tsx         # 대시보드 홈 (오늘의 예약 요약)
│   ├── verification/    # 사업자 인증
│   ├── shop/            # 샵 관리
│   ├── designers/       # 디자이너 관리
│   ├── designs/         # 디자인 관리
│   ├── reservations/    # 예약 관리
│   ├── reviews/         # 리뷰 관리
│   └── notifications/   # 알림
│
└── layout.tsx           # 루트 레이아웃 (폰트, 메타데이터)
```

---

## 인증

### 흐름

```
사장님                   웹                         백엔드
  │                     │                           │
  │  이메일/비밀번호 입력  │                           │
  │────────────────────►│                           │
  │                     │  POST /auth/owner/login   │
  │                     │─────────────────────────►│
  │                     │                           │
  │                     │  access + refresh token   │
  │                     │◄─────────────────────────│
  │                     │                           │
  │                     │  localStorage에 저장       │
  │                     │                           │
  │  대시보드 진입        │                           │
  │◄────────────────────│                           │
```

### 토큰 관리

- **access_token**: 1시간 만료 → `localStorage` (또는 `httpOnly cookie`)
- **refresh_token**: 30일 만료 → `localStorage`
- **자동 갱신**: API 클라이언트에서 401 응답 시 자동으로 `/auth/refresh` 호출

### 인증 가드

```typescript
// (dashboard)/layout.tsx
export default function DashboardLayout({ children }) {
  // 서버 컴포넌트에서는 쿠키 확인
  // 클라이언트에서는 useAuth() 훅으로 리다이렉트
}
```

### 온보딩 분기

로그인 후 `GET /owners/me`의 `verification_status`에 따라:

| 상태 | 행동 |
|---|---|
| `pending` | 사업자 인증 대기 화면 표시 |
| `rejected` | 재제출 안내 + 거부 사유 표시 |
| `approved` | 대시보드 진입 |

---

## API 클라이언트

### 구조

```
src/lib/
├── api-client.ts        # fetch wrapper (인증, 멱등성, 에러 처리)
├── api-error.ts         # 에러 타입 정의
└── token.ts             # 토큰 저장/조회/갱신
```

### 핵심 기능

1. **자동 인증 헤더**: Bearer 토큰 자동 삽입
2. **멱등성 키**: 변이 요청에 UUID 자동 생성
3. **토큰 자동 갱신**: 401 → refresh → 재시도
4. **에러 정규화**: 서버 에러 → `ApiError` 객체
5. **타입 안전**: OpenAPI에서 생성한 타입 사용

---

## 상태 관리

### React Server Components (RSC)

- 서버에서 데이터 fetch → 클라이언트에 props로 전달
- 초기 페이지 로드 최적화

### Zustand (클라이언트 상태)

```typescript
// src/stores/auth-store.ts
interface AuthStore {
  owner: Owner | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}
```

사용 범위:
- **전역**: 인증 상태, 사장님 정보
- **로컬**: 각 페이지의 필터/정렬 상태는 `useState` 또는 URL search params

---

## OpenAPI 타입 생성

### 워크플로우

```bash
# 1. 최신 OpenAPI 스펙에서 TypeScript 타입 생성
pnpm run generate:types

# 내부적으로 실행되는 명령:
# openapi-typescript https://poi82999.github.io/snail_backend_specification/openapi.json -o src/types/api.d.ts
```

### 사용 예시

```typescript
import type { paths, components } from '@/types/api';

// 응답 타입
type ShopResponse = components['schemas']['OwnerShopResponse'];

// 요청 타입
type CreateDesignBody = components['schemas']['DesignCreateRequest'];
```

---

## 주요 페이지별 API 매핑

| 페이지 | 핵심 API | 비고 |
|---|---|---|
| 로그인 | `POST /auth/owner/login` | |
| 회원가입 | `POST /auth/owner/signup` | |
| 사업자 인증 | `POST /owners/me/business-verification` | 파일 업로드 포함 |
| 샵 정보 | `GET/POST/PATCH /shops/me` | |
| 영업시간 | `PUT /shops/me/business-hours` | 7일 일괄 설정 |
| 디자이너 | `CRUD /shops/me/designers` | 스케줄 PUT 포함 |
| 디자인 목록 | `GET /shops/me/designs` | AI 분석 상태 표시 |
| 디자인 등록 | `POST /shops/me/designs` | 이미지 업로드 → object key |
| 예약 목록 | `GET /shops/me/reservations` | 날짜/상태 필터 |
| 예약 액션 | `POST .../accept\|reject\|confirm-payment\|complete\|no-show\|cancel` | 상태 전이 |
| 리뷰 | `GET /shops/{id}/reviews` + `POST /reviews/{id}/replies` | 답글 작성 |

---

## 디렉토리 구조 (예정)

```
src/
├── app/                    # Next.js App Router
├── components/
│   ├── ui/                 # 공통 UI (Button, Input, Modal, ...)
│   ├── layout/             # Header, Sidebar, Footer
│   └── features/           # 기능별 컴포넌트
│       ├── reservation/
│       ├── design/
│       └── designer/
├── hooks/                  # 커스텀 훅
│   ├── use-auth.ts
│   └── use-api.ts
├── lib/                    # 유틸리티
│   ├── api-client.ts
│   ├── token.ts
│   └── utils.ts
├── stores/                 # Zustand 스토어
│   └── auth-store.ts
├── types/                  # TypeScript 타입
│   ├── api.d.ts            # (자동 생성)
│   └── index.ts
└── styles/
    └── globals.css         # Tailwind + 커스텀 스타일
```

---

## 배포

### Vercel (권장)

1. GitHub 레포 연결
2. Framework Preset: **Next.js**
3. Environment Variables 설정
4. `main` push → 자동 배포
5. PR → Preview 배포

### 환경별 URL

| 환경 | URL | 트리거 |
|---|---|---|
| Production | `https://owner.snail.example.com` | `main` push |
| Preview | `https://xxx.vercel.app` | PR 생성 |
| Local | `http://localhost:3000` | `pnpm dev` |
