# Snail Owner Web — AI Agent Instructions

이 프로젝트는 네일 예약 플랫폼 **Snail**의 사장님(샵 오너) 관리 웹 대시보드입니다.

## 백엔드 API 컨텍스트

이 레포의 `backend-context/` 폴더에 백엔드 API 명세가 동기화되어 있습니다.
**반드시 아래 파일들을 참조하여 API 호출 코드를 작성하세요.**

### 필수 참조 파일 (우선순위 순)

1. **`backend-context/owner_web.ai.txt`** — 사장님 웹 전용 API 번들
   - 인증 흐름 (이메일/비밀번호 → JWT)
   - 사업자 인증, 샵/디자이너/디자인 관리, 예약 운영 전체 API
   - 요청/응답 예시, 에러 코드, Enum 값 포함
   - **화면 구현 시 이 파일을 가장 먼저 읽으세요**

2. **`backend-context/api_cookbook.ai.txt`** — 작업지향 레시피
   - "디자인 등록 → AI 분석 → 공개" 같은 end-to-end 흐름
   - "예약 처리 보드" 같은 운영 흐름
   - 복붙 가능한 요청/응답 시퀀스

3. **`backend-context/openapi.json`** — 전체 OpenAPI 3.1 스펙
   - TypeScript 타입 자동 생성 시 사용 (`openapi-typescript`)
   - 모든 엔드포인트, 스키마, 에러 정의 포함

4. **`backend-context/local_onboarding.md`** — 로컬 개발 환경 가이드
   - Base URL, CORS, 개발 토큰 정보

### 동기화

```bash
# macOS/Linux
./scripts/sync-backend-docs.sh

# Windows
.\scripts\sync-backend-docs.ps1
```

## 아키텍처 규칙

- **Next.js 15** App Router 기반
- **TypeScript** strict 모드
- **Tailwind CSS 4** 스타일링
- **React Server Components** 서버 데이터 페칭 우선
- **Zustand** 클라이언트 전역 상태 (인증 등)
- **React Hook Form + Zod** 폼 검증

## 라우트 그룹

- `(auth)/` — 로그인, 회원가입, 비밀번호 재설정 (인증 불필요)
- `(dashboard)/` — 대시보드 전체 (인증 필수, 사이드바 레이아웃)

## API 연동 규칙

1. 모든 인증 요청에 `Authorization: Bearer <token>` 헤더를 포함하세요.
2. `POST/PUT/PATCH/DELETE` 요청에는 반드시 `Idempotency-Key: <UUID>` 헤더를 포함하세요.
3. 에러 응답은 `error.code` 필드로 분기 처리하세요 (에러 코드 목록은 `owner_web.ai.txt` 참고).
4. 페이지네이션은 cursor 기반입니다. 응답의 `next_cursor`를 다음 요청의 `cursor` 파라미터로 전달하세요.
5. 토큰 만료(401) 시 `POST /auth/refresh`로 자동 갱신하세요.
6. TypeScript 타입은 `openapi-typescript`로 `openapi.json`에서 생성하세요.

## 사장님 웹 핵심 페이지 흐름

1. 로그인 → `GET /owners/me`로 `verification_status` 확인
2. `pending`/`rejected`이면 사업자 인증 화면으로 유도
3. `approved`이면 대시보드 진입
4. 예약 상태 전이: `pending → accept/reject`, `payment_pending → confirm-payment`, `confirmed → complete/no-show/cancel`

## 프로젝트 구조

- `docs/ARCHITECTURE.md` — 상세 아키텍처 설명
- `.env.example` — 환경 변수 템플릿

## 코드 스타일

- ESLint + Prettier 규칙 준수
- 한국어 주석 사용 (비즈니스 로직)
- Conventional Commits 형식 (`feat:`, `fix:`, `refactor:` 등)
