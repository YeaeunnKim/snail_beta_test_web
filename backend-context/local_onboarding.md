# 로컬 온보딩

이 문서는 앱/웹 개발자가 로컬 백엔드에 붙어 토큰을 받고 인증 호출까지 확인하는 최소 절차입니다.

## 주소

- API base URL: `http://localhost:8000/api/v1`
- Swagger UI: `http://localhost:8000/docs`
- Health check: `GET http://localhost:8000/api/v1/health`

`/docs`는 로컬/스테이징에서만 열립니다. prod 런타임 OpenAPI는 닫혀 있고, 정적 계약은 `docs/openapi.json`과 `docs/api_reference.html`을 사용합니다.

## Postman으로 호출해보기

복붙 없이 바로 눌러보려면 Postman을 사용합니다. 두 파일을 Postman에 import 합니다(`File → Import` 또는 워크스페이스 Import 버튼).

- `docs/snail.postman_collection.json` — 태그별로 정리된 102개 요청 + 최상단 `Flows (cookbook)` 폴더(로그인→검색→예약 같은 실제 흐름)
- `docs/snail.postman_environment.json` — `Snail Local` 환경. import 후 우상단에서 이 환경을 선택합니다.

쓰는 법:

1. 서버를 로컬에 띄웁니다(아래 기동 섹션). `base_url` 기본값은 `http://localhost:8000/api/v1`입니다.
2. `Flows (cookbook) → Flow A`의 `dev-login`을 Send 하면 `access_token`이 환경변수에 자동 저장되고, 이후 요청에 Bearer로 자동 첨부됩니다. 사장님 API는 `Flow B`의 로그인으로 `owner_access_token`이 채워집니다.
3. 폴더를 통째로 `Run folder` 하면 단계가 순서대로 돌며 다음 단계에 필요한 id(`design_id`, `reservation_id` 등)를 환경변수로 넘깁니다.
4. 변이 요청(POST/PATCH/DELETE)의 `Idempotency-Key`는 Send 할 때마다 새 UUID(`{{$guid}}`)로 자동 채워집니다.

이 두 파일은 `docs/openapi.json`에서 `python tools/build_postman_collection.py`로 자동 생성됩니다(수동 편집 금지 — 재생성 시 덮어쓰여집니다). 백엔드 API가 바뀌면 CI가 재생성·드리프트를 검사합니다.

## 프론트 작업자 — 명령어 한 방(권장)

프론트 작업자는 Repo 루트에서 아래 한 줄만 실행하면 API, PostgreSQL, Redis, 마이그레이션, 데모 시드가 모두 올라옵니다. Docker Desktop만 있으면 되고 Python/venv 준비는 필요 없습니다. Windows/macOS/Linux에서 같은 명령을 사용합니다.

```powershell
docker compose -f backend/docker/docker-compose.yml up --build
```

API 컨테이너는 실행할 때마다 `python scripts/seed.py --reset`으로 데모 데이터를 리셋합니다. 프론트에서 직접 만든 로컬 데이터는 다음 `up --build` 실행 때 초기화됩니다.

기동 후 `http://localhost:8000/api/v1/health` 응답의 `status`가 `ok`이면 DB/Redis까지 연결된 상태입니다. `POST /api/v1/auth/dev-login`에서 `seed_user_01`부터 `seed_user_20`까지 시드 유저를 사용할 수 있고, Android 에뮬레이터는 호스트 주소로 `http://10.0.2.2:8000`을 사용합니다.

## 백엔드 개발자용 기동

FE 반복 개발용으로 DB/Redis 기동, 마이그레이션, 시드 리셋까지 한 번에 준비하려면 Repo 루트(`c:\projects\backend specification`)에서 실행합니다.

```powershell
cd backend
.\scripts\dev_up.ps1
```

스크립트가 끝나면 별도 터미널에서 API 서버를 띄웁니다. Android 에뮬레이터가 호스트 머신에 접근하려면 `0.0.0.0` 바인딩이 필요합니다.

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

다른 터미널에서 헬스체크를 확인합니다.

```powershell
Invoke-RestMethod http://localhost:8000/api/v1/health
```

응답의 `status`가 `ok`이면 DB/Redis까지 연결된 상태입니다.

클라이언트에서 사용할 호스트:

- iOS 시뮬레이터: `http://localhost:8000`
- Android 에뮬레이터: `http://10.0.2.2:8000`

API 컨테이너까지 Docker Compose로 띄우는 프론트 작업자용 경로는 위의 명령어 한 방 섹션을 우선 사용합니다.

```powershell
docker compose -f backend/docker/docker-compose.yml up --build
```

## 사장님 개발 토큰 받기

로컬 DB에는 기본 계정이 자동 생성되지 않습니다. 사장님 계정을 한 번 가입한 뒤 로그인해서 토큰을 받습니다.

