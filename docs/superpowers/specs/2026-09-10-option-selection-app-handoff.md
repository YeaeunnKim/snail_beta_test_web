# 옵션 단독/중복선택 + 개수선택 + 커스텀 카테고리 — 앱 반영 명세 (v2, 최종)

> 이 문서는 [2026-09-06-option-selection-app-handoff.md](./2026-09-06-option-selection-app-handoff.md)를
> **대체**한다. 그 문서는 개발 초기 제안 단계에서 쓴 것이라 실제 구현과 다른 부분(특히 예약 API
> 필드 형태)이 있다. 이 문서가 최종 기준이며, 여기 적힌 내용은 **전부 프로덕션에 배포되어
> 실제로 동작 중이다.**
>
> 관련 백엔드 PR: #64, #65, #67, #69, #70 (`snail_backend_specification`, `main` 브랜치에 모두 병합·배포 완료, 2026-09-10 기준)

## 배경

사장님이 베타웹에서 설정하는 것 3가지:
1. 고정 카테고리(제거/연장/케어) 각각을 "단독선택"(한 개만) 또는 "중복선택"(여러 개, 기본값)으로 설정
2. 옵션 하나하나를 "개수 선택"(예: 스톤 개수, 최대 개수는 사장님이 지정)으로 설정 가능
3. 고정 3종 외에 사장님이 직접 만드는 "커스텀 카테고리"(예: "네일아트") — 각각 단독/중복 설정 가능

**이 문서의 목적은 그 설정을 고객 앱의 실제 예약 화면에 반영하는 것.** 사장님 웹에는 고객처럼
옵션을 골라보는 화면이 없다 — 설정만 해두는 화면이고, 실제로 반영하는 건 앱 쪽 작업이다.

---

## 1. 설정값을 읽는 곳

### 1-1. 고정 3종 선택 방식 — `GET /shops/{shop_id}` (`ShopPublic`)

```jsonc
{
  // ...기존 필드들...
  "removal_selection_mode": "multi",  // "single" | "multi"
  "extend_selection_mode": "single",
  "care_selection_mode": "multi"
}
```

- `single`: 그 카테고리(제거/연장/케어) 안에서 옵션을 **최대 1개**까지만 고를 수 있음 → 라디오 버튼처럼 렌더링
- `multi`: 여러 개 동시 선택 가능(기본값, 기존 동작과 동일) → 체크박스처럼 렌더링
- 디자인 상세/브라우즈 응답에 샵 정보가 별도로 안 내려오므로, 예약 화면 진입 시 `GET /shops/{shop_id}`를 반드시 같이 호출해서 이 값을 확보해야 한다.

