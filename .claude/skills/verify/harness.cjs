/*
 * Snail Beta Test Web verify harness (재사용 템플릿).
 *
 * owner 웹 하네스에서 이식. beta는 owner의 fork라 인증·계약이 동일하다:
 *   - presence 쿠키 snail_owner_authed / 토큰 snail.owner.* / 부팅 GET /owners/me
 *   - /shops/me, /shops/me/design-folders(bare), /shops/me/designers(bare),
 *     /shops/me/designs(봉투 {data,page}; collectAll 커서 추적)
 * 단, 라우트가 다르다: beta는 대시보드 스탯 화면이 없고 /dashboard → /dashboard/designs 로
 * 리다이렉트한다. 하단 탭은 디자인/일정/샵/알림. 따라서 owner의 /dashboard 스탯카드 시나리오
 * (b7-*)는 부적용이고, designs 화면 중심으로 시나리오를 구성한다.
 *
 * playwright-core는 앱 package.json을 오염시키지 않도록 격리 설치한다:
 *   (scratch) $ npm init -y && npm i playwright-core
 * 실행:
 *   NODE_PATH=<scratch>/node_modules node harness.cjs
 *   SCEN=designs-folders-error NODE_PATH=... node harness.cjs
 *
 * env: PW_CORE / VERIFY_CHROME / VERIFY_OUT / BASE (기본 http://localhost:3100)
 * 배치마다 SCENARIOS만 교체/추가한다.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW_CORE || 'playwright-core');

const CHROME = process.env.VERIFY_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_URL = process.env.VERIFY_CDP_URL || '';
const BASE = process.env.BASE || 'http://localhost:3100';
const OUT = process.env.VERIFY_OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

// WSL2 gotcha: playwright-core's default chromium.launch() uses a stdio *pipe*
// transport (--remote-debugging-pipe) to talk to the browser. That works when
// node and the browser are the same OS, but this repo's only available Chrome
// is the Windows host binary (C:\...\chrome.exe) invoked from a WSL2 Linux node
// process via interop. Anonymous pipe fds 3/4 don't cross that boundary, so
// launch() fails immediately with "Remote debugging pipe file descriptors are
// not open." Fix: launch chrome.exe out-of-band with --remote-debugging-port
// (TCP, which *does* cross the WSL2<->Windows localhost forwarding) and have
// playwright attach via connectOverCDP instead of spawning it itself. See
// SKILL.md "실행" section for the exact launch command. Set VERIFY_CDP_URL
// (e.g. http://localhost:9222) to use this path; otherwise falls back to the
// original same-OS chromium.launch(CHROME).

const json = (status, obj) => ({ status, contentType: 'application/json', body: JSON.stringify(obj) });
const text = (status, body) => ({ status, contentType: 'text/plain', body });

const now = new Date();
const iso = (h, m = 0) => { const d = new Date(now); d.setHours(h, m, 0, 0); return d.toISOString(); };

// ── fixture: approved-owner 세션 + base 응답 ──────────────────────────
const OWNER = { id: 'o1', email: 'owner@test', name: '테스트사장', verification_status: 'approved' };
const SHOP = { id: 'shop1', name: '테스트네일샵', visibility: 'active',
  business_hours: [{ day_of_week: 1, is_closed: false, open_time: '10:00', close_time: '20:00' }] };
const DESIGNERS = [{ id: 'd1', name: '민지' }, { id: 'd2', name: '수아' }]; // bare array (2명 이상 시나리오 겸용)
const FOLDERS = [{ id: 'f1', name: '7월 이달의 아트', design_count: 3 }]; // bare array
// 1x1 data URI — 카드 사진 렌더 확인용(외부 네트워크 의존 없이 <img>가 실제로 그려지는지 확인).
const DOT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const design = (id, title) => ({ id, shop_id: 'shop1', title, description: null,
  base_price: 45000, duration_minutes: 60, folder_id: null, folder_name: null,
  thumbnail_url: DOT_PNG, visibility: 'active', ai_analysis_status: 'done',
  owner_tags: ['프렌치', '글리터'], ai_tags: [], color_palette: [], images: [{ url: DOT_PNG }],
  designers: [{ id: 'd1', name: '민지', base_price: 45000, duration_minutes: 60 },
    { id: 'd2', name: '수아', base_price: 50000, duration_minutes: 75 }],
  created_at: iso(9), updated_at: iso(9) });
const rangeDesigns = (a, b) => Array.from({ length: b - a }, (_, i) => design('dz' + (a + i + 1), '디자인 ' + (a + i + 1)));
// /shops/me/designs 는 봉투 { data, page } 반환 (collectAll 이 커서 추적).
const DESIGNS = { data: rangeDesigns(0, 3), page: { has_next: false, next_cursor: null }, request_id: 'req-designs' };

function baseResponse(p, m, sp) {
  if (p.endsWith('/owners/me') && m === 'GET') return json(200, OWNER);
  if (p.endsWith('/shops/me') && m === 'GET') return json(200, SHOP);
  if (p.endsWith('/shops/me/designers') && m === 'GET') return json(200, DESIGNERS);
  if (p.endsWith('/design-folders') && m === 'GET') return json(200, FOLDERS);
  if (p.endsWith('/design-folders') && m === 'POST') return json(200, { id: 'f9', name: '새 폴더', design_count: 0 });
  if (p.endsWith('/shops/me/designs') && m === 'GET') return json(200, DESIGNS);
  if (m === 'GET') return json(200, []);
  return json(200, {});
}

// ── SCENARIOS: 배치마다 교체 ─────────────────────────────────────────
// override(path, method, searchParams, url) → fulfill 객체 또는 null(=base)
// 옵션: url, wait(ms), clickNewDesign, createFolder(name), openFolder(name), clickRetry
const SCENARIOS = {
  // 디자인 등록 탭이 폴더 + 미분류 디자인과 함께 렌더되는지.
  baseline: { url: '/dashboard/designs', wait: 1600 },
  // 폴더를 열어 실제 디자인 카드(사진/제목/가격/시간/태그)가 보이는지. 기본 수정 OFF(폴더=텍스트).
  'designs-card-view': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류' },
  // Task 6: 목록 전체 수정 ON 토글 — 헤더 버튼 클릭 후 모든 카드가 폴더 select로 바뀌는지.
  'designs-card-view-edit-on': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류', clickToggle: /수정 OFF/ },
  // 폴더 목록 5xx → 에러 표면화(재시도 2회 후 ~6s). 관찰: 로딩 유지 아님, 에러 UI/consoleError.
  'designs-folders-error': { url: '/dashboard/designs', wait: 5200, override: (p, m) => {
    if (p.endsWith('/design-folders') && m === 'GET') return json(503, { error: { code: 'SERVICE_UNAVAILABLE', message: '점검 중' } }); return null; } },
  // 디자이너 목록 5xx (새 디자인 폼에서 사용).
  'designs-designers-error': { url: '/dashboard/designs', wait: 5200, clickNewDesign: true, override: (p, m) => {
    if (p.endsWith('/shops/me/designers') && m === 'GET') return json(500, { error: { code: 'INTERNAL', message: '서버 오류' } }); return null; } },
  // 폴더 생성 409(mapped) — 구체 문구가 뜨는지.
  'folder-create-409': { url: '/dashboard/designs', wait: 1000, createFolder: '중복폴더', override: (p, m) => {
    if (p.endsWith('/design-folders') && m === 'POST') return json(409, { error: { code: 'FOLDER_NAME_TAKEN', message: '이미 같은 이름의 폴더가 있어요.' } }); return null; } },
  // 봉투 페이지네이션: has_next 따라 2페이지(총 25개)를 collectAll이 전부 모으는지.
  'designs-paginated': { url: '/dashboard/designs', wait: 1600, override: (p, m, sp) => {
    if (p.endsWith('/shops/me/designs') && m === 'GET') {
      const cursor = sp.get('cursor');
      if (!cursor) return json(200, { data: rangeDesigns(0, 12), page: { has_next: true, next_cursor: 'PAGE2' }, request_id: 'r1' });
      if (cursor === 'PAGE2') return json(200, { data: rangeDesigns(12, 25), page: { has_next: false, next_cursor: null }, request_id: 'r2' });
      return json(200, { data: [], page: { has_next: false, next_cursor: null }, request_id: 'r3' });
    }
    return null; } },

  // Task 7: 카드 인라인 ± 스테퍼. 가격 + 5연타(150ms 안에 몰아침, 800ms 디바운스 안쪽) → 화면은
  // 즉시 +5000, PATCH는 디바운스 정착(settleWait) 후 정확히 1회만 나가야 한다.
  'designs-card-price-rapid5': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류', clickToggle: /수정 OFF/,
    stepperClicks: [{ ariaLabel: '가격', dir: '증가', times: 5, gapMs: 30 }], settleWait: 1100 },
  // 소요시간 − 연타로 30분 밑으로 내리려 해도 clampDuration이 30에서 멈추는지.
  'designs-card-duration-floor': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류', clickToggle: /수정 OFF/,
    stepperClicks: [{ ariaLabel: '소요시간', dir: '감소', times: 5, gapMs: 30 }], settleWait: 1100 },
  // 가격 − 연타(50회, 총 500ms — 디바운스 창 안쪽 유지)로 0원 밑으로 내리려 해도 clampPrice가 0에서 멈추는지.
  'designs-card-price-floor': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류', clickToggle: /수정 OFF/,
    stepperClicks: [{ ariaLabel: '가격', dir: '감소', times: 50, gapMs: 10 }], settleWait: 1100 },
  // PATCH 500 주입 → draft가 롤백되어 서버 값(45,000원)으로 되돌아가고 에러 메시지가 뜨는지.
  'designs-card-patch-rollback': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류', clickToggle: /수정 OFF/,
    stepperClicks: [{ ariaLabel: '가격', dir: '증가', times: 2, gapMs: 30 }], settleWait: 1100,
    override: (p, m) => {
      if (/\/shops\/me\/designs\/[^/]+$/.test(p) && m === 'PATCH') return json(500, { error: { code: 'INTERNAL', message: '서버 오류' } });
      return null; } },

  // Task 8: 카드 인라인 태그 편집. 태그는 디바운스 없이 즉시 저장이라 각 op 사이에 settleWait만큼
  // 기다려 PATCH→invalidate→GET 사이클이 끝난 뒤 다음 op를 친다(안 그러면 draft 겹침 레이스 우려).
  // × 클릭 1회 → PATCH 1건, owner_tags에서 그 태그가 빠져야 한다.
  'designs-card-tag-remove': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류', clickToggle: /수정 OFF/,
    tagOps: [{ op: 'remove', text: '프렌치' }], settleWait: 700 },
  // 단어 입력 후 Enter → PATCH 1건, owner_tags에 새 태그가 추가돼야 한다.
  'designs-card-tag-add': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류', clickToggle: /수정 OFF/,
    tagOps: [{ op: 'add', text: '트렌디' }], settleWait: 700 },
  // 이미 2개(프렌치·글리터) 있는 상태에서 8개를 더 채워 10개(MAX_OWNER_TAGS) → 입력칸이 사라져야 한다.
  'designs-card-tag-max': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류', clickToggle: /수정 OFF/,
    tagOps: [
      { op: 'add', text: '태그3' }, { op: 'add', text: '태그4' }, { op: 'add', text: '태그5' },
      { op: 'add', text: '태그6' }, { op: 'add', text: '태그7' }, { op: 'add', text: '태그8' },
      { op: 'add', text: '태그9' }, { op: 'add', text: '태그10' },
    ], settleWait: 700 },
  // PATCH 500 주입 → × 클릭 후 draft가 롤백돼 원래 태그(프렌치·글리터)로 되돌아가고 에러 메시지가 뜨는지.
  'designs-card-tag-rollback': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류', clickToggle: /수정 OFF/,
    tagOps: [{ op: 'remove', text: '프렌치' }], settleWait: 700,
    override: (p, m) => {
      if (/\/shops\/me\/designs\/[^/]+$/.test(p) && m === 'PATCH') return json(500, { error: { code: 'INTERNAL', message: '서버 오류' } });
      return null; } },

  // Task 9: 디자이너별 가격·소요시간 범위 표시 + 펼침 편집.
  // design() fixture 기본값 자체가 이미 민지(45,000/60분)·수아(50,000/75분)로 다르므로
  // 그대로 "45,000~50,000원 ▾ · 60~75분" 범위 표시가 뜨는지 확인(수정 OFF, 펼침 전).
  'designs-card-designer-range': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류' },
  // ▾ 눌러 펼치면 기본/디자이너별 줄이 나오고 다른 값엔 "따로", 기본과 같으면 "기본"이 붙는지.
  'designs-card-designer-range-expand': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류',
    clickRangeToggle: true },
  // 수정 ON — hasVariance면 토글 버튼 없이도 DesignerRows가 자동으로 펼쳐지고 줄마다 ± 스테퍼가 뜨는지.
  'designs-card-designer-range-edit': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류',
    clickToggle: /수정 OFF/ },
  // 수정 ON 상태에서 민지 가격 스테퍼를 1회 눌러 PATCH 페이로드를 검증한다:
  // designer_ids는 전체 목록, designer_prices/durations는 기본값과 다른 것만 담겨야 한다.
  'designs-card-designer-price-edit': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류', clickToggle: /수정 OFF/,
    stepperClicks: [{ ariaLabel: '민지 가격', dir: '증가', times: 1, gapMs: 30 }], settleWait: 1100 },
  // 디자이너 전원이 기본값과 같으면(uniform) 범위 표시·펼침 없이 예전처럼 단일 표시만 뜨는지.
  'designs-card-designer-uniform': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류',
    override: (p, m) => {
      if (p.endsWith('/shops/me/designs') && m === 'GET') {
        const uniform = rangeDesigns(0, 3).map((d) => ({
          ...d,
          designers: d.designers.map((x) => ({ ...x, base_price: d.base_price, duration_minutes: d.duration_minutes })),
        }));
        return json(200, { data: uniform, page: { has_next: false, next_cursor: null }, request_id: 'req-uniform' });
      }
      return null; } },
  // [기본으로] 클릭 → 그 디자이너가 기본값으로 돌아가고, 전원이 기본이 되면 범위 표시가 단일 표시로
  // 돌아가는지(DesignerRows도 hasVariance=false가 되면서 자동으로 접혀야 한다).
  'designs-card-designer-reset-to-base': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류', clickToggle: /수정 OFF/,
    clickText: /기본으로/, settleWait: 1300 },
};

// ± 스테퍼 연타 — 매 클릭 사이 gapMs만큼 실제로 대기(브라우저 이벤트 루프에 양보)해 React가
// 커밋할 시간을 준다. page.evaluate 안에서 동기 루프로 .click()을 연타하면 클릭들이 모두 같은
// stale value를 참조해(재렌더가 끼어들 틈이 없어) 값이 한 번만 바뀌는 것처럼 보이는 함정이 있다 —
// 그래서 반드시 setTimeout으로 프레임 사이를 벌려야 실제 연타(각 클릭이 이전 결과를 반영)를 재현한다.
async function clickStepperRapid(page, ariaLabel, dir, times, gapMs) {
  return page.evaluate(
    async ({ ariaLabel, dir, times, gapMs }) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < times; i += 1) {
        const input = document.querySelector(`input[aria-label="${ariaLabel}"]`);
        if (!input) return { error: 'no-input', at: i };
        const outer = input.closest('div.rounded-md.border');
        if (!outer) return { error: 'no-outer', at: i };
        const btn = outer.querySelector(`button[aria-label="${dir}"]`);
        if (!btn) return { error: 'no-button', at: i };
        btn.click();
        await wait(gapMs);
      }
      const input2 = document.querySelector(`input[aria-label="${ariaLabel}"]`);
      return { value: input2 ? input2.value : null };
    },
    { ariaLabel, dir, times, gapMs },
  );
}

// Task 8 태그 op — 첫 카드(DOM 순서상 첫 번째)의 TagInput만 대상으로 한다.
// TagInput엔 컨테이너 자체에 붙는 aria-label이 없어서, 칩 삭제 버튼(aria-label="{tag} 삭제")을
// 앵커로 삼아 그 조상 div.rounded-md.border를 컨테이너로 역추적한다(Stepper의
// div.rounded-md.border 탐색과 같은 요령). remove는 텍스트로 특정 칩의 × 버튼을 직접 클릭하고,
// add는 컨테이너 안의 유일한 input에 값을 넣고 실제 KeyboardEvent(Enter)를 디스패치해
// React의 onKeyDown 핸들러(add())를 그대로 태운다.
async function runTagOp(page, op) {
  return page.evaluate(({ op }) => {
    const findFirstContainer = () => {
      const anyChipBtn = document.querySelector('button[aria-label$=" 삭제"]');
      const anyInput = document.querySelector('div.rounded-md.border input');
      const anchor = anyChipBtn || anyInput;
      return anchor ? anchor.closest('div.rounded-md.border') : null;
    };
    if (op.op === 'remove') {
      const btn = document.querySelector(`button[aria-label="${op.text} 삭제"]`);
      if (!btn) return { error: 'no-chip-button', text: op.text };
      btn.click();
      return { clicked: 'remove', text: op.text };
    }
    if (op.op === 'add') {
      const container = findFirstContainer();
      if (!container) return { error: 'no-container' };
      const input = container.querySelector('input');
      if (!input) return { error: 'no-input' }; // MAX_OWNER_TAGS 도달 시 정상적으로 없을 수 있음
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, op.text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return { dispatched: 'add', text: op.text };
    }
    return { error: 'unknown-op', op: op.op };
  }, { op });
}

async function run() {
  const only = process.env.SCEN;
  const browser = CDP_URL
    ? await chromium.connectOverCDP(CDP_URL)
    : await chromium.launch({ executablePath: CHROME, headless: true });
  const results = {};
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    if (only && only !== name) continue;
    const context = await browser.newContext({ viewport: { width: 430, height: 1400 } }); // 베타는 모바일 셸(max-w-md)
    await context.addCookies([{ name: 'snail_owner_authed', value: '1', domain: 'localhost', path: '/' }]);
    await context.addInitScript(() => { try {
      localStorage.setItem('snail.owner.access_token', 'test-access');
      localStorage.setItem('snail.owner.refresh_token', 'test-refresh');
    } catch (e) {} });
    // 카드 인라인 PATCH(updateDesign) 요청 횟수 카운트 — 디바운스가 깨지면(연타마다 쐈다면) 여기서 잡힌다.
    // /reanalyze, /visibility 는 경로 끝이 id가 아니라서(정규식 $ 앵커) 안 섞인다.
    let patchCount = 0;
    const patchBodies = [];
    // 성공한(override로 에러 주입되지 않은) PATCH만 여기 누적 — 저장 성공 후 onSuccess가
    // invalidateQueries(['design', id])로 GET 단건을 다시 부르는데, baseResponse의 범용 GET
    // 폴백(빈 배열)이 그대로 오면 useQuery data가 배열이 돼 d.owner_tags.length가 터진다
    // (harness fixture 갭이지 앱 버그 아님 — 발견 기록은 report에 남긴다).
    // 실패 주입 시나리오(override가 에러 반환)는 여기 안 남겨야 "롤백 후 GET은 원래 서버값"이 재현된다.
    const designOverrides = {};
    const applyOverrides = (d) => (designOverrides[d.id] ? { ...d, ...designOverrides[d.id] } : d);
    await context.route('**/api/v1/**', (route) => {
      const req = route.request(); const url = new URL(req.url());
      const p = url.pathname, m = req.method();
      const idMatch = p.match(/\/shops\/me\/designs\/([^/]+)$/);
      const ov = sc.override && sc.override(p, m, url.searchParams, url);
      if (m === 'PATCH' && idMatch) {
        patchCount += 1;
        let body = {};
        try { body = JSON.parse(req.postData() || '{}'); } catch (e) { /* noop */ }
        patchBodies.push(body);
        if (!ov) {
          const id = idMatch[1];
          const prevOverride = designOverrides[id] || {};
          const merged = { ...prevOverride, ...body };
          // Task 9 fixture 보강: designer_ids/designer_prices/designer_durations는 Design의
          // 실제 필드가 아니라 "서버가 designers[] 배열에 반영해야 하는 커맨드"다. 진짜 백엔드가
          // 없으니 하네스가 그 매핑을 대신 흉내낸다 — 안 하면 [기본으로]/디자이너별 스테퍼가
          // PATCH는 성공해도 후속 GET에서 designers[]가 그대로라 화면이 안 바뀐 것처럼 보인다.
          if (body.designer_ids) {
            const original = DESIGNS.data.find((d) => d.id === id) || design(id, id);
            const baseDesigners = prevOverride.designers || original.designers || [];
            const basePrice = merged.base_price !== undefined ? merged.base_price : original.base_price;
            const baseDuration = merged.duration_minutes !== undefined ? merged.duration_minutes : original.duration_minutes;
            const priceMap = new Map((body.designer_prices || []).map((x) => [x.designer_id, x.base_price]));
            const durationMap = new Map((body.designer_durations || []).map((x) => [x.designer_id, x.duration_minutes]));
            merged.designers = body.designer_ids.map((did) => {
              const existing = baseDesigners.find((x) => x.id === did) || { id: did, name: did };
              return {
                ...existing,
                base_price: priceMap.has(did) ? priceMap.get(did) : basePrice,
                duration_minutes: durationMap.has(did) ? durationMap.get(did) : baseDuration,
              };
            });
            delete merged.designer_ids; delete merged.designer_prices; delete merged.designer_durations;
          }
          designOverrides[id] = merged;
        }
      }
      if (ov) { route.fulfill(ov); return; }
      if (m === 'GET' && idMatch) {
        const found = DESIGNS.data.find((d) => d.id === idMatch[1]);
        route.fulfill(json(200, applyOverrides(found || design(idMatch[1], idMatch[1]))));
        return;
      }
      if (m === 'GET' && p.endsWith('/shops/me/designs')) {
        route.fulfill(json(200, { ...DESIGNS, data: DESIGNS.data.map(applyOverrides) }));
        return;
      }
      route.fulfill(baseResponse(p, m, url.searchParams));
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));
    await page.goto(BASE + sc.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(sc.wait || 1200);

    // "Application error"(=.next 캐시 손상/콜드컴파일 레이스) 가드: 최대 3회 리로드.
    let reloads = 0;
    while (reloads < 3 && (await page.evaluate(() => document.body.innerText.includes('Application error')))) {
      reloads++; await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(sc.wait || 1200);
    }

    if (sc.clickNewDesign) { await page.getByRole('button', { name: /새 디자인|디자인 등록/ }).first().click().catch(() => {}); await page.waitForTimeout(600); }
    if (sc.openFolder) { await page.getByText(sc.openFolder, { exact: false }).first().click().catch(() => {}); await page.waitForTimeout(1500); }
    if (sc.clickToggle) { await page.getByRole('button', { name: sc.clickToggle }).first().click().catch(() => {}); await page.waitForTimeout(600); }
    // Task 9: 카드의 "min~max원 ▾/▴" 범위 토글 버튼을 클릭해 DesignerRows를 펼치거나 접는다.
    if (sc.clickRangeToggle) { await page.getByRole('button', { name: /~.*원/ }).first().click().catch(() => {}); await page.waitForTimeout(500); }
    // Task 9: 텍스트로 특정 버튼(예: "기본으로")을 클릭하는 범용 스텝.
    if (sc.clickText) { await page.getByRole('button', { name: sc.clickText }).first().click().catch(() => {}); await page.waitForTimeout(sc.settleWait ?? 800); }
    let stepper = null;
    if (sc.stepperClicks) {
      stepper = { clicks: [] };
      for (const s of sc.stepperClicks) {
        const r = await clickStepperRapid(page, s.ariaLabel, s.dir, s.times, s.gapMs || 30);
        stepper.clicks.push({ ariaLabel: s.ariaLabel, dir: s.dir, times: s.times, result: r });
      }
      // 클릭 직후(디바운스 800ms 안쪽) — 화면은 이미 반영됐지만 PATCH는 아직 안 나갔어야 한다.
      stepper.immediate = await page.evaluate(() => ({
        price: document.querySelector('input[aria-label="가격"]')?.value ?? null,
        duration: document.querySelector('input[aria-label="소요시간"]')?.value ?? null,
      }));
      stepper.patchCountImmediate = patchCount;
      await page.waitForTimeout(sc.settleWait ?? 1100); // > 800ms 디바운스 정착 대기
      stepper.settled = await page.evaluate(() => ({
        price: document.querySelector('input[aria-label="가격"]')?.value ?? null,
        duration: document.querySelector('input[aria-label="소요시간"]')?.value ?? null,
      }));
      stepper.patchCountFinal = patchCount;
      stepper.patchBodies = patchBodies.slice();
      stepper.hasSaveErr = await page.evaluate(() => document.body.innerText.includes('일시적인 서버 오류'));
    }
    let tags = null;
    if (sc.tagOps) {
      tags = { ops: [] };
      for (const op of sc.tagOps) {
        const r = await runTagOp(page, op);
        await page.waitForTimeout(sc.settleWait ?? 700); // 디바운스 없음 — PATCH+invalidate+GET 사이클이 끝날 시간
        tags.ops.push({ op, result: r, patchCountAfter: patchCount });
      }
      tags.patchCount = patchCount;
      tags.patchBodies = patchBodies.slice();
      tags.firstCardTagsText = await page.evaluate(() => {
        const anyChipBtn = document.querySelector('button[aria-label$=" 삭제"]');
        const anyInput = document.querySelector('div.rounded-md.border input');
        const anchor = anyChipBtn || anyInput;
        const container = anchor ? anchor.closest('div.rounded-md.border') : null;
        return container ? container.innerText : null;
      });
      tags.firstCardHasInput = await page.evaluate(() => {
        const anyChipBtn = document.querySelector('button[aria-label$=" 삭제"]');
        const container = anyChipBtn ? anyChipBtn.closest('div.rounded-md.border') : null;
        return container ? !!container.querySelector('input') : null;
      });
      tags.hasSaveErr = await page.evaluate(() => document.body.innerText.includes('일시적인 서버 오류'));
    }
    if (sc.createFolder) {
      await page.getByRole('button', { name: /새 폴더|폴더 추가/ }).first().click().catch(() => {}); await page.waitForTimeout(300);
      await page.getByPlaceholder(/폴더 이름/).fill(sc.createFolder).catch(() => {});
      await page.getByRole('button', { name: /만들기|추가/ }).first().click().catch(() => {}); await page.waitForTimeout(700);
    }
    let recovered = null;
    if (sc.clickRetry) {
      await page.getByRole('button', { name: '다시 시도' }).first().click().catch(() => {});
      await page.waitForTimeout(1500);
      recovered = await page.evaluate(() => document.body.innerText);
    }

    const shot = path.join(OUT, name + '.png');
    await page.screenshot({ path: shot, fullPage: true });
    const bodyText = await page.evaluate(() => document.body.innerText);
    const signals = {
      folderName: bodyText.includes('7월 이달의 아트'),
      designCount: (bodyText.match(/디자인 \d+/g) || []).length,
      loading: bodyText.includes('불러오는 중'),
      errorRetry: bodyText.includes('다시 시도'),
      appError: bodyText.includes('Application error'),
      // Task 9: 범위 표시 버튼(min~max원 ▾)이 보이는지 + 펼침 시 디자이너별 줄(이름·따로/기본)이 보이는지.
      hasRangeToggle: /~[\d,]+원 [▾▴]/.test(bodyText),
      hasDesignerRows: bodyText.includes('민지') && bodyText.includes('수아') && (bodyText.includes('따로') || bodyText.includes('기본')),
    };
    results[name] = { signals, reloads, consoleErrors, stepper, tags, bodyExcerpt: bodyText.slice(0, 700) };
    await context.close();
    console.log(`\n===== ${name} =====`);
    console.log('screenshot:', shot);
    console.log('SIGNALS  :', JSON.stringify(signals), reloads ? `(reloads=${reloads})` : '');
    if (stepper) console.log('STEPPER  :', JSON.stringify(stepper));
    if (tags) console.log('TAGS     :', JSON.stringify(tags));
    if (recovered != null) console.log('  [retry] after:', recovered.replace(/\n+/g, ' ¦ ').slice(0, 260));
    console.log('consoleErrors:', consoleErrors.length ? consoleErrors.slice(0, 5) : 'none');
    console.log('BODY EXCERPT:\n' + results[name].bodyExcerpt);
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log('\nDONE.');
}
run().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
