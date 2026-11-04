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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRATCH_ROOT = join(ROOT, '.scratch');
if (!SCRATCH_ROOT.startsWith(ROOT + sep)) throw new Error(`unexpected scratch path: ${SCRATCH_ROOT}`);
// 每次跑都从空的 scratch 开始：否则上次留下的状态文件会让用例互相污染。
rmSync(SCRATCH_ROOT, { recursive: true, force: true });
mkdirSync(SCRATCH_ROOT, { recursive: true });

const { default: definition } = await import('../src/index.ts');
const { stateFilePath } = await import('../src/state.ts');
const { messagesPath } = await import('../src/messages.ts');
const windows = await import('../src/windows.ts');
const ctxmod = await import('../src/context.ts');
const presenceMod = await import('../src/presence.ts');
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
  // 时段与节制在旧用例里默认关掉，保持确定性；专门用例会显式打开。
  sleepWindow: '',
  restWindows: '',
  dailyCap: 0,
  willingnessEnabled: false,
  willingnessMaxMinutes: 480,
  willingnessHint: true,
  // 睡眠用例保持确定性：做梦默认开后，这里显式关掉；造梦用例自己打开。
  dreamEnabled: false,
  skipChance: 0,
  knownChannelsOnly: false,
  activityIgnore: '',
  // 大多数用例只想验时间逻辑，默认把空闲门控关掉；门控另有专门用例。
  onlyWhenIdle: false,
  // 探测默认关，保持旧用例同步；专门用例里显式打开。
  awayDetection: false,
  awayIdleMinutes: 10,
  pauseWhenLocked: false,
  awayHint: true,
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
  const hints = [];
  const archived = [];
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
    pushDeferred: (spec, opts2) => {
      // 睡眠提示与叫醒分开收：旧用例只关心叫醒，新用例单独看 hints。
      if (spec.type === 'rhythm.hint') hints.push({ spec, opts: opts2 });
      else pushes.push({ spec, opts: opts2 });
    },
    pushEvent: async (event, opts2) => {
      archived.push({ event, opts: opts2 });
      return event;
    },
  };
  return { world, host, events, pushes, hints, archived, dir, cfg };
}

/** 启动但接管定时器：真实 5 秒周期关掉，由测试手动 tick()。 */
async function boot(h) {
  await h.world.start(h.host);
  clearInterval(h.world.timer);
}

/** 加一条事件；缺省 origin 为 external（和真实宿主一致）。 */
function addEvent(h, type, { origin = 'external', at = clock, meta } = {}) {
  h.events.push({
    cursor: h.events.length + 1,
    type,
    ts: new Date(at).toISOString(),
    source: type.split('.')[0],
    origin,
    text: type,
    meta,
  });
}

const advance = (minutes) => { clock += minutes * MINUTE; };
/** 把假时钟拨到某一天某个时刻（带 +08:00 偏移的 ISO 写法）。 */
const at = (time) => { clock = Date.parse(time); };
const iso = (at) => new Date(at).toISOString();
const readState = (h) => JSON.parse(readFileSync(stateFilePath(join(h.dir, 'deployment', 'data')), 'utf8'));

// ── 0. 配置缺省值 ──────────────────────────────────────────────────────────
console.log('config defaults:');
{
  const d = definition.defaults();
  check('onlyWhenIdle defaults on', d.onlyWhenIdle === true);
  check('knownChannelsOnly defaults off', d.knownChannelsOnly === false);
  check('activityIgnore defaults empty', d.activityIgnore === '');
  check('sleep window defaults to 22:00-08:00', d.sleepWindow === '22:00-08:00');
  check('rest windows default empty', d.restWindows === '');
  check('dailyCap defaults to 12', d.dailyCap === 12);
  check('willingness is on by default', d.willingnessEnabled === true);
  check('willingness cap defaults to 8 hours', d.willingnessMaxMinutes === 480);
  check('willingness hint defaults on', d.willingnessHint === true);
  check('diagnostics are off by default', d.debug === false);
  check('skipChance defaults to 0', d.skipChance === 0);
  check('sleepHint defaults on', d.sleepHint === true);
  check('wakeHint defaults on', d.wakeHint === true);
  check('wakeGapMinutes defaults to 30', d.wakeGapMinutes === 30);
  check('wakeHintSeconds defaults to 90', d.wakeHintSeconds === 90);
  check('dryRun defaults off', d.dryRun === false);
  check('contextAware defaults on', d.contextAware === true);
  check('contextQuotes defaults on', d.contextQuotes === true);
  check('contextStaleMinutes defaults to 120', d.contextStaleMinutes === 120);
  check('awayDetection defaults on', d.awayDetection === true);
  check('awayIdleMinutes defaults to 10', d.awayIdleMinutes === 10);
  check('pauseWhenLocked defaults off', d.pauseWhenLocked === false);
  check('awayHint defaults on', d.awayHint === true);
  check('idle probing defaults off (no runtime compile)', d.awayIdleProbe === false);
  check('dreaming defaults on', d.dreamEnabled === true);
  check('dream chance defaults to 0.3', d.dreamChance === 0.3);
  check('dream diary defaults to the workspace-relative path', d.dreamDiary === 'partner/dreams.md');
  check('speakTools defaults to the four known send tools', /pet_say/.test(d.speakTools) && /clawbridge_send/.test(d.speakTools));
  check('speakIgnore defaults empty', d.speakIgnore === '');
  check('loose speak matching defaults off', d.speakMatchAnywhere === false);
}

// ── 1. 安静计时与第一次叫醒 ────────────────────────────────────────────────
console.log('config groups: six feature cards covering every default:');
{
  const cfgmod = await import('../src/config.ts');
  const groups = cfgmod.rhythmConfigGroups('zh');
  check('six feature groups are declared', groups.length === 6, String(groups.length));
  check('group ids are unique', new Set(groups.map((g) => g.id)).size === groups.length, groups.map((g) => g.id).join(','));
  const paths = groups.flatMap((g) => Object.keys(g.schema.properties));
  check('no property is declared twice', new Set(paths).size === paths.length, paths.join(','));
  const defaults = Object.keys(cfgmod.RHYTHM_DEFAULTS).filter((key) => key !== 'skipChance' && key !== 'enabled');
  const missing = defaults.filter((key) => !paths.includes(`worlds.rhythm.${key}`));
  check('every default has a visible setting', missing.length === 0, missing.join(','));
  check('each group has a title', groups.every((g) => typeof g.schema.title === 'string' && g.schema.title.length > 0));
}

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
  check('repeat uses the same template with a larger quiet span', typeof text === 'string' && text.includes('安静了约 40 分钟') && text.includes('工具'), String(text));
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