> 이 3개 필드는 지금까지 사장님 전용 `ShopMe`에만 있었는데, 이번에 고객 앱이 보는 `ShopPublic`에도
> 추가했다(PR #70). **2026-09-10 이전에 이 필드를 참조하는 코드를 짰다면, 그때는 `ShopPublic`에
> 이 필드가 없었을 것 — 지금은 있다.**

### 1-2. 커스텀 카테고리 목록 — `GET /shops/{shop_id}/option-categories` (신규, PR #70)

```jsonc
[
  {
    "id": "5b2e...",
    "shop_id": "b1a0...",
    "name": "네일아트",
    "selection_mode": "single",
    "sort_order": 0,
    "created_at": "...",
    "updated_at": "..."
  }
]
```

- 샵이 비공개(hidden) 상태면 샵 상세와 동일하게 `404 SHOP_NOT_FOUND`.
- 커스텀 카테고리가 하나도 없으면 빈 배열 `[]` — 대부분의 샵은 당분간 이 목록이 비어있을 것이다(선택 기능이라 사장님이 안 만들면 없음).

### 1-3. 디자인 옵션 목록 — `DesignOptionPublic` (기존 엔드포인트, 필드만 추가됨)

```jsonc
{
  "id": "...",
  "kind": "removal",           // "extend" | "removal" | "care" | null
  "custom_category_id": null,  // kind가 null일 때만 값 있음 — 위 1-2의 카테고리 id
  "name": "젤 제거",
  "price_delta": 5000,
  "duration_delta_min": 10,
  "sort_order": 0,
  "is_active": true,
  "template_key": null,
  "selection_type": "toggle",  // "toggle" | "quantity"  ← 신규
  "max_quantity": null         // quantity일 때만 값 있음(사장님이 지정, 기본 10)  ← 신규
}
```

**⚠️ 중요 — `kind`가 null일 수 있다.** 옵션이 커스텀 카테고리에 속하면 `kind`는 null이고
`custom_category_id`가 채워진다. **앱의 Design/Option 모델이 `kind`를 필수(non-null enum)로
디코딩하고 있다면 크래시한다.** 실제로 이걸로 어드민 콘솔에서 500 에러가 났던 걸 발견해서
고쳤다(PR #69) — 앱도 같은 종류의 버그가 날 수 있으니 배포 전에 반드시 확인 필요.

단, **커스텀 카테고리 기능 자체는 아직 실사용 중인 샵이 없다**(막 배포됐고 사장님이 켜야
쓰이는 기능). 그래도 옵션 모델을 null-safe하게 고쳐두는 게 안전 — 어느 순간 사장님이 커스텀
카테고리를 만들면 그 즉시 `kind: null` 옵션이 실제로 내려온다.

옵션이 소속된 카테고리의 선택 방식(single/multi)을 알려면:
- `kind`가 있으면 → 1-1의 `{kind}_selection_mode`
- `custom_category_id`가 있으면 → 1-2 목록에서 해당 id의 `selection_mode`

---

## 2. 앱 UI가 렌더링해야 하는 조합

| 카테고리 selection_mode | 옵션 selection_type | UI |
|---|---|---|
| multi (기본) | toggle | 체크박스, 여러 개 선택 가능 |
| single | toggle | 라디오 버튼, 카테고리당 1개만 |
| multi | quantity | 스테퍼(1~max_quantity), 다른 옵션과 별개로 개수만 조절 |
| single | quantity | 스테퍼는 그대로 쓰되, **1개 이상 선택하면 그 자체로 "선택함" 취급** → 같은 카테고리의 다른 옵션은 고를 수 없게 막아야 함 (아래 3-3 참고) |

quantity 옵션의 가격/시간은 **1개당 값 × 개수**로 선형 계산된다(`price_delta`/`duration_delta_min`이 1개 기준값).

---

## 3. 예약 생성 API — 실제 구현 기준 (구 문서의 제안과 다름)

`ReservationRequestCreate`/`ReservationCreate` 요청 바디:

```jsonc
{
  "design_id": "...",
  "selected_option_ids": ["opt-1", "opt-2"],
  "selected_option_quantities": {
    "opt-2": 3
  }
  // ...나머지 필드...
}
```

- `selected_option_ids`: 기존과 동일, 선택한 옵션 id 배열.
- `selected_option_quantities`: **`{option_id 문자열: 개수}` 형태의 딕셔너리** (구 문서에서 제안했던
  `[{option_id, quantity}]` 배열-of-객체 형태가 **아니다** — 실제로는 dict).
  - toggle 옵션은 이 딕셔너리에 안 넣어도 됨(개수=1로 취급).
  - quantity 옵션도 **개수가 1이면 생략 가능** — 관례상 quantity=1인 항목은 안 보내도 된다. 2 이상일 때만 넣으면 됨.
  - `selected_option_ids`에 없는 옵션 id를 이 딕셔너리에 넣어도 무시된다 — 반드시 `selected_option_ids`에도 포함시켜야 함.

응답(`ReservationMe` 등)에도 `selected_option_quantities`가 동일한 형태로 내려온다.

### 3-1. 검증 에러 코드 (모두 `422 Unprocessable Entity`)

| 코드 | 발생 조건 |
|---|---|
| `INVALID_DESIGN_OPTION` | 선택한 옵션 id가 그 디자인에 없거나 비활성 상태 (기존과 동일) |
| `INVALID_OPTION_QUANTITY` | quantity 옵션인데 개수가 1~max_quantity 범위를 벗어남, 또는 toggle 옵션인데 1이 아닌 개수를 지정함 |
| `OPTION_KIND_SINGLE_SELECT_VIOLATION` | single 카테고리에서 서로 다른 옵션을 2개 이상 선택함 (아래 3-3 참고) |

### 3-2. 서버가 최종 검증한다 — 앱 UI는 "이중 방어"

이 검증은 **서버(reservation_option_selection.py)에서 실제로 강제**한다. 앱 UI에서 막아도
서버가 다시 확인하므로, 앱 UI 검증은 사용자 경험을 위한 것이고 최종 방어선은 서버다. 즉 앱이
UI 검증을 깜빡해도 데이터 무결성은 깨지지 않지만(서버가 422로 거부), 사용자는 제출 시점에야
에러를 보게 되어 경험이 나빠진다 — 위 2번 표대로 선택 단계에서부터 막는 걸 권장.

### 3-3. 확정된 규칙 — quantity 옵션도 "선택"으로 센다

> "연장 카테고리 안에 1.없음 2.전체연장 3.개수선택 이렇게 세 개가 있을 때, 개수 선택을
> 2개정도로 누르면 2.전체연장을 선택하지 못하게 해야지"

즉 **quantity 옵션을 1개 이상 선택한 것도 "그 카테고리에서 옵션 하나를 선택함"으로 취급**한다.
single 카테고리에서는 toggle이든 quantity든 합쳐서 딱 하나의 옵션만 선택될 수 있다. 서버가
이 규칙을 그대로 강제하므로(`OPTION_KIND_SINGLE_SELECT_VIOLATION`), 앱 UI도 같은 방식으로
"quantity 옵션에 개수가 들어간 순간 같은 카테고리의 다른 옵션은 선택 해제/비활성화" 처리해야
사용자가 제출 직전에 에러를 보는 일이 없다.

---

## 4. 지금 앱이 바로 시작 가능한 것 / 아직 앱 쪽에서 안 되는 것

**바로 시작 가능 (백엔드 100% 배포·검증 완료):**
- `GET /shops/{shop_id}`에서 고정 3종 selection_mode 읽기
- `GET /shops/{shop_id}/option-categories`에서 커스텀 카테고리 목록 읽기
- `DesignOptionPublic`의 `kind`(nullable), `custom_category_id`, `selection_type`, `max_quantity` 읽기
- 예약 생성 시 `selected_option_quantities` dict 전송, 위 3개 에러 코드 처리

**앱 쪽에서 새로 구현해야 하는 것 (지금은 아무 것도 반영 안 돼있음):**
- 옵션 선택 UI: single/multi에 따른 체크박스·라디오 분기, quantity 옵션의 스테퍼, single 카테고리에서 quantity 옵션 선택 시 같은 카테고리 내 다른 옵션 비활성화
- Design/Option 모델의 `kind` nullable 처리 (안 그러면 커스텀 카테고리 옵션이 있는 디자인을 볼 때 크래시 위험)
- 예약 생성 폼에서 `selected_option_quantities` 조립·전송, 위 에러 코드 사용자 메시지 매핑

---

## 5. 알아두면 좋은 것 (지금 당장 할 일은 아님)

사장님이 말한 내용, 참고만 하고 지금은 건드리지 않음: 기존 제거/연장/케어에도 "고정 옵션"을
추가해서 모든 샵에 동등하게 적용되는 틀을 만드는 걸 나중에 검토 중. 이 문서와는 별개 작업이고,
진행되면 별도로 안내할 것.
