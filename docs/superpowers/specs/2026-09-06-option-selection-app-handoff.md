# 옵션 단독/중복선택 + 개수선택 — 앱 반영 명세

## 배경
사장님 베타웹 옵션 관리 화면에 두 가지 설정을 추가했다(백엔드 스키마 + 사장님 웹 UI, 1단계 완료).
이 문서는 그 설정값이 **고객 앱(iOS/Android)의 실제 예약 화면에 반영**되도록 앱 개발자에게
필요한 내용을 전달하기 위한 것이다. 사장님 웹 자체에는 고객처럼 옵션을 골라보는 화면이
없다 — 사장님이 "이렇게 동작해야 해"라고 설정만 해두는 화면이고, 그 설정을 실제로
반영하는 건 이 문서에 적힌 앱 쪽 작업이다.

관련 백엔드 PR: `snail_backend_specification` — 옵션 단독/중복선택 모드 + 개수 선택 옵션
(마이그레이션 `20260906_1100_option_selection_mode_and_quantity`).

## 1. 새로 추가된 필드

### `GET /shops/me` (`ShopMe`) — 카테고리(kind)별 선택 방식
```jsonc
{
  // ... 기존 필드 ...
  "removal_selection_mode": "multi",  // "single" | "multi"
  "extend_selection_mode": "single",
  "care_selection_mode": "multi"
}
```
- `single`: 그 kind(제거/연장/케어) 안에 있는 옵션 중 **최대 1개**만 고를 수 있음 → 앱에서 **라디오 버튼**으로.
- `multi`: 여러 개 동시 선택 가능(기존 동작과 동일) → 앱에서 **체크박스**로.
- 기본값은 `multi`라서, 사장님이 아무 설정도 안 바꾼 샵은 지금과 완전히 똑같이 동작해야 한다.
- 이 값은 **샵 전체 설정**이다(디자인마다 다르지 않음) — 손님이 보는 디자인 상세 화면에서 그 디자인의 `folder`/`shop_id`로 샵을 찾아 이 3개 값을 참조하면 된다. (디자인 응답 자체(`DesignMe`/공개 디자인 조회)에는 이 필드가 없다 — 샵 조회 응답에서 가져와야 함. 공개 디자인 상세 API에 샵 정보가 이미 포함되어 있다면 거기서 같이 내려줄 수 있는지는 백엔드와 확인 필요.)

### 디자인 옵션(`DesignOptionPublic`, 옵션 목록/디자인 상세에 포함) — 옵션 하나의 선택 방식
```jsonc
{
  "id": "uuid",
  "kind": "extend",
  "name": "랩핑 추가",
  "price_delta": 5000,          // selection_type=quantity면 "1개당" 가격
  "duration_delta_min": 0,      // selection_type=quantity면 "1개당" 시간
  "sort_order": 0,
  "is_active": true,
  "selection_type": "quantity", // "toggle" | "quantity"
  "max_quantity": 10            // toggle이면 항상 null. quantity면 1~99 사이 정수(사장님이 지정)
}
```
- `toggle`(기본값): 지금까지와 동일 — 켜고 끄기만 하는 옵션.
- `quantity`: 고객이 **개수(1 ~ max_quantity)를 골라야 하는 옵션**. 예: "랩핑 추가" 1개당 +5,000원/+0분, 최대 10개 → 고객이 3개를 고르면 +15,000원/+0분이 청구액에 더해져야 한다(가격/시간은 **개수만큼 곱해서** 반영 — 선형 계산, 구간별 단가 아님).
- 이미 등록되어 있던 기존 옵션들은 전부 `selection_type: "toggle"`, `max_quantity: null`로 마이그레이션됐다 — 기존 앱 동작과 동일.

## 2. 앱 UI가 반영해야 할 것

디자인 상세/예약 화면의 옵션 선택 UI를, 옵션이 속한 kind의 `*_selection_mode`와 그 옵션 자신의
`selection_type`을 보고 아래처럼 그려야 한다.

