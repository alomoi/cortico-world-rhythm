#!/usr/bin/env node
/**
 * 干装载检查：不启动 Coopanion，按框架 `check:extension` 的做法验证本 World。
 *
 * 检查项：
 *   1. 包的 manifest（name / version / cortico.kind / api / displayName）；
 *   2. dryMountWorld：`defaults()`、`create()`、`tools()`、`envPromptVars()`、`webUi()`
 *      与配置组路径（不调用 `start()`）；
 *   3. checkDescribe：定义里的 `describe` 与 `describe.json` 是否一致。
 *
 * `--write` 时按定义重新生成 `describe.json`（等价于上游的 `pnpm describe:extension`）。
 *
 * 必须用 Coopanion 自带的 Node + tsx + 框架解析钩子跑，见 scripts/run.ps1：
 *   npm run check      → check.mjs
 *   npm run describe   → check.mjs --write
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRATCH = join(ROOT, '.scratch');
const WRITE = process.argv.includes('--write');

/** 只清自己创建的那一层，路径不对宁可报错也不删。 */
function resetScratch() {
  if (!SCRATCH.startsWith(ROOT + sep) || !SCRATCH.endsWith(`${sep}.scratch`)) {
    throw new Error(`refusing to clean an unexpected scratch path: ${SCRATCH}`);
  }
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
}

function readJson(path) {
  // 手改过的 json 可能带 BOM，JSON.parse 会直接拒绝。
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

function print(report) {
  const { ok, warnings, failures } = report;
  for (const line of ok) console.log(`  ok    ${line}`);
  for (const line of warnings) console.log(`  warn  ${line}`);
  for (const line of failures) console.log(`  FAIL  ${line}`);
  return failures.length === 0;
}

async function main() {
  const pkg = readJson(join(ROOT, 'package.json'));
  console.log(`checking ${pkg.name}@${pkg.version} in ${ROOT}`);

  const { default: definition } = await import('../src/index.ts');
  const { dryMountWorld } = await import('cortico/extensions/dry-mount.ts');
  const { checkDescribe, exportDescribe } = await import('cortico/extensions/describe-export.ts');

  const opts = {
    scratchDir: SCRATCH,
    packageDir: ROOT,
    repoRoot: ROOT,
    language: 'zh',
  };

  let ok = true;

  // 1. manifest
  const meta = pkg.cortico ?? {};
  const manifestOk = [
    [definition.id === 'selftalk', `definition id is ${definition.id}`],
    [meta.kind === 'world', 'cortico.kind is world'],
    [meta.api === 6, `cortico.api is ${meta.api}`],
    [typeof meta.displayName === 'string' && meta.displayName.length > 0, 'cortico.displayName is set'],
    [typeof meta.describe === 'string', 'cortico.describe points at a file'],
    [typeof pkg.exports?.['.'] === 'string' && pkg.exports['.'] === pkg.main, `exports ${pkg.exports?.['.'] ?? '(none)'}`],
  ];
  console.log('manifest:');
  for (const [condition, label] of manifestOk) {
    const pass = condition === true;
    ok = ok && pass;
    console.log(`  ${pass ? 'ok   ' : 'FAIL '} ${label}`);
  }

  // 2. dry mount
  resetScratch();
  console.log('dry mount:');
  const dry = await dryMountWorld(definition, { ...opts, hasWebUiClient: Boolean(meta.webUiClient) });
  ok = print(dry) && ok;

  // 3. self-description
  console.log('self-description:');
  const describeReport = await checkDescribe('world', definition, meta.describe, opts);
  ok = print(describeReport) && ok;

  if (WRITE) {
    const file = await exportDescribe('world', definition, opts);
    if (!file) {
      console.log('  FAIL  definition has no describe, nothing to write');
      ok = false;
    } else {
      const target = join(ROOT, meta.describe);
      writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
      console.log(`  wrote ${meta.describe}`);
    }
  }

  resetScratch();
  rmSync(SCRATCH, { recursive: true, force: true });
  console.log(ok ? 'PASS' : 'FAILED');
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error('check crashed:', error);
  process.exitCode = 1;
});
