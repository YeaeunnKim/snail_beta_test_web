// CODEMAP 신선도 게이트 (Next.js App Router 판).
//
// snail_ios/scripts/check-codemap.mjs 와 같은 역할이지만 두 가지가 다르다:
//   1) 커버리지 루트가 screens/hooks/api 가 아니라 app/services/hooks 다.
//   2) app/ 아래는 basename 이 전부 page.tsx·layout.tsx 라 이름으로는 구분이 안 된다.
//      그래서 app/ 만 «상대경로» 로 대조하고, services/hooks 는 basename 으로 본다.
//
// 한 줄에 `codemap:skip` 을 적으면 그 줄은 대조에서 빠진다.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const repoRoot = process.cwd();
const srcRoot = join(repoRoot, 'src');
const codemapPath = join(repoRoot, 'docs', 'CODEMAP.md');

// 상대경로로 대조하는 루트 (basename 이 겹치는 곳)
const pathCoverageRoots = ['app'];
// basename 으로 대조하는 루트
const nameCoverageRoots = ['services', 'hooks'];

const referencePattern =
  /\b(app|components|services|hooks|lib|types|styles)\/[A-Za-z0-9_\-./[\]()@]+/g;

const toPosix = (p) => p.replaceAll('\\', '/');

function getCodemapBody() {
  return readFileSync(codemapPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.includes('codemap:skip'))
    .join('\n');
}

function getReferencedPaths(body) {
  const refs = new Set();
  let match;
  while ((match = referencePattern.exec(body)) !== null) {
    refs.add(match[0].replace(/[.,]+$/, ''));
  }
  return [...refs].sort();
}

function findMissingReferences(references) {
  return references.filter((reference) => {
    const fullPath = join(srcRoot, ...reference.split('/'));
    if (!existsSync(fullPath)) return true;
    if (reference.endsWith('/')) return !statSync(fullPath).isDirectory();
    return !statSync(fullPath).isFile();
  });
}

function isCoveredSourceFile(fileName) {
  if (!/\.(ts|tsx)$/.test(fileName)) return false;
  if (/\.d\.ts$/.test(fileName)) return false;
  return !fileName.includes('.test.');
}

function collect(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      files.push(...collect(entryPath));
      continue;
    }
    if (entry.isFile() && isCoveredSourceFile(entry.name)) files.push(entryPath);
  }
  return files;
}

const body = getCodemapBody();

// app/ — 라우트 파일만 본다(page/layout/route/template). 그 외 co-located 파일은 제외.
const routeFiles = pathCoverageRoots
  .flatMap((root) => collect(join(srcRoot, root)))
  .map((p) => toPosix(relative(srcRoot, p)))
  .filter((p) => /\/(page|layout|route|template)\.tsx?$/.test(p))
  .sort();

const nameFiles = nameCoverageRoots
  .flatMap((root) => collect(join(srcRoot, root)))
  .map((p) => ({ basename: basename(p), relativePath: toPosix(relative(srcRoot, p)) }))
  .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

const missingReferences = findMissingReferences(getReferencedPaths(body));
const unlistedRoutes = routeFiles.filter((p) => !body.includes(p));
const unlistedNames = nameFiles.filter((f) => !body.includes(f.basename));

if (missingReferences.length || unlistedRoutes.length || unlistedNames.length) {
  console.error('CODEMAP freshness gate failed.');
  if (missingReferences.length) {
    console.error('\nCODEMAP 이 가리키는데 src/ 에 없는 경로:');
    for (const r of missingReferences) console.error(`- ${r}`);
  }
  if (unlistedRoutes.length) {
    console.error('\ndocs/CODEMAP.md 에 없는 라우트 파일(상대경로 대조):');
    for (const r of unlistedRoutes) console.error(`- ${r}`);
  }
  if (unlistedNames.length) {
    console.error('\ndocs/CODEMAP.md 에 없는 파일(basename 대조):');
    for (const f of unlistedNames) console.error(`- ${f.relativePath} (${f.basename})`);
  }
  process.exit(1);
}

console.log(
  `CODEMAP freshness OK: routes ${routeFiles.length}, services+hooks ${nameFiles.length}.`,
);
