#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONFIG = {
  projectName: 'snail_beta_test_web',
  productionUrl: 'https://snailbetatestweb.vercel.app',
  expectedApiRefs: ['https://api.snail-nail.com/api/v1', 'https://api.snail-nail.com'],
  healthUrl: 'https://api.snail-nail.com/api/v1/health',
  forbiddenUrls: ['https://snail-beta-test-web.vercel.app'],
  forbiddenRefs: ['https://snail-api-282891391179.asia-southeast1.run.app/api/v1'],
};

const inputUrl = process.argv.find((arg) => arg.startsWith('--url='))?.slice('--url='.length);
const targetUrl = (inputUrl || CONFIG.productionUrl).replace(/\/+$/, '') + '/';

function log(message) {
  console.log(`[deploy-target] ${message}`);
}

function fail(message) {
  console.error(`[deploy-target] ERROR: ${message}`);
  process.exitCode = 1;
}

async function fetchText(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  return { response, text };
}

function checkLocalVercelLink() {
  try {
    const projectJson = JSON.parse(readFileSync(resolve('.vercel/project.json'), 'utf8'));
    if (projectJson.projectName !== CONFIG.projectName) {
      fail(`.vercel/project.json points to ${projectJson.projectName}, expected ${CONFIG.projectName}`);
      return;
    }
    log(`local Vercel link OK (${projectJson.projectName})`);
  } catch {
    log('local Vercel link not found; skipping .vercel/project.json check');
  }
}

function collectScriptUrls(html, pageUrl) {
  const base = new URL(pageUrl);
  return [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)]
    .map((match) => new URL(match[1], base).toString())
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

async function scanBundle() {
  if (CONFIG.forbiddenUrls.includes(targetUrl.replace(/\/+$/, ''))) {
    fail(`${targetUrl} is a retired beta URL; use ${CONFIG.productionUrl}`);
    return;
  }

  const { response, text: html } = await fetchText(targetUrl);
  if (!response.ok) {
    fail(`${targetUrl} returned ${response.status}`);
    return;
  }

  const scriptUrls = collectScriptUrls(html, targetUrl);
  if (scriptUrls.length === 0) {
    fail(`no JS scripts found in ${targetUrl}`);
    return;
  }

  const bundleText = [];
  for (const scriptUrl of scriptUrls) {
    const { response: scriptResponse, text } = await fetchText(scriptUrl);
    if (!scriptResponse.ok) {
      fail(`${scriptUrl} returned ${scriptResponse.status}`);
      continue;
    }
    bundleText.push(text);
  }
  const allJs = bundleText.join('\n');

  for (const forbidden of CONFIG.forbiddenRefs) {
    if (allJs.includes(forbidden)) {
      fail(`bundle still references forbidden API ${forbidden}`);
    }
  }

  if (!CONFIG.expectedApiRefs.some((ref) => allJs.includes(ref))) {
    fail(`bundle does not reference expected API (${CONFIG.expectedApiRefs.join(' or ')})`);
  } else {
    log('bundle API reference OK');
  }
}

async function checkHealthAndCors() {
  const { response, text } = await fetchText(CONFIG.healthUrl);
  if (!response.ok || !text.includes('"status":"ok"')) {
    fail(`health check failed: HTTP ${response.status} ${text}`);
  } else {
    log('backend health OK');
  }

  const corsResponse = await fetch(CONFIG.healthUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: CONFIG.productionUrl,
      'Access-Control-Request-Method': 'GET',
    },
  });
  const allowedOrigin = corsResponse.headers.get('access-control-allow-origin');
  if (allowedOrigin !== CONFIG.productionUrl) {
    fail(`CORS origin mismatch: ${allowedOrigin ?? '(missing)'}`);
  } else {
    log('CORS preflight OK');
  }
}

checkLocalVercelLink();
await scanBundle();
await checkHealthAndCors();

if (process.exitCode) {
  process.exit(process.exitCode);
}
log('deployment target checks passed');
