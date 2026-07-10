# WO-01 — AGENTS.md(SSOT)+CLAUDE.md 신설 + fork 잔재/낡은 라우트 문서 수정 (beta web)

## 배경
이 repo는 `snail_owner_web`를 **복사해 만든 베타 테스트용 fork**인데, 코드는 갈라졌지만 에이전트 문서/브랜딩이 원본 그대로 방치됐다.
Claude용 진입점(AGENTS.md/CLAUDE.md/.claude) 이 전혀 없고, 도구 문서들이 **존재하지 않는 라우트**를 가리킨다.

## 사실 (조사로 확인 — 재유추 말 것)
- 스택: Next.js 15.1.6 App Router / React 19 / TS 5.7 strict / pnpm 11.5.0 / Tailwind v4 / Zustand / TanStack Query / RHF+Zod / openapi-typescript.
- 정체: 네일 예약 플랫폼 사장님 웹의 **베타 테스트(모바일 웹) 변형**. 원본 = snail_owner_web.
- **fork 잔재(수정 대상)**:
  - `package.json` `name` 이 `"snail-owner-web"` → `"snail-beta-test-web"` 로. description은 유지하되 "(베타 테스트)" 뉘앙스 추가 가능. **name/description 문자열만, 의존성/스크립트 절대 변경 금지.**
  - `README.md` 제목이 `# Snail Owner Web`, clone URL이 `github.com/poi82999/snail_owner_web.git` (다른 repo!) → 실제 repo `github.com/YeaeunnKim/snail_beta_test_web.git` 로 고치고 "베타 테스트용 fork"임을 명시.
- **실제 라우트**(`src/app/`): `(auth)/{login,register,password-reset}`, `(gate)/{business-verification,pending}`, `dashboard/{designs,notifications,schedule,shop}`, `onboarding/`.
  문서들이 말하는 `(dashboard)/reservations`, `(dashboard)/reviews` 는 **없다**(기능이 `schedule/`·`notifications/`로 흡수됨). `(gate)/`·`onboarding/` 은 어느 문서에도 없음.
- 검증: `pnpm typecheck && pnpm lint && pnpm build`. 자동 테스트 없음, CI 없음.
- 계약: `backend-context/owner_web.ai.txt` → `api_cookbook.ai.txt` → `openapi.json`. `src/types/api.d.ts` 자동생성(손수정 금지). 배포는 backend repo `tools/sync_contract.ps1`.
  현재 backend-context가 stale/불완전(일부 .ai.txt 없음) — **이 문제는 사령관이 sync_contract 로 별도 처리하므로 너는 backend-context를 건드리지 마라.**
- 베타 특이사항: `BETA_AUTO_APPROVE_OWNERS` 자동승인 플로우 존재(가입 즉시 승인). 상세/알려진 이슈는 `docs/OWNER_WEB_GAPS.md`(오늘자, 잘 관리됨)에 있음 — AGENTS.md에서 참조.
- 알려진 버그(참조만): `GET /shops/me/designs` 응답이 envelope로 바뀌어 `designs.map is not a function` 크래시 가능 → api.d.ts stale. (수정은 이 WO 범위 아님, AGENTS.md 함정에 링크만.)
- 큰 파일 주의(참조만): `src/app/dashboard/designs/page.tsx` 1,218줄(인라인 컴포넌트 다수) — AGENTS.md에 "편집 시 blast-radius 큼" 명시.

## 작업
1. `AGENTS.md`(SSOT) 작성 — 맨 위: "이 파일이 에이전트 가이드 SSOT. CLAUDE.md·.cursorrules·.gemini/.github 는 이 파일을 가리킨다. 이 repo는 snail_owner_web의 베타 fork다."
   섹션: 0.프로젝트(베타 fork 명시) 1.실행·검증 2.백엔드 계약(읽는 순서+api.d.ts 자동생성) 3.**실제 라우트/구조**(위 실제 목록 그대로) 4.함정(designs.map 크래시·api.d.ts stale·auto-approve·designs/page.tsx 대형파일) 5.코드 스타일. 200줄 이내.
2. `CLAUDE.md` 신설 — 얇은 포인터(→ AGENTS.md).
3. `.cursorrules`, `.gemini/AGENTS.md`, `.github/copilot-instructions.md` → 얇은 포인터로 교체. 특히 **없는 라우트 서술 삭제**하고 "라우트/구조는 AGENTS.md 참조".
4. `docs/ARCHITECTURE.md` — 낡은 라우트/폴더 구조(`components/features/design/` 등 실재 안 함)를 실제 구조로 수정하거나, 실제 구조 섹션을 추가하고 상단에 `⚠️ 일부 낡음` 배너.
5. `package.json`, `README.md` fork 잔재 수정(위 사실대로).

## 완료 조건
- AGENTS.md(SSOT)+CLAUDE.md 존재, 도구 문서는 포인터, 없는 라우트 서술 제거.
- package.json name 수정(의존성/스크립트 무변경), README clone URL/제목 수정.
- backend-context/ 및 src/ 코드 무변경.
- 마지막 출력: 수정 파일 목록 / 요약 / 가정·우려.

<!-- ALLOWED-FILES-START
AGENTS.md
CLAUDE.md
.cursorrules
.gemini/AGENTS.md
.github/copilot-instructions.md
docs/ARCHITECTURE.md
package.json
README.md
ALLOWED-FILES-END -->
