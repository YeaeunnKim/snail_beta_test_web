# 기여 가이드

Snail 사장님 웹 프로젝트에 기여해주셔서 감사합니다! 🐌

## 시작 전 준비

1. 이 레포를 fork 하거나 팀원이라면 직접 clone 합니다.
2. `develop` 브랜치에서 feature 브랜치를 생성합니다.
3. [README.md](README.md)의 개발 환경 섹션을 참고해 환경을 세팅합니다.

## 브랜치 네이밍

```
feature/123-예약-목록-페이지
fix/456-토큰-갱신-무한루프
refactor/789-api-클라이언트-구조
docs/101-페이지-라우팅-문서
```

- GitHub Issue 번호를 앞에 붙입니다.
- 설명은 한글 또는 영문 모두 가능합니다.
- 하이픈(`-`)으로 단어를 구분합니다.

## 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/) 형식을 따릅니다.

```
feat: 예약 목록 캘린더 뷰 구현
fix: 토큰 만료 시 무한 리다이렉트 수정
refactor: API 클라이언트를 fetch wrapper로 전환
docs: 페이지 라우팅 구조 문서 추가
test: 로그인 폼 유효성 검증 테스트 추가
chore: ESLint 규칙 업데이트
```

### 커밋 타입

| 타입 | 설명 |
|---|---|
| `feat` | 새로운 기능 |
| `fix` | 버그 수정 |
| `refactor` | 기능 변경 없는 코드 개선 |
| `docs` | 문서 변경 |
| `test` | 테스트 추가/수정 |
| `chore` | 빌드, CI, 의존성 등 |
| `style` | 코드 포맷팅 |
| `perf` | 성능 개선 |

## Pull Request

1. `develop` 브랜치를 대상으로 PR을 생성합니다.
2. PR 템플릿을 작성합니다 (자동 적용됨).
3. 최소 1명의 리뷰 승인 후 머지합니다.
4. **Squash and Merge**를 사용합니다.

## 코드 스타일

- **ESLint** + **Prettier** 규칙을 따릅니다.
- 저장 시 자동 포맷팅을 권장합니다.
- 한국어 주석을 적극 사용합니다 (특히 비즈니스 로직).

## API 연동 가이드

### 1. AI 컨텍스트 활용

AI 코딩 도구를 사용할 때는 아래 파일을 컨텍스트로 제공하세요:

```
https://poi82999.github.io/snail_backend_specification/owner_web.ai.txt
```

이 파일에는 사장님 웹에 필요한 모든 API 엔드포인트, 요청/응답 예시, 에러 코드, Enum 값이 포함되어 있습니다.

### 2. OpenAPI TypeScript 타입 자동 생성

```bash
# openapi-typescript 설치
pnpm add -D openapi-typescript

# 타입 생성 (package.json scripts에 등록 권장)
pnpm exec openapi-typescript https://poi82999.github.io/snail_backend_specification/openapi.json -o src/types/api.d.ts
```

생성된 타입을 활용하면 API 응답 타입을 수동으로 관리할 필요가 없습니다.

### 3. 공통 규칙

- **인증**: `Authorization: Bearer <access_token>` 헤더
- **멱등성**: `POST/PUT/PATCH/DELETE` 요청에 `Idempotency-Key` 헤더 필수
- **에러 처리**: 응답의 `error.code`로 분기 (에러 코드 목록은 AI 컨텍스트 파일 참고)
- **페이지네이션**: cursor 기반 (`next_cursor` → 다음 요청의 `cursor` 파라미터)

### 4. API 클라이언트 패턴

```typescript
// src/lib/api-client.ts (예시)
const apiClient = {
  async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const token = getAccessToken();
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(options?.method !== 'GET' && { 'Idempotency-Key': crypto.randomUUID() }),
        ...options?.headers,
      },
    });
    
    if (res.status === 401) {
      // 토큰 갱신 시도
      await refreshToken();
      return apiClient.fetch<T>(endpoint, options);
    }
    
    if (!res.ok) {
      const error = await res.json();
      throw new ApiError(error);
    }
    
    return res.json();
  }
};
```

## 질문이 있으면

- GitHub Issues에 등록하거나
- 팀 채팅에서 문의해주세요
