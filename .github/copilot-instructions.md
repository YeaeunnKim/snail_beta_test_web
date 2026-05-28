# Snail Owner Web — GitHub Copilot Instructions

이 프로젝트는 네일 예약 플랫폼 Snail의 사장님 관리 웹 대시보드입니다.

## 백엔드 API

API 관련 코드 작성 시 `backend-context/` 폴더의 파일을 참조하세요:
- `backend-context/owner_web.ai.txt` — 사장님 웹 전용 API 번들
- `backend-context/api_cookbook.ai.txt` — 작업별 API 호출 레시피
- `backend-context/openapi.json` — 전체 OpenAPI 스펙

## 필수 규칙

- 인증: `Authorization: Bearer <token>` 헤더
- 변이 요청에 `Idempotency-Key: <UUID>` 헤더 필수
- 에러 분기: `error.code` 필드 사용
- 페이지네이션: cursor 기반 (`next_cursor` → `cursor`)
- 토큰 만료(401) 시 자동 갱신
- TypeScript 타입은 `openapi-typescript`로 생성

## 기술 스택

- Next.js 15 (App Router), TypeScript, Tailwind CSS 4
- Zustand (클라이언트 상태), React Hook Form + Zod
- React Server Components 우선