// ── 18. 时段解析（纯函数） ────────────────────────────────────────────────
console.log('window parsing:');
{
  check('parses HH:MM', windows.parseClock('22:00') === 22 * 60);
  check('parses single-digit hour', windows.parseClock('9:05') === 9 * 60 + 5);
  check('rejects 24:00', windows.parseClock('24:00') === null);
  check('rejects nonsense', windows.parseClock('abc') === null);
  check('formats back to HH:MM', windows.formatClock(8 * 60) === '08:00');

  const sleep = windows.parseWindow('22:00-08:00');
  check('parses a wrapping window', sleep !== null && sleep.start === 1320 && sleep.end === 480);

  check('23:30 is inside 22:00-08:00', windows.inWindow(23 * 60 + 30, sleep) === true);
  check('00:30 is inside 22:00-08:00', windows.inWindow(30, sleep) === true);
  check('07:59 is inside 22:00-08:00', windows.inWindow(7 * 60 + 59, sleep) === true);
  check('08:00 is outside (end is exclusive)', windows.inWindow(8 * 60, sleep) === false);
  check('12:00 is outside', windows.inWindow(12 * 60, sleep) === false);

  const list = windows.parseWindowList('12:30-14:00, 18:00-18:30');
  check('parses several rest windows', list.windows.length === 2 && list.errors.length === 0);
  check('splits on semicolons and newlines too', windows.parseWindowList('12:30-14:00; 18:00-18:30\n20:00-20:10').windows.length === 3);
  check('empty string means none', windows.parseWindowList('').windows.length === 0);
  const bad = windows.parseWindowList('12:30-14:00, 25:00-26:00');
  check('bad entries are skipped with an error', bad.windows.length === 1 && bad.errors.length === 1);
  check('start === end is rejected', windows.parseWindowList('12:00-12:00').errors.length === 1);
  check('minutes until end handles wrap', windows.minutesUntilWindowEnd(23 * 60 + 30, sleep) === 8 * 60 + 30);
}

// ── 19. 睡眠时段：不叫醒、跨午夜、睡醒重新计时 ──────────────────────────
console.log('sleep window:');
{
  at('2026-11-02T21:00:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00' });
  await boot(h);
  advance(20);
  h.world.tick();
  check('nudges normally before the sleep window', h.pushes.length === 1);

  advance(70); // 22:30
  h.world.tick();
  check('no nudge during the sleep window', h.pushes.length === 1);
  const lamp = h.world.webUi('zh').lamps[0];
  check('lamp reports the sleep window', lamp.hint.includes('睡眠时段') && lamp.hint.includes('08:00'), lamp.hint);

  at('2026-11-02T23:50:00+08:00');
  const h2 = harness({ sleepWindow: '22:00-08:00' });
  await boot(h2);
  advance(40); // 00:30
  h2.world.tick();
  check('a wrap-past-midnight window blocks at 00:30', h2.pushes.length === 0);
  await h.world.stop();
  await h2.world.stop();
}

console.log('waking up resets the quiet clock:');
{
  at('2026-11-02T07:50:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00' });
  await boot(h);
  h.world.tick();
  check('still asleep at 07:50', h.pushes.length === 0);

  at('2026-11-02T08:00:00+08:00');
  h.world.tick();
  check('no nudge right at the end of the window', h.pushes.length === 0);
  advance(14);
  h.world.tick();
  check('no nudge 14 minutes after waking', h.pushes.length === 0);
  advance(1);
  h.world.tick();
  check('nudges 15 minutes after waking', h.pushes.length === 1);
  await h.world.stop();
}

console.log('a queued nudge is cancelled when the window starts:');
{
  at('2026-11-02T21:40:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00' });
  await boot(h);
  advance(15);
  h.world.tick();
  check('nudge queued at 21:55', h.pushes.length === 1);
  advance(5); // 22:00，进入睡眠时段
  check('queued nudge renders to null in the window', h.pushes[0].spec.render() === null);
  check('cancelled nudge is rolled back', h.world.state.nudgesToday === 0);
  await h.world.stop();
}

// ── 20. 休息时段：默认关、可开、可写多个 ─────────────────────────────────
console.log('rest windows:');
{
  at('2026-11-02T12:31:00+08:00');
  const off = harness({ restWindows: '' });
  await boot(off);
  advance(15);
  off.world.tick();
  check('no rest window configured: nudges as usual', off.pushes.length === 1);
  await off.world.stop();

  at('2026-11-02T12:31:00+08:00');
  const on = harness({ restWindows: '12:30-14:00' });
  await boot(on);
  advance(60);
  on.world.tick();
  check('no nudge during a rest window', on.pushes.length === 0);
  check('lamp reports the rest window', on.world.webUi('zh').lamps[0].hint.includes('休息时段'));

  const multi = harness({ restWindows: '12:30-14:00, 18:00-18:30' });
  await boot(multi);
  check('several rest windows are accepted', multi.world.restWindows.length === 2, String(multi.world.restWindows.length));

  at('2026-11-02T18:21:00+08:00');
  const second = harness({ restWindows: '12:30-14:00, 18:00-18:30' });
  await boot(second);
  advance(8);
  second.world.tick();
  check('the second rest window also blocks', second.pushes.length === 0);

  advance(1); // 18:30
  second.world.tick();
  advance(15);
  second.world.tick();
  check('nudges 15 minutes after the second rest ends', second.pushes.length === 1);
  await on.world.stop();
  await multi.world.stop();
  await second.world.stop();
}

// ── 21. 每日上限 ──────────────────────────────────────────────────────────
console.log('daily cap:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ dailyCap: 2 });
  await boot(h);
  advance(15);
  h.world.tick();
  advance(25);
  h.world.tick();
  advance(25);
  h.world.tick();
  check('stops at the daily cap', h.pushes.length === 2, `${h.pushes.length}`);
  const lamp = h.world.webUi('zh').lamps[0];
  check('lamp reports the daily cap', lamp.hint.includes('今日已达上限 2 次'), lamp.hint);
  check('badge shows the capped count', h.world.webUi('zh').badges[0].value === 2);

  at('2026-11-03T09:00:00+08:00');
  h.world.tick();
  check('the cap resets on a new day', h.pushes.length === 3 && h.world.state.nudgesToday === 1, `${h.pushes.length}/${h.world.state.nudgesToday}`);
  await h.world.stop();
}

console.log('maxRounds and dailyCap, whichever comes first:');
{
  at('2026-11-02T09:00:00+08:00');
  const roundsFirst = harness({ dailyCap: 5, maxRounds: 2 });
  await boot(roundsFirst);
  advance(15);
  roundsFirst.world.tick();
  advance(25);
  roundsFirst.world.tick();
  advance(25);
  roundsFirst.world.tick();
  check('maxRounds stops first', roundsFirst.pushes.length === 2);

  const capFirst = harness({ dailyCap: 1, maxRounds: 5 });
  await boot(capFirst);
  advance(15);
  capFirst.world.tick();
  advance(25);
  capFirst.world.tick();
  check('dailyCap stops first', capFirst.pushes.length === 1);
  await roundsFirst.world.stop();
  await capFirst.world.stop();
}

// ── 22. 退避：只数「主动搭话却没人回」，不数叫醒次数 ──────────────────────
/** 模拟主会话流：它调用了某个工具。 */
const tapTool = (h, name) => h.world.outputTap().onEvent({ type: 'response.output_item.added', item: { type: 'function_call', name } });

