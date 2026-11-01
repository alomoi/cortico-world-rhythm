#!/usr/bin/env node
/**
 * 行为冒烟测试：不需要 Coopanion，用假宿主与假时钟驱动 World 的计时逻辑。
 *
 * 覆盖：
 *   - 安静计时 / 再次叫醒 / 次数上限 / 关闭计时 / jitter；
 *   - 渠道无关的「有人回来了」：微信、QQ 等未知渠道都算；Coo 自己的 `*.self` 不算；
 *     `knownChannelsOnly` 可退回旧白名单；`activityIgnore` 可按类型或前缀排除；
 *   - 主循环忙（`onRunPhase`）时先不叫醒；
 *   - 状态落盘与重启续算、跨天清零、坏状态文件容错；
 *   - 投递结果（delivered / discarded）回写与计数回退；
 *   - 状态灯倒计时与徽标。
 *
 * 每个用例用独立的 scratch 子目录，互不共享状态文件。
 *
 *   npm run smoke   → 本文件
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRATCH_ROOT = join(ROOT, '.scratch');
if (!SCRATCH_ROOT.startsWith(ROOT + sep)) throw new Error(`unexpected scratch path: ${SCRATCH_ROOT}`);
// 每次跑都从空的 scratch 开始：否则上次留下的状态文件会让用例互相污染。
rmSync(SCRATCH_ROOT, { recursive: true, force: true });
mkdirSync(SCRATCH_ROOT, { recursive: true });

const { default: definition } = await import('../src/index.ts');
const { stateFilePath } = await import('../src/state.ts');
const { fakeWorldContext } = await import('cortico/extensions/dry-mount.ts');
const { nullLogger } = await import('cortico/core/util.ts');

const ctxOptions = (dir) => ({ scratchDir: dir, packageDir: ROOT, repoRoot: ROOT, language: 'zh' });

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

let caseIndex = 0;
const NEW_CASE_DEFAULTS = {
  enabled: true,
  quietMinutes: 15,
  repeatMinutes: 25,
  maxRounds: 0,
  jitter: 0,
  knownChannelsOnly: false,
  activityIgnore: '',
  // 大多数用例只想验时间逻辑，默认把空闲门控关掉；门控另有专门用例。
  onlyWhenIdle: false,
};

function harness(cfgOverrides = {}, opts = {}) {
  const dir = opts.dir ?? join(SCRATCH_ROOT, `case-${++caseIndex}`);
  mkdirSync(dir, { recursive: true });
  const ctx = fakeWorldContext(definition, ctxOptions(dir));
  const cfg = { ...NEW_CASE_DEFAULTS, ...cfgOverrides };
  Object.assign(ctx.cfg, cfg);
  const world = definition.create(ctx);
  const events = [];
  const pushes = [];
  const host = {
    store: {
      get: () => undefined,
      latestCursor: () => events.length,
      range: (query = {}) => {
        let out = events.slice();
        if (query.origin) out = out.filter((event) => (event.origin ?? 'external') === query.origin);
        if (typeof query.limit === 'number') out = out.slice(-query.limit);
        return out;
      },
      around: () => [],
      grep: () => [],
    },
    log: nullLogger(),
    modelFacts: { model: () => 'test-model', accepts: () => true, contextWindow: () => undefined },
    pushDeferred: (spec, opts2) => pushes.push({ spec, opts: opts2 }),
  };
  return { world, host, events, pushes, dir, cfg };
}

/** 启动但接管定时器：真实 5 秒周期关掉，由测试手动 tick()。 */
async function boot(h) {
  await h.world.start(h.host);
  clearInterval(h.world.timer);
}

/** 加一条事件；缺省 origin 为 external（和真实宿主一致）。 */
function addEvent(h, type, { origin = 'external', at = clock } = {}) {
  h.events.push({
    cursor: h.events.length + 1,
    type,
    ts: new Date(at).toISOString(),
    source: type.split('.')[0],
    origin,
    text: type,
  });
}

