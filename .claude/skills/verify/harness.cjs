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
  // 폴더를 열어 실제 디자인 카드(사진/제목/가격/시간/태그)가 보이는지.
  'designs-card-view': { url: '/dashboard/designs', wait: 1600, openFolder: '미분류' },
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
};

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
    await context.route('**/api/v1/**', (route) => {
      const req = route.request(); const url = new URL(req.url());
      const ov = sc.override && sc.override(url.pathname, req.method(), url.searchParams, url);
      route.fulfill(ov || baseResponse(url.pathname, req.method(), url.searchParams));
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
    };
    results[name] = { signals, reloads, consoleErrors, bodyExcerpt: bodyText.slice(0, 700) };
    await context.close();
    console.log(`\n===== ${name} =====`);
    console.log('screenshot:', shot);
    console.log('SIGNALS  :', JSON.stringify(signals), reloads ? `(reloads=${reloads})` : '');
    if (recovered != null) console.log('  [retry] after:', recovered.replace(/\n+/g, ' ¦ ').slice(0, 260));
    console.log('consoleErrors:', consoleErrors.length ? consoleErrors.slice(0, 5) : 'none');
    console.log('BODY EXCERPT:\n' + results[name].bodyExcerpt);
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log('\nDONE.');
}
run().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