console.log('willingness counts only unanswered outreach:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ repeatMinutes: 10, willingnessEnabled: true });
  await boot(h);
  advance(15);
  h.world.tick();                        // 1 @ 15，静默（没开口）
  check('first nudge fires', h.pushes.length === 1);
  check('a silent turn is not an attempt', h.world.state.unanswered === 0);

  tapTool(h, 'pet_say');                 // 这一轮它开口了
  advance(10);
  h.world.tick();                        // 2 @ 25，结算 → unanswered 1
  check('an unanswered outreach is counted', h.world.state.unanswered === 1, `${h.world.state.unanswered}`);

  advance(14);
  h.world.tick();                        // 39
  check('no nudge before the stretched interval', h.pushes.length === 2);
  advance(1);
  h.world.tick();                        // 40 = 25 + 10×1.5
  check('the interval stretches by 1.5 after the first ignored outreach', h.pushes.length === 3);

  tapTool(h, 'web_search');              // 这一轮它去查资料，没跟人说话
  advance(15);
  h.world.tick();                        // 55 = 40 + 15
  check('a silent research turn still nudges on schedule', h.pushes.length === 4);
  check('and it does not make the willingness worse', h.world.state.unanswered === 1);

  advance(15);
  addEvent(h, 'qq.message');
  h.world.tick();                        // 70：有人回话 → 意愿恢复
  check('a reply clears the unanswered count', h.world.state.unanswered === 0);
  advance(30);
  h.world.tick();                        // 100：安静的基准间隔再次生效
  check('the base interval is back after a reply', h.pushes.length === 5);
  await h.world.stop();
}

console.log('only configured speak tools count:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ repeatMinutes: 10, backoffAfter: 1, backoffFactor: 2 });
  await boot(h);
  advance(15);
  h.world.tick();
  tapTool(h, 'web_search');
  advance(10);
  h.world.tick();
  check('a non-speech tool is not an attempt', h.world.state.unanswered === 0);

  tapTool(h, 'pet_say');
  advance(10);
  h.world.tick();
  check('a speech tool is an attempt', h.world.state.unanswered === 1);
  await h.world.stop();

  const custom = harness({ repeatMinutes: 10, backoffAfter: 1, speakTools: 'my_send' });
  await boot(custom);
  advance(15);
  custom.world.tick();
  tapTool(custom, 'pet_say');
  advance(10);
  custom.world.tick();
  check('a custom list ignores pet_say', custom.world.state.unanswered === 0);
  tapTool(custom, 'my_send');
  advance(10);
  custom.world.tick();
  check('and counts the tool it names', custom.world.state.unanswered === 1);
  await custom.world.stop();
}

console.log('channels are learned from person-side events:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ repeatMinutes: 10, backoffAfter: 1 });
  await boot(h);
  advance(1);
  addEvent(h, 'qq.message');   // 学到一个新渠道前缀 qq
  h.world.tick();
  advance(15);
  h.world.tick();
  check('the learned prefix is remembered', h.world.channelPrefixes.has('qq'));
  tapTool(h, 'qq_send');       // 前缀 qq + 动词 send → 自动认定为搭话
  advance(10);
  h.world.tick();
  check('a learnable plugin tool counts without configuration', h.world.state.unanswered === 1, String(h.world.state.unanswered));
  await h.world.stop();
}

console.log('channel prefix alone is not enough:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ repeatMinutes: 10, backoffAfter: 1 });
  await boot(h);
  advance(1);
  addEvent(h, 'qq.message');
  h.world.tick();
  advance(15);
  h.world.tick();
  tapTool(h, 'qq_list');       // 渠道对，动词不是说话
  advance(10);
  h.world.tick();
  check('a non-speech tool on a known channel does not count', h.world.state.unanswered === 0);

  tapTool(h, 'web_search');    // 前缀没学到，动词也不是说话
  advance(10);
  h.world.tick();
  check('an unknown channel with a non-speech verb does not count', h.world.state.unanswered === 0);
  await h.world.stop();
}

console.log('explicit list and ignore list win:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ repeatMinutes: 10, backoffAfter: 1, speakTools: 'my_thing' });
  await boot(h);
  advance(15);
  h.world.tick();
  tapTool(h, 'my_thing');      // 命名完全不按约定，但进了显式名单
  advance(10);
  h.world.tick();
  check('an explicitly listed tool counts', h.world.state.unanswered === 1);
  await h.world.stop();

  const ignored = harness({ repeatMinutes: 10, backoffAfter: 1, speakIgnore: 'qq_send' });
  await boot(ignored);
  advance(1);
  addEvent(ignored, 'qq.message');
  ignored.world.tick();
  advance(15);
  ignored.world.tick();
  tapTool(ignored, 'qq_send'); // 本可自动识别，但被忽略名单否掉
  advance(10);
  ignored.world.tick();
  check('the ignore list wins over auto-detection', ignored.world.state.unanswered === 0);
  await ignored.world.stop();
}

console.log('loose matching catches odd names:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ repeatMinutes: 10, backoffAfter: 1, speakMatchAnywhere: true });
  await boot(h);
  advance(15);
  h.world.tick();
  tapTool(h, 'sendMsgToWechat');
  advance(10);
  h.world.tick();
  check('a verb anywhere in the name counts in loose mode', h.world.state.unanswered === 1);
  await h.world.stop();
}

console.log('a reply in the same turn clears the attempt:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ repeatMinutes: 10, backoffAfter: 1 });
  await boot(h);
  advance(15);
  h.world.tick();
  tapTool(h, 'pet_say');
  advance(5);
  addEvent(h, 'qq.message');
  h.world.tick();
  advance(5);
  h.world.tick();
  check('the attempt is dropped when the person answers', h.world.state.unanswered === 0);
  await h.world.stop();
}

// ── 23. 概率跳过（无 UI，默认关） ─────────────────────────────────────────
console.log('skipChance:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ skipChance: 1 });
  await boot(h);
  advance(15);
  h.world.tick();
  check('a certain skip never nudges', h.pushes.length === 0);
  advance(25);
  h.world.tick();
  check('still skipped on the next interval', h.pushes.length === 0);

  const never = harness({ skipChance: 0 });
  await boot(never);
  advance(15);
  never.world.tick();
  check('skipChance 0 never skips', never.pushes.length === 1);
  await h.world.stop();
  await never.world.stop();
}

// ── 24. 坏时段不致命 ──────────────────────────────────────────────────────
console.log('broken window settings:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ sleepWindow: '25:00-08:00', restWindows: 'nonsense' });
  await boot(h);
  advance(15);
  h.world.tick();
  check('invalid windows fall back to no window', h.pushes.length === 1);
  check('invalid windows yield an empty list', h.world.sleepWindows.length === 0 && h.world.restWindows.length === 0);
  await h.world.stop();
}