```powershell
$base = "http://localhost:8000/api/v1"
$email = "owner.local+$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())@example.com"
$password = "Password123!"

Invoke-RestMethod `
  -Method Post `
  -Uri "$base/auth/owner/signup" `
  -Headers @{ "Idempotency-Key" = [guid]::NewGuid().ToString() } `
  -ContentType "application/json" `
  -Body (@{
    email = $email
    password = $password
    representative_name = "로컬 사장님"
    phone_number = "010-0000-0000"
    accepted_terms_version = "2026-05-28"
    accepted_privacy_version = "2026-05-28"
  } | ConvertTo-Json)

$tokens = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/auth/owner/login" `
  -Headers @{ "Idempotency-Key" = [guid]::NewGuid().ToString() } `
  -ContentType "application/json" `
  -Body (@{
    email = $email
    password = $password
  } | ConvertTo-Json)

$accessToken = $tokens.access_token
```

인증 호출 예시:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "$base/owners/me" `
  -Headers @{ Authorization = "Bearer $accessToken" }
```

## 앱 유저 토큰

로컬 개발에서는 `POST /api/v1/auth/dev-login`으로 시드 유저 토큰을 받습니다. `dev_up.ps1` 또는 `python scripts/seed.py --reset` 후 `seed_user_01`부터 `seed_user_20`까지 사용할 수 있고, body를 생략하면 `seed_user_01`로 로그인합니다. 이 엔드포인트는 `Idempotency-Key` 헤더가 필요 없으며, `ENV=prod`에서는 404로 차단됩니다.

```powershell
$base = "http://localhost:8000/api/v1"

$devLogin = Invoke-RestMethod `
  -Method Post `
  -Uri "$base/auth/dev-login" `
  -ContentType "application/json" `
  -Body (@{
    nickname = "seed_user_01"
  } | ConvertTo-Json)

$accessToken = $devLogin.tokens.access_token
```

인증 호출 예시:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "$base/me" `
  -Headers @{ Authorization = "Bearer $accessToken" }
```

응답은 `{ "tokens": { "access_token": ..., "refresh_token": ... }, "user": { ... } }` 형태입니다. 이후 유저 API에는 `tokens.access_token`을 `Authorization: Bearer <token>`으로 보냅니다.

실제 Apple 로그인 엔드포인트는 `POST /api/v1/auth/apple`입니다. 이 경로는 실제 Apple `id_token`으로 로그인 흐름을 확인할 때 사용합니다.

```json
{
  "id_token": "<apple-id-token>",
  "accepted_terms_version": "2026-05-28",
  "accepted_privacy_version": "2026-05-28",
  "nonce": "<optional>"
}
```

Apple 로그인 요청은 `Idempotency-Key` 헤더가 필요합니다.

## Idempotency-Key

`POST`, `PATCH`, `DELETE` 변이 요청은 `Idempotency-Key: <uuid-or-unique-string>` 헤더를 붙입니다. 같은 key와 같은 body를 재시도하면 서버가 저장된 응답을 재사용합니다.

개발용 `POST /api/v1/auth/dev-login`처럼 문서에 예외로 적힌 엔드포인트는 붙이지 않습니다.

## 커서 페이지네이션 (무한 스크롤)

피드·검색 등 목록 응답은 `{ "items": [...], "next_cursor": "<opaque>" | null }` 형태입니다(검색은 `recommendations`도 포함). 응답 **최상위 `next_cursor`**가 `null`이 아니면 다음 페이지가 있다는 뜻이고, 다음 요청에 `?cursor=<next_cursor>&limit=<1..50>`로 전달합니다. `next_cursor`가 `null`이면 마지막 페이지입니다. 커서는 서버가 만든 불투명 문자열이므로 클라이언트에서 파싱하지 마세요.

```powershell
# 첫 페이지
$page = Invoke-RestMethod "$base/designs?limit=20"
# 다음 페이지 (next_cursor가 null이 될 때까지 반복)
if ($page.next_cursor) {
  $next = Invoke-RestMethod "$base/designs?limit=20&cursor=$($page.next_cursor)"
}
```

무한 스크롤: 리스트 끝에 도달할 때마다 직전 응답의 `next_cursor`로 다음 요청을 보내고, `next_cursor == null`이면 로딩을 멈춥니다.

## 로컬 CORS

기본 허용 origin은 `localhost`/`127.0.0.1`의 `3000`, `5173`, `19006`, `8081`입니다. `allow_credentials=True` 때문에 `*`는 사용하지 않습니다. 다른 포트를 쓰는 웹앱은 `.env`의 `CORS_ORIGINS`를 JSON 배열 형식으로 추가합니다.

```env
CORS_ORIGINS=["http://localhost:3000","http://localhost:5173","http://127.0.0.1:3001"]
```