| kind의 selection_mode | 옵션의 selection_type | UI |
|---|---|---|
| multi | toggle | 체크박스 (기존과 동일) |
| single | toggle | 라디오 버튼 (같은 kind 안에서 하나 고르면 나머지 자동 해제) |
| multi 또는 single | quantity | 개수 스테퍼(`-` / `+` / 숫자, 0~max_quantity). quantity 옵션은 selection_mode(단독/중복)와 무관하게 항상 개수로 고른다 — **quantity 옵션끼리는 single/multi 제약을 안 받는다**(하나의 quantity 옵션 자체가 몇 개인지를 고르는 것뿐이라, "같은 kind 안에서 최대 1개"라는 제약의 대상이 아님). single 모드에서 toggle 옵션과 quantity 옵션이 섞여 있으면, quantity 옵션에 1개 이상 담긴 상태 자체가 "그 kind에서 선택함"으로 카운트되어 다른 toggle 옵션 선택과 상호 배타적이어야 하는지는 **정책 결정 필요**(3번 참고).

가격/시간 합산 시: quantity 옵션은 `price_delta * 고른개수`, `duration_delta_min * 고른개수`로 계산해서 합산.

## 3. 예약 요청 API — 계약 변경 필요 (여기가 제일 큰 작업)

**현재**: 예약 생성/견적 계산 API가 `selected_option_ids: list[UUID]`만 받는다. "개수"라는 개념이
아예 없다.

**필요한 변경**: 개수를 함께 보낼 수 있어야 한다. 제안:

```jsonc
// 기존 필드는 유지 — quantity=1인 옵션들의 id 목록으로 계속 채움(구버전 앱 호환)
"selected_option_ids": ["opt-a", "opt-b", "opt-c"],
// 신규 — quantity 옵션에 대해서만 개수를 명시. 여기 없는 id는 quantity=1로 취급.
"selected_option_quantities": [
  { "option_id": "opt-c", "quantity": 3 }
]
```

- **하위 호환이 반드시 필요하다**: 이 저장소는 웹처럼 push하면 바로 전체 반영되는 게 아니라
  네이티브 앱(iOS/Android)이라서, 업데이트 안 한 구버전 앱이 한동안 계속 옛날 형태로
  요청을 보낸다. 백엔드는 `selected_option_quantities`가 없으면 전부 quantity=1로 처리해서
  기존 요청도 그대로 정상 동작해야 한다.
- **검증 규칙(백엔드가 추가해야 함, 아직 미구현)**:
  - `selected_option_quantities`의 quantity는 1 이상, 그 옵션의 `max_quantity` 이하.
  - `selection_type=toggle`인 옵션이 `selected_option_quantities`에 quantity>1로 들어오면 에러.
  - 같은 kind가 `single`인데 그 kind에 속한 toggle 옵션이 2개 이상 선택되면 에러.
- 이 예약 검증 로직은 **백엔드에도 아직 구현되어 있지 않다** — 이번 앱 작업과 짝을 맞춰 백엔드도
  같이 작업해야 실제로 막힌다. 순서 제안: (1) 이 문서의 계약으로 백엔드 스키마+검증 구현 →
  (2) 앱이 새 필드 사용하도록 구현 → (3) 같이 배포.

## 4. 참고 — 지금 배포되는 것과 안 되는 것

- **지금 배포되는 것**: 백엔드 필드 저장 + 사장님 웹에서 설정하는 화면. 사장님이 설정을 저장할
  수는 있지만, 아직 앱이 안 읽으므로 **고객 경험은 지금 당장 아무것도 안 바뀐다.**
  (기본값이 기존 동작과 동일하기도 하고, 애초에 앱이 이 필드를 안 보므로 이중으로 안전하다.)
- **이 문서 작업이 끝나야** 실제로 고객이 라디오버튼/스테퍼를 보게 된다.