// ── 25. 睡眠提示与「被吵醒」 ─────────────────────────────────────────────
console.log('sleep messages:');
{
  at('2026-11-02T21:50:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00' });
  await boot(h);
  check('no hint before the window starts', h.hints.length === 0);

  advance(10); // 22:00
  h.world.tick();
  check('bedtime hint is sent once', h.hints.length === 1 && h.hints[0].spec.meta.kind === 'sleep');
  check('bedtime hint carries the local time', String(h.hints[0].spec.render()).includes('22:00'));
  check('bedtime hint uses flush', h.hints[0].opts?.trigger === 'flush');

  advance(9 * 60); // 07:00
  h.world.tick();
  check('no wake hint while still asleep', h.hints.length === 1);

  at('2026-11-03T08:00:00+08:00');
  h.world.tick();
  check('wake hint is sent at the end of the window', h.hints.length === 2 && h.hints[1].spec.meta.kind === 'wake');
  check('the bedtime hint is not repeated', h.hints.filter((x) => x.spec.meta.kind === 'sleep').length === 1);
  await h.world.stop();
}

console.log('sleep hints can be turned off:');
{
  at('2026-11-02T21:50:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00', sleepHint: false });
  await boot(h);
  advance(10);
  h.world.tick();
  at('2026-11-03T08:00:00+08:00');
  h.world.tick();
  check('no sleep or wake hint when sleepHint is off', h.hints.length === 0);
  await h.world.stop();

  const none = harness({ sleepWindow: '' });
  await boot(none);
  advance(10);
  none.world.tick();
  check('no hints without a sleep window', none.hints.length === 0);
  await none.world.stop();
}

console.log('a restart inside the window does not re-send the bedtime hint:');
{
  at('2026-11-02T22:10:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00' });
  await boot(h);
  h.world.tick();
  check('no bedtime hint on a late start', h.hints.length === 0);
  const h2 = harness(h.cfg, { dir: h.dir });
  await boot(h2);
  h2.world.tick();
  check('still none after a restart', h2.hints.length === 0);
  await h.world.stop();
  await h2.world.stop();
}

console.log('counting wake-ups:');
{
  at('2026-11-02T22:05:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00', wakeGapMinutes: 30 });
  await boot(h);
  h.world.tick();

  advance(1);
  addEvent(h, 'qq.message');
  h.world.tick();
  check('the first interruption counts once', h.world.state.sleep.wokeCount === 1);
  check('one archived woke event', h.archived.filter((x) => x.event.type === 'rhythm.woke').length === 1);
  check('the archived record is not delivered', h.archived[0].opts?.deliver === false);
  check('a woken hint is queued', h.hints.filter((x) => x.spec.meta.kind === 'woken').length === 1);
  check('the woken hint rides on piggyback', h.hints[0].opts?.trigger === 'piggyback');

  advance(10); // 同一场聊天，30 分钟内
  addEvent(h, 'clawbridge.message');
  h.world.tick();
  check('more messages in the same burst do not count again', h.world.state.sleep.wokeCount === 1);

  advance(31); // 两次说话之间真的安静了 30 分钟以上
  addEvent(h, 'desktop-pet.message');
  h.world.tick();
  check('a new burst after real silence counts again', h.world.state.sleep.wokeCount === 2);
  check('the source of the last wake-up is recorded', h.world.state.sleep.lastWokeBy === 'desktop-pet.message');

  // 一直聊着，即使距上次「计数」超过 30 分钟也不能再记一次
  advance(5);
  addEvent(h, 'clawbridge.message');
  h.world.tick();
  advance(5);
  addEvent(h, 'clawbridge.message');
  h.world.tick();
  check('a continuous chat never counts twice', h.world.state.sleep.wokeCount === 2);

  advance(60);
  addEvent(h, 'coopanion.alarm', { origin: 'internal' });
  addEvent(h, 'desktop-pet.self');
  h.world.tick();
  check('internal and self events are not wake-ups', h.world.state.sleep.wokeCount === 2);
  await h.world.stop();
}

console.log('the woken hint expires:');
{
  at('2026-11-02T22:05:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00' });
  await boot(h);
  h.world.tick();
  advance(1);
  addEvent(h, 'qq.message');
  h.world.tick();
  const hint = h.hints.find((x) => x.spec.meta.kind === 'woken');
  check('a fresh woken hint renders', typeof hint.spec.render() === 'string');
  check('its text names the source with the alias', String(hint.spec.render()).includes('QQ'));
  advance(2);
  check('the woken hint is dropped after 90 seconds', hint.spec.render() === null);

  const short = harness({ sleepWindow: '22:00-08:00', wakeHintSeconds: 10 });
  await boot(short);
  short.world.tick();
  advance(1);
  addEvent(short, 'qq.message');
  short.world.tick();
  const quick = short.hints.find((x) => x.spec.meta.kind === 'woken');
  check('a custom freshness window applies', typeof quick.spec.render() === 'string');
  advance(1);
  check('and expires after that many seconds', quick.spec.render() === null);
  await short.world.stop();
  await h.world.stop();
}

console.log('wakeHint can be turned off:');
{
  at('2026-11-02T22:05:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00', wakeHint: false });
  await boot(h);
  h.world.tick();
  advance(1);
  addEvent(h, 'qq.message');
  h.world.tick();
  check('the wake-up is still counted', h.world.state.sleep.wokeCount === 1);
  check('no woken hint when wakeHint is off', h.hints.length === 0);
  await h.world.stop();
}

console.log('editable messages file:');
{
  at('2026-11-02T21:50:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00' });
  const file = messagesPath(join(h.dir, 'deployment', 'data'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: 1, zh: { sleep: 'CUSTOM {at} 该睡了' } }), 'utf8');
  await boot(h);
  advance(10);
  h.world.tick();
  check('custom wording is used', String(h.hints[0]?.spec.render()).includes('CUSTOM'));
  await h.world.stop();

  const fresh = harness();
  await boot(fresh);
  check('a default template is created on first run', existsSync(messagesPath(join(fresh.dir, 'deployment', 'data'))));
  await fresh.world.stop();
}

console.log('public status file:');
{
  at('2026-11-02T22:30:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00' });
  await boot(h);
  h.world.tick();
  advance(1);
  addEvent(h, 'clawbridge.message');
  h.world.tick();
  const status = JSON.parse(readFileSync(join(h.dir, 'deployment', 'data', 'rhythm', 'status.json'), 'utf8'));
  check('status says the bot is asleep', status.sleep.active === true);
  check('status reports when the window ends', status.sleep.endsAt === '08:00');
  check('status reports the wake-up count', status.sleep.wokeCount === 1);
  check('status reports who woke it', status.sleep.lastWokeBy === 'clawbridge.message');
  await h.world.stop();
}

// ── 26. 内容感知：默认只给事实 ────────────────────────────────────────────
console.log('context facts by default (no quotes):');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ contextStaleMinutes: 120 });
  await boot(h);
  advance(1);
  h.events.push({
    cursor: 1, type: 'desktop-pet.self', ts: new Date(clock).toISOString(), source: 'desktop-pet', origin: 'external',
    text: '我先去忙一会儿', meta: { kind: 'say', beats: [{ text: '我先去忙一会儿' }] },
  });
  h.world.tick();
  advance(14);
  h.world.tick();
  const text = String(h.pushes[0].spec.render());
  check('the default wake-up mentions the unanswered outreach', text.includes('你前面说过一句'), text);
  check('but it does not quote anything', !text.includes('「'), text);
  check('the wording is channel neutral', !text.includes('气泡'), text);
  await h.world.stop();
}

