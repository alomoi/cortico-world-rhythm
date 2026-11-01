#!/usr/bin/env node
/**
 * 行为冒烟测试：不需要 Coopanion，用假宿主与假时钟驱动 World 的计时逻辑。
 *
 * 覆盖的是「叫醒什么时候发生」这类代码分支：安静计时、再次叫醒、次数上限、
 * 使用者动作重置计时、排队期间使用者回来时作废、关闭计时、自己发言不重置。
 *
 * 私有字段在运行时可用（TypeScript 的 private 只是编译期约定），测试需要它：
 * 不用真实 5 秒定时器，而是手动调用 world.tick()，把时间拨到想验的那一刻。
 *
 *   npm run smoke   → 本文件
 */
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRATCH = join(ROOT, '.scratch');
if (!SCRATCH.startsWith(ROOT + sep)) throw new Error(`unexpected scratch path: ${SCRATCH}`);

const { default: definition } = await import('../src/index.ts');
const { fakeWorldContext } = await import('cortico/extensions/dry-mount.ts');
const { nullLogger } = await import('cortico/core/util.ts');

const ctxOptions = { scratchDir: SCRATCH, packageDir: ROOT, repoRoot: ROOT, language: 'zh' };

// 假时钟：world.ts 只通过 Date.now() 读时间，替换它就得到确定性。
const realNow = Date.now.bind(Date);
let clock = Date.parse('2026-11-01T09:00:00+08:00');
Date.now = () => clock;

const MINUTE = 60_000;
const failures = [];
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function harness(cfgOverrides = {}) {
  const ctx = fakeWorldContext(definition, ctxOptions);
  Object.assign(ctx.cfg, { enabled: true, quietMinutes: 15, repeatMinutes: 25, maxRounds: 0, jitter: 0, ...cfgOverrides });
  const world = definition.create(ctx);
  const events = [];
  const pushes = [];
  const host = {
    store: {
      get: () => undefined,
      latestCursor: () => events.length,
      range: () => events.slice(),
      around: () => [],
      grep: () => [],
    },
    log: nullLogger(),
    modelFacts: { model: () => 'test-model', accepts: () => true, contextWindow: () => undefined },
    pushDeferred: (spec, opts) => pushes.push({ spec, opts }),
  };
  return { world, host, events, pushes };
}

/** 启动但接管定时器：真实 5 秒周期关掉，由测试手动 tick()。 */
async function boot(h) {
  await h.world.start(h.host);
  clearInterval(h.world.timer);
}

/** 使用者的动作：事件库里加一条人侧事件。 */
function personSays(h, type = 'desktop-pet.message') {
  h.events.push({
    cursor: h.events.length + 1,
    type,
    ts: new Date(clock).toISOString(),
    source: 'desktop-pet',
    origin: 'external',
    text: 'hi',
  });
}

const advance = (minutes) => { clock += minutes * MINUTE; };

// ── 1. 安静计时与第一次叫醒 ────────────────────────────────────────────────
console.log('first nudge:');
{
  const h = harness();
  await boot(h);
  advance(14);
  h.world.tick();
  check('no nudge before the quiet span ends', h.pushes.length === 0);

  advance(1);
  h.world.tick();
  check('one nudge at 15 quiet minutes', h.pushes.length === 1);
  const text = h.pushes[0].spec.render();
  check('nudge text is rendered, not deferred to null', typeof text === 'string');
  check('nudge text says how long it was quiet', typeof text === 'string' && text.includes('15'), String(text));
  check('first nudge is not marked as a repeat', typeof text === 'string' && !text.includes('又安静'), String(text));
  check('trigger is flush (wake the idle loop at once)', h.pushes[0].opts?.trigger === 'flush');
  check('event origin is internal', h.pushes[0].spec.origin === 'internal');
  await h.world.stop();
}