const advance = (minutes) => { clock += minutes * MINUTE; };
const iso = (at) => new Date(at).toISOString();
const readState = (h) => JSON.parse(readFileSync(stateFilePath(join(h.dir, 'deployment', 'data')), 'utf8'));

// ── 0. 配置缺省值 ──────────────────────────────────────────────────────────
console.log('config defaults:');
{
  const d = definition.defaults();
  check('onlyWhenIdle defaults on', d.onlyWhenIdle === true);
  check('knownChannelsOnly defaults off', d.knownChannelsOnly === false);
  check('activityIgnore defaults empty', d.activityIgnore === '');
}

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

// ── 4. 使用者动作重置计时（桌宠） ──────────────────────────────────────────
console.log('activity resets the timer:');
{
  const h = harness();
  await boot(h);
  advance(15);
  h.world.tick();
  check('nudged once before the person returns', h.pushes.length === 1);

  advance(5);
  addEvent(h, 'desktop-pet.message');
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

// ── 5. 渠道无关：微信 / QQ / B 站都算有人回来 ──────────────────────────────
console.log('any channel counts as a person:');
{
  for (const type of ['clawbridge.message', 'qq.message', 'bilibili.danmaku', 'discord.message']) {
    const h = harness();
    await boot(h);
    advance(14);
    addEvent(h, type);
    h.world.tick();
    advance(14);
    h.world.tick();
    check(`${type} restarts the quiet clock`, h.pushes.length === 0);
    await h.world.stop();
  }
}

// ── 6. Coo 自己说的话不算（*.self 仍是 external） ──────────────────────────
console.log('own speech is not activity:');
{
  const h = harness();
  await boot(h);
  advance(10);
  addEvent(h, 'desktop-pet.self');
  addEvent(h, 'console.self');
  h.world.tick();
  advance(5);
  h.world.tick();
  check('own speech does not restart the quiet stretch', h.pushes.length === 1);

  const h2 = harness();
  await boot(h2);
  advance(14);
  addEvent(h2, 'desktop-pet.self');
  h2.world.tick();
  advance(1);
  h2.world.tick();
  check('own speech does not postpone the nudge', h2.pushes.length === 1);
  await h.world.stop();
  await h2.world.stop();
}

// ── 7. 旧白名单可以退回 ────────────────────────────────────────────────────
console.log('knownChannelsOnly:');
{
  const h = harness({ knownChannelsOnly: true });
  await boot(h);
  advance(14);
  addEvent(h, 'clawbridge.message');
  h.world.tick();
  advance(1);
  h.world.tick();
  check('wechat is ignored when the old whitelist is on', h.pushes.length === 1, `${h.pushes.length} nudges`);

  const h2 = harness({ knownChannelsOnly: true });
  await boot(h2);
  advance(14);
  addEvent(h2, 'desktop-pet.message');
  h2.world.tick();
  advance(1);
  h2.world.tick();
  check('the pet still counts with the old whitelist', h2.pushes.length === 0);
  await h.world.stop();
  await h2.world.stop();
}

// ── 8. activityIgnore：精确类型与前缀 ──────────────────────────────────────
console.log('activityIgnore:');
{
  const h = harness({ activityIgnore: 'qq.system*, bilibili.system' });
  await boot(h);
  advance(14);
  addEvent(h, 'qq.system.login');
  h.world.tick();
  advance(1);
  h.world.tick();
  check('prefix patterns are ignored', h.pushes.length === 1, `${h.pushes.length} nudges`);

  const h2 = harness({ activityIgnore: 'qq.system*, bilibili.system' });
  await boot(h2);
  advance(14);
  addEvent(h2, 'qq.message');
  h2.world.tick();
  advance(1);
  h2.world.tick();
  check('other types from the same channel still count', h2.pushes.length === 0);
  await h.world.stop();
  await h2.world.stop();
}

// ── 9. 主循环忙的时候先不叫醒 ──────────────────────────────────────────────
console.log('onlyWhenIdle:');
{
  const h = harness({ onlyWhenIdle: true });
  await boot(h);
  h.world.onRunPhase({ state: 'model', running: [], enteredAt: iso(clock) });
  advance(15);
  h.world.tick();
  check('no nudge while the model is running', h.pushes.length === 0);

  h.world.onRunPhase({ state: 'tools', running: ['pet_say'], enteredAt: iso(clock) });
  advance(1);
  h.world.tick();
  check('no nudge while a tool is running', h.pushes.length === 0);

  h.world.onRunPhase({ state: 'idle', running: [], enteredAt: iso(clock) });
  h.world.tick();
  check('nudges once the loop is idle again', h.pushes.length === 1);
  await h.world.stop();
}

// ── 10. 状态落盘与重启续算 ────────────────────────────────────────────────
console.log('state persistence:');
{
  const h = harness();
  await boot(h);
  advance(15);
  h.world.tick();
  check('nudged once', h.pushes.length === 1);
  const saved = readState(h);
  check('state file records the nudge', saved.nudgesToday === 1 && saved.rounds === 1, JSON.stringify(saved));

  // 同一个部署目录再构造一次 = 进程重启
  advance(5);
  const h2 = harness(h.cfg, { dir: h.dir });
  await boot(h2);
  check('rounds survive a restart', h2.world.rounds === 1, String(h2.world.rounds));
  check('today count survives a restart', h2.world.state.nudgesToday === 1, String(h2.world.state.nudgesToday));

  advance(19);
  h2.world.tick();
  check('no repeat before the interval is up', h2.pushes.length === 0);
  advance(1);
  h2.world.tick();
  check('repeat fires on the restored schedule', h2.pushes.length === 1, `${h2.pushes.length}`);
  check('today count keeps counting after restart', h2.world.state.nudgesToday === 2, String(h2.world.state.nudgesToday));
  check('state file is updated', readState(h2).nudgesToday === 2);
  await h2.world.stop();
}

// ── 11. 停机太久不续，重新开始 ────────────────────────────────────────────
console.log('long downtime:');
{
  const h = harness();
  await boot(h);
  advance(15);
  h.world.tick();
  check('nudged once', h.pushes.length === 1);

  // 停机两天后再启动
  clock += 2 * 24 * 60 * MINUTE;
  const h2 = harness(h.cfg, { dir: h.dir });
  await boot(h2);
  check('a stale stretch does not nudge immediately', h2.pushes.length === 0);
  check('rounds reset after long downtime', h2.world.rounds === 0, String(h2.world.rounds));
  await h2.world.stop();
}

// ── 12. 跨天清零 ──────────────────────────────────────────────────────────
console.log('day rollover:');
{
  const h = harness();
  await boot(h);
  advance(15);
  h.world.tick();
  check('nudged once today', h.world.state.nudgesToday === 1);

  // 拨到第二天上午；直接调 rollDay，避免 tick 立刻再叫醒一次
  const nextDay = Date.parse('2026-11-02T09:00:00+08:00');
  clock = nextDay;
  h.world.rollDay(clock);
  check('today count resets on a new day', h.world.state.nudgesToday === 0, String(h.world.state.nudgesToday));
  check('state file follows the new day', readState(h).dayKey === '2026-11-02', readState(h).dayKey);
  await h.world.stop();
}

// ── 13. 坏状态文件不致命 ──────────────────────────────────────────────────
console.log('corrupt state file:');
{
  const h = harness();
  const file = stateFilePath(join(h.dir, 'deployment', 'data'));
  mkdirSync(join(h.dir, 'deployment', 'data', 'rhythm'), { recursive: true });
  writeFileSync(file, '{ this is not json', 'utf8');
  await boot(h);
  check('starts with an empty state instead of throwing', h.world.state.nudgesToday === 0);
  advance(15);
  h.world.tick();
  check('still nudges after a corrupt state file', h.pushes.length === 1);
  check('state file is rewritten', readState(h).nudgesToday === 1);
  await h.world.stop();
}

// ── 14. 投递结果回写 ──────────────────────────────────────────────────────
console.log('settle feedback:');
{
  const h = harness();
  await boot(h);
  advance(15);
  h.world.tick();
  const spec = h.pushes[0].spec;
  h.world.onEventsSettled([{ type: spec.type, cursor: 1, ts: iso(clock), source: 'rhythm', origin: 'internal', text: 'x' }], 'delivered');
  check('delivered is recorded', h.world.state.lastOutcome === 'delivered');
  check('delivered does not change the count', h.world.state.nudgesToday === 1);

  h.world.onEventsSettled([{ type: spec.type, cursor: 2, ts: iso(clock), source: 'rhythm', origin: 'internal', text: 'y' }], 'discarded');
  check('discarded is recorded', h.world.state.lastOutcome === 'discarded');
  check('discarded rolls the count back', h.world.state.nudgesToday === 0, String(h.world.state.nudgesToday));
  check('other events are ignored', (() => {
    const before = h.world.state.nudgesToday;
    h.world.onEventsSettled([{ type: 'clawbridge.message', cursor: 3, ts: iso(clock), source: 'clawbridge', origin: 'external', text: 'hi' }], 'discarded');
    return h.world.state.nudgesToday === before;
  })());
  await h.world.stop();
}

// ── 15. 状态灯倒计时与徽标 ────────────────────────────────────────────────
console.log('lamp and badge:');
{
  const h = harness();
  await boot(h);
  const lamp = h.world.webUi('zh').lamps[0];
  check('lamp shows the countdown', lamp.hint.includes('约 15 分钟'), lamp.hint);
  check('badge shows today count', h.world.webUi('zh').badges[0].value === 0);

  advance(5);
  const later = h.world.webUi('zh').lamps[0];
  check('countdown shrinks over time', later.hint.includes('约 10 分钟'), later.hint);

  advance(10);
  h.world.tick();
  const after = h.world.webUi('zh').lamps[0];
  check('badge follows the nudge', h.world.webUi('zh').badges[0].value === 1);
  check('lamp mentions today count', after.hint.includes('今日 1 次'), after.hint);

  const capped = harness({ maxRounds: 1 });
  await boot(capped);
  advance(15);
  capped.world.tick();
  advance(25);
  capped.world.tick();
  const capLamp = capped.world.webUi('zh').lamps[0];
  check('lamp reports the round cap', capLamp.hint.includes('本轮已叫醒 1 次'), capLamp.hint);
  await h.world.stop();
  await capped.world.stop();
}

// ── 16. 排队期间使用者回来 → 这一条作废 ───────────────────────────────────
console.log('deferred render is cancelled by later activity:');
{
  const h = harness();
  await boot(h);
  advance(15);
  h.world.tick();
  const queued = h.pushes[0];
  check('nudge got queued', Boolean(queued));

  advance(1);
  addEvent(h, 'qq.message');
  check('queued nudge renders to null once the person is back', queued.spec.render() === null);
  check('cancelled nudge is rolled back out of today count', h.world.state.nudgesToday === 0, String(h.world.state.nudgesToday));
  check('cancelled nudge is rolled back out of rounds', h.world.rounds === 0, String(h.world.rounds));
  await h.world.stop();
}

// ── 17. 关闭计时 / jitter ────────────────────────────────────────────────
console.log('quietMinutes 0 and jitter:');
{
  const h = harness({ quietMinutes: 0 });
  await boot(h);
  advance(10 * 60);
  h.world.tick();
  check('no nudge with the timer off', h.pushes.length === 0);
  const lamp = h.world.webUi('zh').lamps[0];
  check('lamp reports the timer as off', lamp.state === 'online' && lamp.hint.includes('关闭'), lamp.hint);
  await h.world.stop();

  const j = harness({ jitter: 0.5 });
  await boot(j);
  j.world.rollJitter();
  const factor = j.world.jitterFactor;
  check('jitter factor within 1–1.5', factor >= 1 && factor <= 1.5, String(factor));
  await j.world.stop();
}

Date.now = realNow;
console.log(failures.length === 0 ? 'PASS' : `FAILED (${failures.length})`);
process.exitCode = failures.length === 0 ? 0 : 1;