console.log('quotes only when context may be stale:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ contextStaleMinutes: 10 });
  await boot(h);
  advance(1);
  addEvent(h, 'desktop-pet.message');
  h.events[h.events.length - 1].text = '【害羞】今天好累 <wink>';
  advance(1);
  h.events.push({
    cursor: h.events.length + 1, type: 'desktop-pet.self', ts: new Date(clock).toISOString(),
    source: 'desktop-pet', origin: 'external', text: '【笑】我先去忙了', meta: { kind: 'say', beats: [{ text: '【笑】我先去忙了' }] },
  });
  advance(15);
  h.world.tick();
  const text = String(h.pushes[0].spec.render());
  check('a quote appears after a long quiet stretch', text.includes('最后一句'), text);
  check('the quote keeps the words but strips markers', text.includes('今天好累') && !text.includes('【害羞】') && !text.includes('<wink>'), text);
  check('its own line is quoted too', text.includes('你上次说') && text.includes('我先去忙了'), text);
  await h.world.stop();
}

console.log('a context handoff triggers quotes even when the quiet is short:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ contextStaleMinutes: 120 });
  await boot(h);
  advance(1);
  addEvent(h, 'qq.message');
  h.events[h.events.length - 1].text = '刚才说到哪了';
  h.world.onHandoffEnded();
  advance(15);
  h.world.tick();
  const text = String(h.pushes[0].spec.render());
  check('handoff makes the next nudge quote', text.includes('最后一句') && text.includes('刚才说到哪了'), text);
  await h.world.stop();
}

console.log('speech is captured from the stream for channels without self events:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ repeatMinutes: 10, contextStaleMinutes: 1 });
  await boot(h);
  advance(15);
  h.world.tick();
  const tap = h.world.outputTap();
  tap.onEvent({ type: 'response.output_item.added', item: { type: 'function_call', name: 'clawbridge_send', call_id: 'c1' } });
  tap.onEvent({ type: 'response.function_call_arguments.done', item_id: 'c1', arguments: JSON.stringify({ text: '晚上见' }) });
  advance(10);
  h.world.tick();
  const text = String(h.pushes[1].spec.render());
  check('the stream capture is used for the quote', text.includes('你上次说') && text.includes('晚上见'), text);
  await h.world.stop();
}

console.log('quote sanitising:');
{
  check('markers are stripped', ctxmod.sanitizeQuote('【害羞】你好<wink> sticker:cute') === '你好');
  check('a pure marker quote is dropped', ctxmod.sanitizeQuote('【笑】<wink>') === '');
  const long = '一'.repeat(80);
  const cut = ctxmod.sanitizeQuote(long);
  check('long quotes are truncated', cut.endsWith('…') && [...cut].length <= 41, String([...cut].length));
}

console.log('contextAware off falls back to the plain wake-up:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ contextAware: false });
  await boot(h);
  advance(1);
  h.events.push({
    cursor: 1, type: 'desktop-pet.self', ts: new Date(clock).toISOString(), source: 'desktop-pet', origin: 'external',
    text: '我说了一句', meta: { kind: 'say', beats: [{ text: '我说了一句' }] },
  });
  h.world.tick();
  advance(14);
  h.world.tick();
  const text = String(h.pushes[0].spec.render());
  check('no fact line when contextAware is off', !text.includes('你前面说过一句'), text);
  check('no quotes when contextAware is off', !text.includes('「'), text);
  await h.world.stop();
}

console.log('closing lines rotate:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ repeatMinutes: 5 });
  await boot(h);
  advance(15);
  h.world.tick();
  advance(5);
  h.world.tick();
  advance(5);
  h.world.tick();
  const texts = h.pushes.map((p) => String(p.spec.render()));
  check('three wake-ups share one stable closing', new Set(texts.map((x) => x.split('\n').at(-1))).size === 1, texts.join(' || '));
  check('every closing keeps the tools option', texts.every((x) => x.split('\n').at(-1).includes('工具')), texts.join(' || '));
  check('none of them mentions a specific channel', texts.every((x) => !x.includes('气泡')), texts.join(' || '));
  await h.world.stop();
}

// ── 27. 影子模式：只算不发 ────────────────────────────────────────────────
console.log('dry run:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ dryRun: true });
  await boot(h);
  advance(15);
  h.world.tick();
  check('nothing is delivered in shadow mode', h.pushes.length === 0);
  check('the daily counter does not move', h.world.state.nudgesToday === 0);
  const status = JSON.parse(readFileSync(join(h.dir, 'deployment', 'data', 'rhythm', 'status.json'), 'utf8'));
  check('status marks the shadow mode', status.plan.shadow === true);
  check('status exposes the next planned nudge', typeof status.plan.nextNudgeAt === 'string', JSON.stringify(status.plan));
  check('the lamp says it is in shadow mode', h.world.webUi('zh').lamps[0].hint.includes('影子'));
  advance(14);
  h.world.tick();
  check('shadow mode does not nudge on every tick', h.pushes.length === 0);
  await h.world.stop();
}

// ── 28. 渠道别名与退避的两条例外 ─────────────────────────────────────────
console.log('channel aliases:');
{
  const h = harness();
  await boot(h);
  check('a known prefix maps to a readable name', h.world.channelLabel('clawbridge.message') === '微信');
  check('unknown prefixes fall back to the prefix', h.world.channelLabel('foo.message') === 'foo');
  await h.world.stop();
}

console.log('a reply is not an outreach attempt:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ backoffAfter: 1, repeatMinutes: 10 });
  await boot(h);
  check('a replied turn does not count', (() => {
    h.world.attempt = { at: clock, spoke: true, replied: true, calls: [] };
    h.world.settleAttempt();
    return h.world.state.unanswered === 0;
  })());
  check('an unanswered outreach still counts', (() => {
    h.world.attempt = { at: clock, spoke: true, replied: false, calls: [] };
    h.world.settleAttempt();
    return h.world.state.unanswered === 1;
  })());
  await h.world.stop();
}

console.log('a channel-reported send failure is not counted:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ backoffAfter: 1, repeatMinutes: 10 });
  await boot(h);
  h.world.attempt = { at: clock, spoke: true, replied: false, calls: [] };
  advance(1);
  addEvent(h, 'clawbridge.send-failed');
  h.events[h.events.length - 1].meta = { tool: 'clawbridge_send' };
  h.world.settleAttempt();
  check('a failed send does not count as ignored', h.world.state.unanswered === 0, String(h.world.state.unanswered));
  await h.world.stop();
}

