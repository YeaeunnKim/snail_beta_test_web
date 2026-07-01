// 프론트엔드 api-client와 "동일한 요청 규약"으로 로컬 백엔드 연동을 점검한다.
// - base URL은 프론트와 같은 소스(.env.local의 NEXT_PUBLIC_API_BASE_URL)에서 읽는다.
// - 변이 요청에 Idempotency-Key, 인증 요청에 Bearer 토큰을 붙인다(=api-client와 동일).
// - 각 단계를 ✓/✗/⚠ 로 보여주고, 실패 시 x-request-id와 에러 코드를 출력한다.
//
// 사용:
//   pnpm verify:backend            # = all: health → auth → read (+ shop 시도)
//   node scripts/e2e-check.mjs auth  # signup + login + owners/me (토큰을 .e2e-token.json에 저장)
//   node scripts/e2e-check.mjs read  # 저장된 토큰으로 오너 조회 엔드포인트 점검
//   node scripts/e2e-check.mjs shop  # 저장된 토큰으로 POST /shops/me
//
// 종료 코드: 0 성공 / 1 백엔드 미응답·인증 실패 / 2 샵 생성 실패(승인 필요 등)
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(HERE, '.e2e-token.json');

// ── base URL: 프론트와 동일하게 .env.local → .env → 기본값 순으로 읽는다 ──────────
function readEnvBaseUrl() {
  for (const name of ['.env.local', '.env']) {
    const p = join(HERE, '..', name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*NEXT_PUBLIC_API_BASE_URL\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  }
  return 'http://localhost:8000/api/v1';
}

const API_BASE_URL = readEnvBaseUrl().replace(/\/+$/, '');
// config.ts와 동일: path 키가 이미 /api/v1 을 포함하므로 origin에서 프리픽스를 제거한다.
const ORIGIN = API_BASE_URL.replace(/\/api\/v1$/, '');

const uuid = () => crypto.randomUUID();
const MUTATION = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// 색/기호 (터미널)
const OK = '\x1b[32m✓\x1b[0m';
const NO = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (MUTATION.has(method)) headers['Idempotency-Key'] = uuid();
  let res;
  try {
    res = await fetch(ORIGIN + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { status: 0, json: undefined, requestId: null, netError: e.message };
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, json, requestId: res.headers.get('x-request-id') };
}

function fail(msg) {
  console.error(`\n${NO} ${msg}`);
  process.exit(1);
}

// ── health ────────────────────────────────────────────────────────────────────
async function checkHealth() {
  const r = await call('GET', '/api/v1/health');
  if (r.status === 0) {
    console.error(`${NO} 백엔드에 연결할 수 없습니다: ${ORIGIN}  (${r.netError})`);
    console.error(`   백엔드를 먼저 기동하세요. 참고: backend-context/local_onboarding.md`);
    process.exit(1);
  }
  const okStatus = r.json?.status ?? r.status;
  console.log(`${OK} [health] ${ORIGIN}  status=${okStatus}`);
}

// ── auth: signup → login → owners/me → 토큰 저장 ────────────────────────────────
async function runAuth() {
  const email = `e2e.owner+${Date.now()}@example.com`;
  const password = 'Password123!';

  const signup = await call('POST', '/api/v1/auth/owner/signup', {
    body: {
      email,
      password,
      representative_name: '이투이 사장님',
      phone_number: '010-0000-0000',
      accepted_terms_version: '2026-05-28',
      accepted_privacy_version: '2026-05-28',
    },
  });
  if (signup.status >= 400)
    fail(`[signup] status=${signup.status} code=${signup.json?.error?.code} reqId=${signup.requestId}`);
  console.log(`${OK} [signup] status=${signup.status} verification=${signup.json?.verification_status}`);

  const login = await call('POST', '/api/v1/auth/owner/login', { body: { email, password } });
  if (login.status >= 400 || !login.json?.access_token)
    fail(`[login] status=${login.status} code=${login.json?.error?.code} reqId=${login.requestId}`);
  const token = login.json.access_token;
  console.log(`${OK} [login] status=${login.status} token_type=${login.json?.token_type}`);

  const me = await call('GET', '/api/v1/owners/me', { token });
  if (me.status >= 400) fail(`[owners/me] status=${me.status} reqId=${me.requestId}`);
  console.log(
    `${OK} [owners/me] status=${me.status} email=${me.json?.email} verification=${me.json?.verification_status}`,
  );

  writeFileSync(TOKEN_FILE, JSON.stringify({ email, token, ownerId: me.json?.id }, null, 2));
  console.log(`\n${OK} auth 흐름 통과. 토큰 저장됨 → scripts/.e2e-token.json (email=${email})`);
  return { email, token, verification: me.json?.verification_status };
}

function loadToken() {
  if (!existsSync(TOKEN_FILE)) fail('저장된 토큰이 없습니다. 먼저 `node scripts/e2e-check.mjs auth` 를 실행하세요.');
  return JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
}

// ── read: 오너용 조회 엔드포인트 도달성 점검 ────────────────────────────────────
// 새 오너(shop 없음)에서는 일부가 404(SHOP_NOT_FOUND)일 수 있고, 그건 "도달 성공"으로 본다.
async function runRead(tok) {
  const token = (tok ?? loadToken()).token;
  const targets = [
    ['GET', '/api/v1/owners/me'],
    ['GET', '/api/v1/owners/me/business-verification'],
    ['GET', '/api/v1/shops/me'],
    ['GET', '/api/v1/shops/me/designers'],
    ['GET', '/api/v1/shops/me/designs'],
    ['GET', '/api/v1/shops/me/design-folders'],
    ['GET', '/api/v1/shops/me/reservations'],
    ['GET', '/api/v1/shops/me/notifications'],
  ];
  console.log('\n오너 조회 엔드포인트 점검:');
  let hardFail = 0;
  for (const [method, path] of targets) {
    const r = await call(method, path, { token });
    if (r.status >= 200 && r.status < 300) {
      const n = Array.isArray(r.json?.data) ? ` items=${r.json.data.length}` : '';
      console.log(`  ${OK} ${method} ${path} → ${r.status}${n}`);
    } else if (r.status === 404) {
      // 샵 미생성 상태에서 흔함 — 도달 자체는 성공
      console.log(`  ${WARN} ${method} ${path} → 404 ${r.json?.error?.code ?? ''} (샵 미생성 시 정상)`);
    } else if (r.status === 401) {
      console.log(`  ${NO} ${method} ${path} → 401 인증 실패 reqId=${r.requestId}`);
      hardFail++;
    } else {
      console.log(`  ${NO} ${method} ${path} → ${r.status} ${r.json?.error?.code ?? ''} reqId=${r.requestId}`);
      hardFail++;
    }
  }
  if (hardFail) fail(`${hardFail}개 엔드포인트가 401/5xx로 실패했습니다.`);
  console.log(`\n${OK} read 점검 통과 (도달성·인증 정상).`);
}

// ── shop: POST /shops/me (승인된 오너만 성공) ───────────────────────────────────
async function runShop() {
  const { email, token } = loadToken();
  const create = await call('POST', '/api/v1/shops/me', {
    token,
    body: {
      name: 'E2E 네일 강남',
      address: '서울시 강남구 테헤란로 1',
      address_detail: '3층',
      region: '강남',
      location_tags: ['강남'],
      phone_number: '02-1234-5678',
      introduction: 'E2E 테스트 샵',
      payment_method: 'bank_transfer_guide',
      deposit_amount: 10000,
      bank_name: '스네일은행',
      bank_account_number: '123-456-7890',
      bank_account_holder: '이투이 사장님',
      auto_accept: false,
      reservation_policy: '하루 전 연락 부탁드려요.',
    },
  });
  if (create.status >= 200 && create.status < 300) {
    console.log(
      `\n${OK} [shops/me] 샵 저장 통과. shop_id=${create.json.id} visibility=${create.json.visibility} (email=${email})`,
    );
    return;
  }
  const code = create.json?.error?.code ?? '-';
  if (create.status === 403 || code === 'OWNER_NOT_APPROVED') {
    console.log(
      `\n${WARN} [shops/me] status=${create.status} code=${code} — 사업자 인증 승인(approved) 후에만 생성됩니다.`,
    );
    console.log(`   연결 자체는 정상(도달·인증 OK). 전체 해피패스는 어드민 승인 이후 재실행하세요.`);
    process.exit(0);
  }
  console.log(`\n${NO} [shops/me] status=${create.status} code=${code} reqId=${create.requestId}`);
  console.log(`   메시지: ${create.json?.error?.message ?? create.json}`);
  process.exit(2);
}

// ── 러너 ────────────────────────────────────────────────────────────────────────
const phase = process.argv[2] ?? 'all';
console.log(`대상: ${API_BASE_URL}  (phase=${phase})\n`);

if (phase === 'auth') {
  await checkHealth();
  await runAuth();
} else if (phase === 'read') {
  await checkHealth();
  await runRead();
} else if (phase === 'shop') {
  await checkHealth();
  await runShop();
} else if (phase === 'all') {
  await checkHealth();
  const authed = await runAuth();
  await runRead(authed);
  await runShop();
} else {
  fail(`알 수 없는 phase: ${phase} (auth | read | shop | all)`);
}