// ── 2. 再次叫醒 ────────────────────────────────────────────────────────────
console.log('repeat nudge:');
{
  const h = harness();
  await boot(h);
  advance(15);
  h.world.tick();
  advance(24);
  h.world.tick();
  check('no repeat before repeatMinutes', h.pushes.length === 1);

  advance(1);
  h.world.tick();
  check('repeat at repeatMinutes after the previous nudge', h.pushes.length === 2);
  const text = h.pushes[1].spec.render();
  check('repeat text is marked as another quiet stretch', typeof text === 'string' && text.includes('又安静'), String(text));
  await h.world.stop();
}

// ── 3. 次数上限 ────────────────────────────────────────────────────────────
console.log('maxRounds:');
{
  const h = harness({ maxRounds: 2 });
  await boot(h);
  advance(15);
  h.world.tick();
  advance(25);
  h.world.tick();
  advance(25);
  h.world.tick();
  advance(25);
  h.world.tick();
  check('stops at the configured round cap', h.pushes.length === 2);

  const h2 = harness({ maxRounds: 0 });
  await boot(h2);
  advance(15);
  h2.world.tick();
  advance(25);
  h2.world.tick();
  advance(25);
  h2.world.tick();
  check('0 means no cap', h2.pushes.length === 3);
  await h.world.stop();
  await h2.world.stop();
}

// ── 4. 使用者动作重置计时 ──────────────────────────────────────────────────
console.log('activity resets the timer:');
{
  const h = harness();
  await boot(h);
  advance(15);
  h.world.tick();
  check('nudged once before the person returns', h.pushes.length === 1);

  advance(5);
  personSays(h);
  h.world.tick();
  check('rounds reset when the person speaks', h.world.rounds === 0);

  advance(14);
  h.world.tick();
  check('no nudge 14 minutes after the person spoke', h.pushes.length === 1);

  advance(1);
  h.world.tick();
  check('nudged again 15 minutes after the person spoke', h.pushes.length === 2);
  await h.world.stop();
}

// ── 5. 自己的发言不算使用者动作 ────────────────────────────────────────────
console.log('own speech is not activity:');
{
  const h = harness();
  await boot(h);
  advance(10);
  personSays(h, 'desktop-pet.self');
  personSays(h, 'console.self');
  h.world.tick();
  advance(5);
  h.world.tick();
  check('own speech does not restart the quiet stretch', h.pushes.length === 1);
  await h.world.stop();
}

// ── 6. 排队期间使用者回来 → 这一条作废 ─────────────────────────────────────
console.log('deferred render is cancelled by later activity:');
{
  const h = harness();
  await boot(h);
  advance(15);
  h.world.tick();
  const queued = h.pushes[0];
  check('nudge got queued', Boolean(queued));

  advance(1);
  personSays(h);
  check('queued nudge renders to null once the person is back', queued.spec.render() === null);
  await h.world.stop();
}

// ── 7. 关闭计时 ────────────────────────────────────────────────────────────
console.log('quietMinutes 0 turns the timer off:');
{
  const h = harness({ quietMinutes: 0 });
  await boot(h);
  advance(10 * 60);
  h.world.tick();
  check('no nudge with the timer off', h.pushes.length === 0);
  const lamp = h.world.webUi('zh').lamps[0];
  check('lamp reports the timer as off', lamp.state === 'online' && lamp.hint.includes('关闭'), lamp.hint);
  await h.world.stop();
}

// ── 8. 浮动倍数落在 [1, 1+jitter] ─────────────────────────────────────────
console.log('jitter stays in range:');
{
  const h = harness({ jitter: 0.5 });
  await boot(h);
  h.world.rollJitter();
  const factor = h.world.jitterFactor;
  check('jitter factor within 1–1.5', factor >= 1 && factor <= 1.5, String(factor));
  await h.world.stop();
}

Date.now = realNow;
console.log(failures.length === 0 ? 'PASS' : `FAILED (${failures.length})`);
process.exitCode = failures.length === 0 ? 0 : 1;