// ── 29. 发送回执核对：失败的那一轮不进退避 ────────────────────────────────
console.log('send receipts from the session record:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ backoffAfter: 1, repeatMinutes: 10 });
  await boot(h);
  const dataDir = join(h.dir, 'deployment', 'data');
  const record = (callId, output) => JSON.stringify({ item: { type: 'function_call_output', call_id: callId, output } });
  writeFileSync(join(dataDir, 'session-main.jsonl'), [
    record('call_ok', '[wx] 送达 09:25 32字'),
    record('call_fail', '[wx] 失败:上下文已过期'),
    record('call_fail2', '[wx] 失败:24 小时窗口已过期'),
  ].join('\n') + '\n', 'utf8');

  h.world.attempt = { at: clock, spoke: true, replied: false, calls: ['call_fail'] };
  h.world.settleAttempt();
  check('a failed receipt does not count', h.world.state.unanswered === 0, String(h.world.state.unanswered));

  h.world.attempt = { at: clock, spoke: true, replied: false, calls: ['call_ok'] };
  h.world.settleAttempt();
  check('a delivered receipt still counts', h.world.state.unanswered === 1, String(h.world.state.unanswered));

  h.world.attempt = { at: clock, spoke: true, replied: false, calls: ['call_missing'] };
  h.world.settleAttempt();
  check('a missing receipt falls back to counting', h.world.state.unanswered === 2, String(h.world.state.unanswered));

  // 微信失败但改用气泡成功：这一轮确实送达了，要算
  h.world.attempt = { at: clock, spoke: true, replied: false, calls: ['call_fail', 'call_ok'] };
  h.world.settleAttempt();
  check('a fallback success still counts', h.world.state.unanswered === 3, String(h.world.state.unanswered));

  // 全部失败：不计
  h.world.attempt = { at: clock, spoke: true, replied: false, calls: ['call_fail', 'call_fail2'] };
  h.world.settleAttempt();
  check('when every receipt failed it does not count', h.world.state.unanswered === 3, String(h.world.state.unanswered));
  await h.world.stop();

  const off = harness({ backoffAfter: 1, verifySpeakReceipts: false });
  await boot(off);
  off.world.attempt = { at: clock, spoke: true, replied: false, calls: ['call_fail'] };
  off.world.settleAttempt();
  check('receipt checking can be turned off', off.world.state.unanswered === 1);
  await off.world.stop();
}

// ── 30. 主人状态探测 ──────────────────────────────────────────────────────
/** 注入探测结果并等「探测 + 叫醒」跑完。 */
const usePresence = (h, presence) => {
  h.world.opts.detectPresence = async () => ({ ...presence, at: clock });
};
const settlePresence = async (h) => {
  const pending = h.world.nudgePromise;
  if (pending) await pending;
};

console.log('presence: locked shows in the prompt:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ awayDetection: true });
  usePresence(h, { locked: true, idleSeconds: 0 });
  await boot(h);
  advance(15);
  h.world.tick();
  await settlePresence(h);
  const text = String(h.pushes[0]?.spec.render());
  check('the locked state reaches the prompt', text.includes('不在电脑前（屏幕锁着）'), text);
  const status = JSON.parse(readFileSync(join(h.dir, 'deployment', 'data', 'rhythm', 'status.json'), 'utf8'));
  check('status.json records the presence', status.presence?.state === 'locked', JSON.stringify(status.presence));
  await h.world.stop();
}

console.log('presence: idle minutes show up:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ awayDetection: true, awayIdleMinutes: 10 });
  usePresence(h, { locked: false, idleSeconds: 1200 });
  await boot(h);
  advance(15);
  h.world.tick();
  await settlePresence(h);
  const text = String(h.pushes[0]?.spec.render());
  check('the idle minutes reach the prompt', text.includes('20 分钟没有输入'), text);
  await h.world.stop();
}

console.log('presence: unknown and opt-outs add nothing:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ awayDetection: true });
  usePresence(h, { locked: null, idleSeconds: null });
  await boot(h);
  advance(15);
  h.world.tick();
  await settlePresence(h);
  const text = String(h.pushes[0]?.spec.render());
  check('an unknown state adds no line', !text.includes('电脑前') && !text.includes('没有输入'), text);
  await h.world.stop();

  at('2026-11-02T09:00:00+08:00');
  const off = harness({ awayDetection: true, awayHint: false });
  usePresence(off, { locked: true, idleSeconds: 0 });
  await boot(off);
  advance(15);
  off.world.tick();
  await settlePresence(off);
  const offText = String(off.pushes[0]?.spec.render());
  check('awayHint off keeps the prompt clean', !offText.includes('电脑前'), offText);
  await off.world.stop();
}

console.log('presence: pauseWhenLocked defers the wake-up:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ awayDetection: true, pauseWhenLocked: true });
  usePresence(h, { locked: true, idleSeconds: 0 });
  await boot(h);
  advance(15);
  h.world.tick();
  await settlePresence(h);
  check('a locked screen skips the wake-up', h.pushes.length === 0);

  usePresence(h, { locked: false, idleSeconds: 0 });
  h.world.presenceCache = null;
  advance(2); // 越过 60 秒的压制
  h.world.tick();
  await settlePresence(h);
  check('after unlocking it wakes up on the next tick', h.pushes.length === 1, String(h.pushes.length));
  await h.world.stop();
}

console.log('presence: disabled means no probe at all:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ awayDetection: false });
  let probes = 0;
  h.world.opts.detectPresence = async () => { probes += 1; return { locked: true, idleSeconds: 0, at: clock }; };
  await boot(h);
  advance(15);
  h.world.tick();
  await settlePresence(h);
  check('no probe when the feature is off', probes === 0);
  check('and the prompt stays plain', !String(h.pushes[0]?.spec.render()).includes('电脑前'));
  await h.world.stop();
}

// ── 31. 探测脚本与模式 ────────────────────────────────────────────────────
console.log('presence script parsing:');
{
  check('lock-only output parses', String(presenceMod.parseProbe('locked=true').locked) === 'true');
  check('lock-only false parses', presenceMod.parseProbe('locked=false').locked === false);
  const full = presenceMod.parseProbe('desktop=Default\nidle_seconds=12.5');
  check('full output gives desktop and idle', full.locked === false && full.idleSeconds === 12.5);
  const winlogon = presenceMod.parseProbe('desktop=Winlogon\nidle_seconds=3');
  check('Winlogon counts as locked', winlogon.locked === true);
  check('no output means unknown', presenceMod.parseProbe('').locked === null);
}

console.log('presence: probe mode follows the setting:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ awayDetection: true });
  let seen = null;
  h.world.opts.detectPresence = async (opts) => { seen = opts; return { locked: false, idleSeconds: null, at: clock }; };
  await boot(h);
  advance(15);
  h.world.tick();
  await settlePresence(h);
  check('lock-only probe by default', seen?.full === false, JSON.stringify(seen));
  await h.world.stop();

  at('2026-11-02T09:00:00+08:00');
  const h2 = harness({ awayDetection: true, awayIdleProbe: true });
  let seen2 = null;
  h2.world.opts.detectPresence = async (opts) => { seen2 = opts; return { locked: false, idleSeconds: 600, at: clock }; };
  await boot(h2);
  advance(15);
  h2.world.tick();
  await settlePresence(h2);
  check('full probe when the setting is on', seen2?.full === true, JSON.stringify(seen2));
  await h2.world.stop();
}

