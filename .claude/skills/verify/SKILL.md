---
name: verify
description: Snail Beta Test Web 런타임 검증 하네스 — approved-owner 세션 주입 + /api/v1 인터셉트로 실제 앱을 구동해 UI 동작을 관찰한다. 백엔드 없이 에러/부분실패/성공 응답을 주입해 예외 표면화·상태 분기를 실측한다.
---

# Snail Beta Test Web — Verify 하네스

백엔드를 띄우지 않고, **시스템 Chrome + playwright-core로 실제 Next.js 앱을 구동**하면서
`**/api/v1/**` 요청을 인터셉트해 시나리오별 응답(성공/에러/부분실패)을 주입한다. 미들웨어·인증·
TanStack Query 재시도까지 실제 코드가 그대로 돈다. (owner 웹 하네스에서 이식)

> ⚠️ **미실행 이식본**: 코드 정독 기반 이식이며 아직 로컬 1회 미구동(현 Windows 환경에서 pnpm이
> node_modules 심링크/.bin을 생성하지 못해 `next dev` 실행 불가). 처음 실행하는 사람은
> designs 화면의 셀렉터(새 디자인/새 폴더 버튼 라벨, 에러 UI 문구)를 실제 렌더와 대조해
> 미세조정할 것. 특히 폴더/디자이너 에러 표면화 UI는 owner와 다를 수 있다.

## beta vs owner 차이 (이식 시 반영한 것)

beta는 owner의 **fork**라 인증·백엔드 계약이 동일하다(같은 쿠키/토큰 키, 같은 `/shops/me/*` 봉투).
다른 점은 **라우트/셸**이다:

| 항목 | owner 웹 | **beta 웹 (이 하네스)** |
|---|---|---|
| 셸 | 데스크톱 대시보드 | **모바일 셸**(max-w-md, 하단 탭 디자인/일정/샵/알림) |
| 랜딩 | `/dashboard` 스탯 화면 | **`/dashboard` → `/dashboard/designs` 리다이렉트** (스탯 화면 없음) |
| 주 화면 | dashboard 스탯카드/타임라인 | **`/dashboard/designs`** (폴더+미분류 디자인) |
| 없는 라우트 | — | owner의 designers/inquiries/reservations/reviews/timeline/verification **없음** |

따라서 owner의 `/dashboard` 스탯카드 시나리오(b7-*)는 **부적용**이고, designs 화면 중심으로 구성한다.
viewport는 모바일 셸에 맞춰 430×1400.

## 사전 준비 (콜드스타트 ~2분)

1. **의존성**: `node_modules` 존재 확인(`pnpm install --frozen-lockfile`). 폰트(`pretendard`) 누락 시 복구.
2. **playwright-core (앱 package.json 오염 금지)**: 격리 디렉터리에서 `npm init -y && npm i playwright-core`.
3. **시스템 Chrome**: `C:\Program Files\Google\Chrome\Application\chrome.exe` (`executablePath` 사용).
4. **dev 서버 (포트 3100 고정)**:
   ```bash
   nohup pnpm exec next dev -p 3100 > /tmp/verify/next.log 2>&1 &
   ```

## 인증 주입 (approved-owner 세션)

미들웨어는 presence 쿠키 하나만 확인하고, 클라이언트 인증은 zustand bootstrap이 토큰으로
`GET /owners/me`를 호출해 결정한다. `/dashboard`는 layout 가드가 `isApproved`(=/owners/me의
verification_status) + `useMyShop`(/shops/me) 성공을 요구한다. 따라서:

- **쿠키**: `snail_owner_authed=1` (domain localhost) → 미들웨어 통과.
- **토큰**: `addInitScript`로 `localStorage['snail.owner.access_token']='test-access'`(+refresh) → `hasTokens()` true.
- **인터셉트**: `GET /owners/me` → approved Owner, `GET /shops/me` → Shop(id 포함) → 가드 통과 후 designs 렌더.
  (샵이 null이면 `/onboarding`으로 리다이렉트되므로 반드시 Shop을 반환할 것.)

## API 응답 형태 (인터셉트 시 정확히 맞출 것)

| 엔드포인트 | 형태 |
|---|---|
| `GET /owners/me` | `{ id, verification_status:'approved', ... }` |
| `GET /shops/me` | `{ id:'shop1', name, visibility:'active', business_hours:[…] }` (null이면 온보딩 리다이렉트) |
| `GET /shops/me/designers` | **bare array** `[{id,name}]` |
| `GET /shops/me/design-folders` | **bare array** `[{id,name,design_count}]` |
| `GET /shops/me/designs` | 봉투 `{ data:[…], page:{has_next,next_cursor} }` — `collectAll`이 커서 추적(`unfiled`/`folder_id` 쿼리로 구분) |

## ⚠️ 재시도 gotcha (캡처 타이밍)

`lib/query-client.ts`: **5xx/429/network 에러는 2회 지수백오프 재시도**
(`retryDelay = min(1000*2^attempt, 8000)`). 4xx(429제외)는 즉시. mutation은 재시도 안 함.
- 5xx로 에러 UI를 관찰하려면 **≥5초 대기** 후 캡처(하네스 error 시나리오가 `wait:5200`).
- 폴더 생성 409 등 mutation 에러는 즉시 관찰 가능.

## ⚠️ `.next` 캐시 손상 gotcha ("app router not mounted")

dev 서버 재시작·파일 변경 후 `.next` 캐시가 어긋나면 전역 auth bootstrap의 `useRouter`가
모든 페이지에서 크래시("Application error")날 수 있다.
- **판별**: 변경 안 한 화면까지 같은 스택으로 크래시하면 캐시 문제.
- **해결**: 서버 종료 → `rm -rf .next` → 포트 3100 잔존 node(`Get-NetTCPConnection -LocalPort 3100`의 `OwningProcess`) 강제종료 → 클린 재시작.
- 하네스는 `setDefaultTimeout(12000)` + "Application error면 최대 3회 리로드" 가드를 둔다.

## 실행

`harness.cjs`가 fixture(인증+base 응답+인터셉트)와 시나리오 드라이버를 담는다.
배치마다 `SCENARIOS` 객체만 교체/추가한다. 각 시나리오: `{ url, wait, override(path,method,searchParams,url), clickNewDesign?, createFolder?, openFolder?, clickRetry? }`.

```bash
node harness.cjs                        # 전체
SCEN=designs-folders-error node harness.cjs   # 하나만
```

스크린샷 + `signals`(folderName/designCount/loading/errorRetry/appError) + consoleErrors를 찍고 `shots/results.json`에 저장.

## 정리

검증 후 dev 서버 종료: 포트 3100 PID만 종료하거나 `nohup` 백그라운드 job을 kill.
`taskkill //F //IM node.exe` 지양. 다음 세션이 재사용하면 그대로 둬도 됨.

## 기본 시나리오

- **baseline**: `/dashboard/designs` 폴더 + 미분류 디자인 렌더.
- **designs-folders-error**: 폴더 목록 503 → 에러 표면화(≥5s 후 관찰).
- **designs-designers-error**: 새 디자인 폼의 디자이너 목록 500.
- **folder-create-409**: 폴더 생성 409(FOLDER_NAME_TAKEN) → 구체 문구.
- **designs-paginated**: 봉투 has_next 2페이지(총 25개)를 collectAll이 전부 수집.