// ── 32. 做梦 ──────────────────────────────────────────────────────────────
console.log('dream: one nightly plan, the bot is asked to write the diary:');
{
  at('2026-11-02T21:50:00+08:00');
  const h = harness({
    sleepWindow: '22:00-08:00',
    dreamEnabled: true,
    dreamChance: 1,
    dreamAfterMinutes: 60,
    dreamMaxPerNight: 1,
  });
  // 三颗骰子：做不做 / 几点 / 类型
  const seq = [0.5, 0.5, 0];
  let n = 0;
  h.world.opts.random = () => seq[Math.min(n++, seq.length - 1)];
  h.world.opts.ownerName = () => '主人';
  await boot(h);
  advance(10); // 22:00 入夜
  h.world.tick();
  const plan = h.world.state.sleep.dreamPlan;
  check('a dream plan is rolled at bedtime', plan !== null, JSON.stringify(plan));
  check('the plan lands inside the window', plan !== null && new Date(plan.at).getHours() === 3, plan ? new Date(plan.at).toISOString() : '');

  advance(300); // 03:00
  h.world.tick();
  const dreamHint = h.hints.find((x) => x.spec.meta.kind === 'dream');
  const dreamText = String(dreamHint?.spec.render());
  check('the dream hint is sent', Boolean(dreamHint));
  check('it carries a dream type', dreamText.includes('【天马行空的】'), dreamText);
  check('it points at the diary path', dreamText.includes('partner/dreams.md'), dreamText);
  check('recording is mandatory and appended', dreamText.includes('必做') && dreamText.includes('追加写入'), dreamText);
  check('it asks for a themed dream fragment', dreamText.includes('梦境片段') && dreamText.includes('不要笼统写'), dreamText);
  check('the heading carries the full date', /## 2026-11-03 周[一二三四五六日] 03:00/.test(dreamText), dreamText);
  check('no tool name is hardcoded', !dreamText.includes('pet_act'), dreamText);
  check('the plan is consumed', h.world.state.sleep.dreamPlan === null);
  check('the dream record exists without captured text', h.world.state.sleep.dreams.length === 1 && h.world.state.sleep.dreams[0].text === '');

  at('2026-11-03T08:00:00+08:00');
  h.world.tick();
  const wake = h.hints.filter((x) => x.spec.meta.kind === 'wake').at(-1);
  const wakeText = String(wake?.spec.render());
  check('the morning hint mentions the dream', wakeText.includes('你昨晚做了一个【天马行空的】的梦'), wakeText);
  check('and points at the diary', wakeText.includes('记在 partner/dreams.md 里'), wakeText);
  check('but sharing stays the bot decision', wakeText.includes('要不要跟主人提，由你决定'), wakeText);
  await h.world.stop();
}

console.log('dream: off, no plan; disturbed, cancelled:');
{
  at('2026-11-02T21:50:00+08:00');
  const off = harness({ sleepWindow: '22:00-08:00', dreamEnabled: false });
  await boot(off);
  advance(10);
  off.world.tick();
  check('no plan when dreaming is off', off.world.state.sleep.dreamPlan === null);
  await off.world.stop();

  at('2026-11-02T21:50:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00', dreamEnabled: true, dreamChance: 1, dreamAfterMinutes: 60 });
  let m = 0;
  const seq = [0.1, 0.5, 0];
  h.world.opts.random = () => seq[Math.min(m++, seq.length - 1)];
  await boot(h);
  advance(10);
  h.world.tick();
  check('a plan exists before the interruption', h.world.state.sleep.dreamPlan !== null);
  advance(1);
  addEvent(h, 'clawbridge.message');
  h.world.tick();
  check('being woken cancels the dream', h.world.state.sleep.dreamPlan === null);
  await h.world.stop();
}

console.log('dream: an older messages.json gets the new keys:');
{
  const h = harness();
  const file = messagesPath(join(h.dir, 'deployment', 'data'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: 1, zh: { sleep: 'OLD SLEEP' }, en: {} }), 'utf8');
  await boot(h);
  const migrated = JSON.parse(readFileSync(file, 'utf8'));
  check('the old value is kept', migrated.zh.sleep === 'OLD SLEEP', JSON.stringify(migrated.zh));
  check('the dream template is added', typeof migrated.zh.dream === 'string' && migrated.zh.dream.includes('梦'), JSON.stringify(migrated.zh));
  check('the dream types are added', Array.isArray(migrated.zh.dreamTypes) && migrated.zh.dreamTypes.length > 0);
  await h.world.stop();
}

console.log('a fact line survives the away line:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ awayDetection: true, willingnessEnabled: true });
  usePresence(h, { locked: true, idleSeconds: 0 });
  await boot(h);
  advance(1);
  // 先让它说一句，制造一个「没被接」的事实
  h.world.attempt = { at: clock, spoke: true, replied: false, calls: [] };
  h.world.settleAttempt();
  advance(14);
  h.world.tick();
  await settlePresence(h);
  const text = String(h.pushes[0]?.spec.render());
  check('the away line is there', text.includes('不在电脑前'), text);
  check('and the willingness line is not swallowed', text.includes('上次你主动搭话'), text);
  await h.world.stop();
}

// ── 33. 模板与事实行 ──────────────────────────────────────────────────────
console.log('facts are AND, and dates survive midnight:');
{
  const { nudgeText } = await import('../src/model-text.ts');
  const text = nudgeText('zh', {
    at: '11-03 周一 00:30',
    quietMinutes: 40,
    again: false,
    round: 1,
    unanswered: true,
    away: { kind: 'locked' },
    quoteUser: { at: '11-02 23:50', text: '我先睡了' },
    quoteSelf: null,
  });
  check('the away fact is present', text.includes('不在电脑前'), text);
  check('the unanswered fact is present too', text.includes('你前面说过一句'), text);
  check('the user quote is present', text.includes('最后一句') && text.includes('11-02 23:50'), text);
  check('the closing keeps every option', text.includes('工具'), text);

  const withSelf = nudgeText('zh', {
    at: '11-03 00:30', quietMinutes: 40, again: false, round: 1, unanswered: true,
    quoteSelf: { at: '23:50', text: '晚安', answered: false },
  });
  check('a self quote carries the unanswered note itself', withSelf.includes('还没人接话'), withSelf);
  check('and the separate fact line is not duplicated', !withSelf.includes('你前面说过一句'), withSelf);
}

console.log('the opening carries the date:');
{
  at('2026-11-02T21:50:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00' });
  await boot(h);
  advance(10);
  h.world.tick();
  const hint = String(h.hints[0]?.spec.render());
  check('hints show the month and day', /11-02/.test(hint), hint);
  check('and the time', hint.includes('22:00'), hint);
  await h.world.stop();
}

// ── 34. 搭话意愿（P7） ────────────────────────────────────────────────────
console.log('willingness: 1.5x growth, absolute cap:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ repeatMinutes: 45, willingnessEnabled: true, willingnessMaxMinutes: 480 });
  await boot(h);
  advance(15);
  h.world.tick();
  check('the first nudge fires', h.pushes.length === 1);
  h.world.state.unanswered = 6;
  advance(479);
  h.world.tick();
  check('no nudge before the absolute cap', h.pushes.length === 1);
  advance(1);
  h.world.tick();
  check('the cap lands at 480 minutes', h.pushes.length === 2, String(h.pushes.length));
  await h.world.stop();
}

console.log('willingness: conversation zeroes, touch halves, throwing does not:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness();
  await boot(h);
  h.world.state.unanswered = 4;
  advance(1);
  addEvent(h, 'desktop-pet.touch', { meta: { touch: { kind: 'pet' } } });
  h.world.tick();
  check('petting halves the count', h.world.state.unanswered === 2, String(h.world.state.unanswered));
  h.world.state.unanswered = 4;
  advance(1);
  addEvent(h, 'desktop-pet.touch', { meta: { touch: { kind: 'throw' } } });
  h.world.tick();
  check('throwing does not change it', h.world.state.unanswered === 4, String(h.world.state.unanswered));
  h.world.state.unanswered = 4;
  advance(1);
  addEvent(h, 'qq.message');
  h.world.tick();
  check('a conversation clears it', h.world.state.unanswered === 0, String(h.world.state.unanswered));
  await h.world.stop();
}

console.log('willingness: a night halves it (never below 1):');
{
  at('2026-11-02T21:50:00+08:00');
  const h = harness({ sleepWindow: '22:00-08:00' });
  await boot(h);
  advance(10);
  h.world.tick();
  h.world.state.unanswered = 6;
  at('2026-11-03T08:00:00+08:00');
  h.world.tick();
  check('six becomes three after waking', h.world.state.unanswered === 3, String(h.world.state.unanswered));
  await h.world.stop();
}

console.log('willingness: four emotional levels with the owner name:');
{
  const expected = ['上次你主动搭话，主人没有回复。', '你有点担心主人', '你有点寂寞', '你有些失落'];
  for (let level = 1; level <= 4; level += 1) {
    at('2026-11-02T09:00:00+08:00');
    const h = harness({ repeatMinutes: 10, willingnessEnabled: true });
    h.world.opts.ownerName = () => '主人';
    await boot(h);
    advance(15);
    h.world.tick();
    h.world.state.unanswered = level;
    h.world.lastNudgeAt = clock - 120 * 60 * 1000;
    h.world.rounds = 1;
    h.world.tick();
    const text = String(h.pushes[1]?.spec.render());
    check(`level ${level} carries its line`, text.includes(expected[level - 1]), text);
    await h.world.stop();
  }
}

console.log('willingness: the status file exposes it:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ willingnessEnabled: true });
  await boot(h);
  h.world.state.unanswered = 2;
  h.world.persist();
  const status = JSON.parse(readFileSync(join(h.dir, 'deployment', 'data', 'rhythm', 'status.json'), 'utf8'));
  check('status has willingness', status.willingness?.unanswered === 2, JSON.stringify(status.willingness));
  check('status has the factor', status.willingness?.factor === 2.25, JSON.stringify(status.willingness));
  await h.world.stop();
}

console.log('settlement happens at turn end, so the stretch is immediate:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ repeatMinutes: 10, willingnessEnabled: true });
  await boot(h);
  advance(15);
  h.world.tick();
  check('the first nudge fires', h.pushes.length === 1);
  tapTool(h, 'pet_say');
  h.world.onTurnEnded();
  check('the ignored outreach is counted at once', h.world.state.unanswered === 1, String(h.world.state.unanswered));
  advance(14);
  h.world.tick();
  check('no nudge before the stretched gap', h.pushes.length === 1);
  advance(1);
  h.world.tick();
  check('the next nudge comes at 1.5x', h.pushes.length === 2, String(h.pushes.length));
  await h.world.stop();
}

console.log('status says capped instead of showing a phantom time:');
{
  at('2026-11-02T09:00:00+08:00');
  const h = harness({ maxRounds: 3, willingnessEnabled: true });
  await boot(h);
  h.world.rounds = 3;
  h.world.persist();
  const status = JSON.parse(readFileSync(join(h.dir, 'deployment', 'data', 'rhythm', 'status.json'), 'utf8'));
  check('plan.capped is true', status.plan?.capped === true, JSON.stringify(status.plan));
  check('no phantom nextNudgeAt', status.plan?.nextNudgeAt === null, JSON.stringify(status.plan));
  check('willingness countdown is null too', status.willingness?.nextNudgeInMinutes === null, JSON.stringify(status.willingness));
  await h.world.stop();
}

console.log('diagnostics: off by default; on writes a shareable bundle:');
{
  at('2026-11-02T09:00:00+08:00');
  const off = harness();
  await boot(off);
  advance(15);
  off.world.tick();
  check('no diagnostics file when off', !existsSync(join(off.dir, 'deployment', 'data', 'rhythm', 'diagnostics.json')));
  check('no debug log when off', !existsSync(join(off.dir, 'deployment', 'data', 'rhythm', 'debug.log')));
  await off.world.stop();

  at('2026-11-02T09:00:00+08:00');
  const h = harness({ debug: true });
  await boot(h);
  advance(15);
  h.world.tick();
  const diagFile = join(h.dir, 'deployment', 'data', 'rhythm', 'diagnostics.json');
  check('the diagnostics file is written', existsSync(diagFile));
  const diag = existsSync(diagFile) ? JSON.parse(readFileSync(diagFile, 'utf8')) : {};
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  check('it carries the plugin version', diag.version === pkg.version, String(diag.version));
  check('it carries the config snapshot', diag.config?.debug === true && diag.config?.quietMinutes === 15, JSON.stringify(diag.config));
  check('it carries runtime and state', typeof diag.runtime?.rounds === 'number' && typeof diag.state?.unanswered === 'number', JSON.stringify(diag.runtime));
  check('it carries a decision log', Array.isArray(diag.log) && diag.log.length > 0, JSON.stringify(diag.log?.slice(-3)));
  const debugFile = join(h.dir, 'deployment', 'data', 'rhythm', 'debug.log');
  check('the debug log exists', existsSync(debugFile));
  const debugText = existsSync(debugFile) ? readFileSync(debugFile, 'utf8') : '';
  check('the debug log has decisions', debugText.includes('叫醒'), debugText);
  const status = JSON.parse(readFileSync(join(h.dir, 'deployment', 'data', 'rhythm', 'status.json'), 'utf8'));
  check('status exposes the version', status.version === pkg.version, String(status.version));
  check('status exposes debug', status.debug === true);
  await h.world.stop();
}

Date.now = realNow;
console.log(failures.length === 0 ? 'PASS' : `FAILED (${failures.length})`);
process.exitCode = failures.length === 0 ? 0 : 1;
