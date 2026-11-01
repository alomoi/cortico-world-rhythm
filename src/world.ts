/**
 * 作息 World：一段时间没人跟 Coo 说话，就把它叫醒一次，让它自己决定开不开口、
 * 先用哪个工具、还是什么都不说（end_turn）。叫醒靠一条 internal 事件投递，正文由
 * model-text.ts 按模型文本语言给；事件以 flush 投递，空闲的主循环收到即开始一轮。
 *
 * 「安静」的判定（P0 起是渠道无关的）：事件库里最近一条「人侧事件」的时刻。
 * 人侧事件 = `origin === 'external'` 且不是 Coo 自己的自录（`*.self`，例如
 * `desktop-pet.self`）——它们同样是 external，只是 `deliver: false`，不算有人回来。
 * 微信、QQ、B 站等任何扩展推的 external 事件都自动生效，不需要逐个登记类型；
 * 确有周期性系统事件需要排除时，用 `activityIgnore` 配置（支持 `前缀*`）。
 * 想退回旧行为（只认桌宠与控制台）就打开 `knownChannelsOnly`。
 *
 * 作息时段（P1）：`sleepWindow` 与 `restWindows` 里不主动叫醒。离开时段时安静计时从
 * 离开那一刻重新开始，不会在睡醒的整点立刻跳出来。排队期间跨进时段同样作废。
 *
 * 节制（P1）：`dailyCap` 是每日硬上限；`backoffAfter` / `backoffFactor` /
 * `backoffMaxFactor` 让「一直没人理」时的再次叫醒越来越稀（人一说话就恢复）。
 * 这两个机制都只影响「自己的叫醒」，不碰桌宠的任何其他行为。
 *
 * 主循环状态：`onRunPhase` 只记录 phase，不做事；`onlyWhenIdle` 打开时，模型或工具
 * 还在跑就先不叫醒（`flush` 本身不会打断在跑的回合，盲目叫醒只会让事件排队迟到）。
 *
 * 时间参数都在 worlds.rhythm 里（config.ts），每个检查周期现读，WebUI 改完立即生效。
 * 每个间隔（第一次叫醒与每次再次叫醒）各自乘以一次随机倍数（jitter），让节奏不机械。
 * 叫醒事件在投递时才渲染（pushDeferred）：如果排队期间使用者回来了，这一条作废。
 */
import type { EventEnvelope, RunPhase, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import { shortTime } from 'cortico/core/util.ts';
import { rhythmConfigGroup, RHYTHM_ID, type RhythmConfigSection } from './config.ts';
import { NUDGE_TEXT, type ModelLanguage } from './model-text.ts';
import { loadState, localDayKey, saveState, stateFilePath, type RhythmState } from './state.ts';
import { uiText, type LampInfo } from './ui-text.ts';
import { formatClock, matchWindow, minutesOfDay, parseWindowList, type ClockWindow } from './windows.ts';

/** 叫醒事件的类型。 */
export const NUDGE_TYPE = 'rhythm.nudge';

/** 检查周期：配置以分钟计，5 秒的粒度足够，也几乎不花什么。 */
const CHECK_EVERY_MS = 5_000;

/** 最近 events 窗口里找使用者的动作；够覆盖一段对话，读起来便宜。 */
const SCAN_LIMIT = 500;

/** Coo 自己的自录事件都以 `.self` 结尾（desktop-pet.self / console.self），不算有人回来。 */
const SELF_SUFFIX = '.self';

/**
 * 旧白名单：`knownChannelsOnly` 打开时只认这些。
 * 只在内置两个对话渠道里成立，装了别的渠道时这就是上游的那个 bug。
 */
const ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'desktop-pet.message',
  'desktop-pet.speech',
  'desktop-pet.answer',
  'desktop-pet.touch',
  'desktop-pet.figure',
  'console.message',
  'console.invite',
]);

/** 读 config 的数值并夹到安全范围；字段缺失（手改坏了 config.json）时用兜底值。 */
function numberIn(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

export interface RhythmOptions {
  /** 组装层给的活引用：`worlds.rhythm`。 */
  cfg: RhythmConfigSection;
  /** 部署时区，叫醒行里的时刻、时段与「今天」都按它算。 */
  timezone: string;
  /** 部署数据目录；状态文件放它的 `rhythm/state.json`。 */
  dataDir: string;
  /** 模型文本语言；每条事件渲染时现取。 */
  language: () => ModelLanguage;
}

interface Limits {
  quietMinutes: number;
  repeatMinutes: number;
  maxRounds: number;
  jitter: number;
  dailyCap: number;
  backoffAfter: number;
  backoffFactor: number;
  backoffMaxFactor: number;
  skipChance: number;
  knownChannelsOnly: boolean;
  onlyWhenIdle: boolean;
}

export class RhythmWorld implements World {
  readonly id = RHYTHM_ID;

  private host: WorldHost | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 已看见的最近一次人侧动作（epoch ms）。 */
  private lastActivitySeen = 0;
  /** 这一段安静里已叫醒几次。 */
  private rounds = 0;
  /** 上一次叫醒的时刻；repeatMinutes 从它起算。 */
  private lastNudgeAt = 0;
  /** 下一个间隔的随机倍数（1–1+jitter）。 */
  private jitterFactor = 1;
  /** 主循环此刻的状态；只由 onRunPhase 写。初值按 Core 构造时的 idle。 */
  private phaseState: RunPhase['state'] = 'idle';
  /** 落盘的运行时状态（今日次数、上次结果等）。 */
  private state: RhythmState;
  /** 时段缓存的原始字符串；配置热改时重解析。 */
  private windowsKey = '';
  private sleepWindows: ClockWindow[] = [];
  private restWindows: ClockWindow[] = [];
  /** 上一拍是否在睡眠/休息时段里；用来发现「刚睡醒」。 */
  private lastWindow: 'sleep' | 'rest' | null = null;
  /** 概率跳过时压制到这一刻（epoch ms）。 */
  private suppressedUntil = 0;

  constructor(private readonly opts: RhythmOptions) {
    this.state = {
      version: 1,
      dayKey: localDayKey(opts.timezone, Date.now()),
      nudgesToday: 0,
      rounds: 0,
      lastNudgeAt: null,
      lastOutcome: null,
      lastOutcomeAt: null,
    };
  }

  /** 不加环境段：机制只通过叫醒事件本身说明，不占每次请求的前缀。 */
  envPromptVars(): null {
    return null;
  }

  /** 控制台「模块」页的名片：名字、状态灯、徽标与配置组。 */
  webUi(language?: Language): WorldWebUiDecl {
    const t = uiText(language);
    const limits = this.limits();
    this.refreshWindows();
    return {
      label: t.label,
      lamps: [{
        label: t.lampLabel,
        state: 'online',
        hint: limits.quietMinutes > 0 ? t.lampHint(this.lampInfo(limits, Date.now())) : t.lampOff,
      }],
      badges: [{ label: t.badgeToday, value: this.state.nudgesToday, tone: this.state.nudgesToday > 0 ? 'on' : 'plain' }],
      config: [rhythmConfigGroup(language ?? 'zh')],
    };
  }

  /** 没有自己的工具：叫醒后用什么工具，是 Coo 和别的 World 的事。 */
  tools(): [] {
    return [];
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    const now = Date.now();
    const dayKey = localDayKey(this.opts.timezone, now);
    const { state, error } = loadState(stateFilePath(this.opts.dataDir), dayKey);
    this.state = state;
    if (error) host.log.warn('作息:状态文件读不出来，按新的一天开始', { error });

    // 最近一次人侧活动从事件库重算（不落盘，避免和事件库打架）。
    this.lastActivitySeen = 0;
    const latest = this.latestPersonActivity();
    const limits = this.limits();
    const quietMs = Math.max(limits.quietMinutes, 1) * 60_000;
    const repeatMs = Math.max(limits.repeatMinutes, 1) * 60_000;
    const savedNudgeAt = state.lastNudgeAt ? Date.parse(state.lastNudgeAt) : 0;
    // 同一段安静还在延续：上次叫醒之后没人说话，且没隔太久。
    // 满足才接上轮次，否则就当重新开始，避免开机就补叫一轮。
    const spokeSinceNudge = latest.at > savedNudgeAt;
    const stretchAlive = savedNudgeAt > 0 && !spokeSinceNudge && now - savedNudgeAt <= repeatMs * 2;
    if (stretchAlive) {
      this.lastActivitySeen = latest.at > 0 ? latest.at : now;
      this.lastNudgeAt = savedNudgeAt;
      this.rounds = state.rounds;
    } else {
      this.rounds = 0;
      this.lastNudgeAt = 0;
      // 停机不久、还在安静窗口里：接着算；否则从此刻重新安静。
      this.lastActivitySeen = latest.at > 0 && now - latest.at <= quietMs ? latest.at : now;
    }
    this.refreshWindows();
    this.lastWindow = this.currentWindow(now)?.kind ?? null;
    host.log.info('作息:启动', {
      quietMinutes: limits.quietMinutes,
      maxRounds: limits.maxRounds,
      dailyCap: limits.dailyCap,
      sleepWindow: String(this.opts.cfg.sleepWindow ?? ''),
      restWindows: String(this.opts.cfg.restWindows ?? ''),
      nudgesToday: state.nudgesToday,
      rounds: this.rounds,
      stretchAlive,
      inWindow: this.lastWindow,
      lastNudgeAt: this.lastNudgeAt > 0 ? new Date(this.lastNudgeAt).toISOString() : null,
      quietSince: new Date(this.lastActivitySeen).toISOString(),
    });

    this.rollJitter();
    this.timer = setInterval(() => this.tick(), CHECK_EVERY_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.persist();
    this.host = null;
  }

  /** 主循环的阶段变化：只记录，不做耗时的事（这个钩子在主循环调用栈上）。 */
  onRunPhase(phase: RunPhase): void {
    this.phaseState = phase.state;
  }

  /** 自己那条叫醒事件的归宿：记下投递结果，被丢弃时把今日计数退回去。 */
  onEventsSettled(events: readonly EventEnvelope[], outcome: 'delivered' | 'discarded'): void {
    const mine = events.filter((event) => event.type === NUDGE_TYPE);
    if (!mine.length) return;
    this.state.lastOutcome = outcome;
    this.state.lastOutcomeAt = new Date().toISOString();
    if (outcome === 'discarded') this.state.nudgesToday = Math.max(0, this.state.nudgesToday - 1);
    this.host?.log.info('作息:叫醒结果', { outcome, count: mine.length, nudgesToday: this.state.nudgesToday });
    this.persist();
  }

  private limits(): Limits {
    const cfg = this.opts.cfg;
    return {
      quietMinutes: numberIn(cfg.quietMinutes, 15, 0, 720),
      repeatMinutes: numberIn(cfg.repeatMinutes, 25, 1, 720),
      // 0 表示不限；正数即上限，没有额外的数字上限
      maxRounds: Math.max(0, Math.floor(numberIn(cfg.maxRounds, 0, 0, Number.MAX_SAFE_INTEGER))),
      jitter: numberIn(cfg.jitter, 0.2, 0, 0.5),
      dailyCap: Math.floor(numberIn(cfg.dailyCap, 12, 0, 1000)),
      backoffAfter: Math.floor(numberIn(cfg.backoffAfter, 0, 0, 50)),
      backoffFactor: numberIn(cfg.backoffFactor, 1.5, 1, 3),
      backoffMaxFactor: numberIn(cfg.backoffMaxFactor, 4, 1, 10),
      skipChance: numberIn(cfg.skipChance, 0, 0, 1),
      knownChannelsOnly: cfg.knownChannelsOnly === true,
      onlyWhenIdle: cfg.onlyWhenIdle !== false,
    };
  }

  /** 配置热改后重新解析时段；只在一处报错，避免每 5 秒刷一条日志。 */
  private refreshWindows(): void {
    const sleepRaw = String(this.opts.cfg.sleepWindow ?? '');
    const restRaw = String(this.opts.cfg.restWindows ?? '');
    const key = `${sleepRaw}\u0000${restRaw}`;
    if (key === this.windowsKey) return;
    this.windowsKey = key;
    const sleep = parseWindowList(sleepRaw);
    const rest = parseWindowList(restRaw);
    this.sleepWindows = sleep.windows;
    this.restWindows = rest.windows;
    if (sleep.errors.length || rest.errors.length) {
      this.host?.log.warn('作息:时段设置有问题，已忽略这几段', { errors: [...sleep.errors, ...rest.errors] });
    }
  }

  /** 当前是否处在不叫醒的时段。 */
  private currentWindow(nowMs: number): { kind: 'sleep' | 'rest'; window: ClockWindow } | null {
    const minute = minutesOfDay(nowMs, this.opts.timezone);
    const sleep = matchWindow(minute, this.sleepWindows);
    if (sleep) return { kind: 'sleep', window: sleep };
    const rest = matchWindow(minute, this.restWindows);
    if (rest) return { kind: 'rest', window: rest };
    return null;
  }

  /** 退避倍数：连续没人理之后越大，封顶 backoffMaxFactor。 */
  private backoffMultiplier(limits: Limits): number {
    if (limits.backoffAfter <= 0) return 1;
    const extra = this.rounds - limits.backoffAfter;
    if (extra <= 0) return 1;
    return Math.min(limits.backoffMaxFactor, Math.pow(limits.backoffFactor, extra));
  }

  /** 为下一个间隔掷一次随机倍数（1–1+jitter），第一次叫醒与每次再次叫醒之前各掷一次。 */
  private rollJitter(): void {
    this.jitterFactor = 1 + Math.random() * this.limits().jitter;
  }

  /** 下一次叫醒的时刻；配置关掉时返回 null。 */
  private dueAt(limits: Limits): number | null {
    if (limits.quietMinutes <= 0) return null;
    if (this.rounds === 0) {
      return this.lastActivitySeen + limits.quietMinutes * 60_000 * this.jitterFactor;
    }
    return this.lastNudgeAt + limits.repeatMinutes * 60_000 * this.backoffMultiplier(limits) * this.jitterFactor;
  }

  /** 当前一拍的基础间隔（分钟），概率跳过时按它顺延。 */
  private intervalMinutes(limits: Limits): number {
    if (this.rounds === 0) return limits.quietMinutes;
    return limits.repeatMinutes * this.backoffMultiplier(limits);
  }

  private minutesUntilDue(limits: Limits): number | null {
    const due = this.dueAt(limits);
    if (due === null) return null;
    return Math.max(0, Math.ceil((due - Date.now()) / 60_000));
  }

  private lampInfo(limits: Limits, now: number): LampInfo {
    const windowNow = this.currentWindow(now);
    const capReached = limits.dailyCap > 0 && this.state.nudgesToday >= limits.dailyCap;
    const capped = limits.maxRounds > 0 && this.rounds >= limits.maxRounds;
    return {
      quietMinutes: limits.quietMinutes,
      maxRounds: limits.maxRounds,
      nudgesToday: this.state.nudgesToday,
      nextInMinutes: !windowNow && !capReached && !capped ? this.minutesUntilDue(limits) : null,
      capped,
      dailyCap: limits.dailyCap,
      capReached,
      windowKind: windowNow?.kind ?? null,
      windowEndsAt: windowNow ? formatClock(windowNow.window.end) : null,
    };
  }

  /** `activityIgnore` 是否命中：精确匹配，或以 * 结尾的前缀匹配。 */
  private isIgnored(type: string): boolean {
    const raw = this.opts.cfg.activityIgnore;
    if (typeof raw !== 'string' || raw.trim() === '') return false;
    for (const entry of raw.split(',')) {
      const pattern = entry.trim();
      if (!pattern) continue;
      if (pattern.endsWith('*') ? type.startsWith(pattern.slice(0, -1)) : type === pattern) return true;
    }
    return false;
  }

  /**
   * 一条事件是不是「有人回来了」。
   * 自录事件（`*.self`）是 external，但那是 Coo 自己说的话，会把叫醒本身当成活动，必须排除。
   */
  private isPersonActivity(event: EventEnvelope): boolean {
    if (event.origin !== 'external') return false;
    if (event.type === NUDGE_TYPE) return false;
    if (event.type.endsWith(SELF_SUFFIX)) return false;
    if (this.isIgnored(event.type)) return false;
    return this.limits().knownChannelsOnly ? ACTIVITY_TYPES.has(event.type) : true;
  }

  /** 最近一条人侧动作的时刻与类型；上限是已知时刻。 */
  private latestPersonActivity(): { at: number; type: string } {
    const host = this.host;
    if (!host) return { at: this.lastActivitySeen, type: '' };
    let at = this.lastActivitySeen;
    let type = '';
    try {
      for (const event of host.store.range({ limit: SCAN_LIMIT, origin: 'external' })) {
        if (!this.isPersonActivity(event)) continue;
        const when = Date.parse(event.ts);
        if (Number.isFinite(when) && when > at) {
          at = when;
          type = event.type;
        }
      }
    } catch {
      // 事件库读不出（还在重建）：这一拍按没有新活动处理
    }
    return { at, type };
  }

  private tick(): void {
    const host = this.host;
    if (!host) return;
    const now = Date.now();
    this.rollDay(now);

    const limits = this.limits();
    if (limits.quietMinutes <= 0) return;

    this.refreshWindows();

    // 睡眠/休息时段：不主动叫醒，也不推进安静计时（醒来后从那一刻重新算）。
    const windowNow = this.currentWindow(now);
    if (windowNow) {
      if (this.lastWindow !== windowNow.kind) {
        this.lastWindow = windowNow.kind;
        host.log.info(windowNow.kind === 'sleep' ? '作息:进入睡眠时段' : '作息:进入休息时段', {
          until: formatClock(windowNow.window.end),
        });
      }
      return;
    }
    if (this.lastWindow) {
      // 刚离开时段：安静与轮次都从头开始，避免睡醒整点立刻跳出来。
      this.lastWindow = null;
      this.lastActivitySeen = now;
      this.rounds = 0;
      this.lastNudgeAt = 0;
      this.suppressedUntil = 0;
      this.rollJitter();
      host.log.info('作息:休息结束，安静计时重新开始', {
        quietMinutes: limits.quietMinutes,
        nudgesToday: this.state.nudgesToday,
      });
    }

    const latest = this.latestPersonActivity();
    if (latest.at > this.lastActivitySeen) {
      const hadRounds = this.rounds > 0;
      this.lastActivitySeen = latest.at;
      this.rounds = 0;
      this.suppressedUntil = 0;
      this.rollJitter();
      host.log.debug('作息:有人回来了，安静计时重新开始', {
        type: latest.type,
        idleMinutes: Math.round((now - latest.at) / 60_000),
      });
      if (hadRounds) this.persist();
    }

    // 它正在跑模型或工具：等这一轮结束再看，别把叫醒塞进人家手上的活里。
    if (limits.onlyWhenIdle && this.phaseState !== 'idle') return;

    // 每日上限：今天叫够了就不再叫，明天 rollDay 会清零。
    if (limits.dailyCap > 0 && this.state.nudgesToday >= limits.dailyCap) return;

    // maxRounds 为 0 表示不限：一段安静里可以一直叫醒，直到有人说话
    if (limits.maxRounds > 0 && this.rounds >= limits.maxRounds) return;

    if (this.suppressedUntil > now) return;

    const due = this.dueAt(limits);
    if (due === null || now < due) return;

    if (limits.skipChance > 0 && Math.random() < limits.skipChance) {
      this.suppressedUntil = now + this.intervalMinutes(limits) * 60_000;
      host.log.debug('作息:这一次按概率跳过了', { skipChance: limits.skipChance, rounds: this.rounds });
      return;
    }
    this.nudge(now, latest);
  }

  /** 跨天清零「今日叫醒」；不重置本轮轮次（一段安静可以跨午夜）。 */
  private rollDay(now: number): void {
    const key = localDayKey(this.opts.timezone, now);
    if (key === this.state.dayKey) return;
    this.state.dayKey = key;
    this.state.nudgesToday = 0;
    this.host?.log.info('作息:新的一天，今日叫醒计数清零', { day: key });
    this.persist();
  }

  private nudge(now: number, latest: { at: number; type: string }): void {
    const host = this.host;
    if (!host) return;
    const limits = this.limits();
    const again = this.rounds > 0;
    this.rounds += 1;
    this.lastNudgeAt = now;
    this.state.nudgesToday += 1;
    this.suppressedUntil = 0;
    // 下一次「再次叫醒」间隔的随机倍数现在掷
    this.rollJitter();
    const quietMinutes = Math.max(1, Math.round((now - this.lastActivitySeen) / 60_000));
    host.log.info('作息:叫醒 Coo', {
      round: this.rounds,
      again,
      quietMinutes,
      nudgesToday: this.state.nudgesToday,
      dailyCap: limits.dailyCap,
      maxRounds: limits.maxRounds,
      backoff: this.backoffMultiplier(limits),
      phase: this.phaseState,
      lastActivityType: latest.type,
    });
    host.pushDeferred({
      type: NUDGE_TYPE,
      origin: 'internal',
      senderKey: NUDGE_TYPE,
      render: () => {
        const queued = this.queuedNudgeCancelled();
        if (queued) return null;
        const elapsed = Math.max(1, Math.round((Date.now() - this.lastActivitySeen) / 60_000));
        const language = this.opts.language();
        return NUDGE_TEXT[language]({ at: shortTime(this.opts.timezone), quietMinutes: elapsed, again });
      },
    }, { trigger: 'flush' });
    this.persist();
  }

  /**
   * 排队期间这一条是不是该作废：人回来了，或者已经进入睡眠/休息时段。
   * 作废时把预记的次数与轮次退回去，免得「没叫醒」也算进今日次数。
   */
  private queuedNudgeCancelled(): boolean {
    const windowNow = this.currentWindow(Date.now());
    const cancelled = windowNow !== null || this.latestPersonActivity().at > this.lastNudgeAt;
    if (!cancelled) return false;
    this.rounds = Math.max(0, this.rounds - 1);
    this.state.nudgesToday = Math.max(0, this.state.nudgesToday - 1);
    this.persist();
    this.host?.log.debug('作息:排队的叫醒已作废', {
      reason: windowNow ? windowNow.kind : 'person-back',
      round: this.rounds,
      nudgesToday: this.state.nudgesToday,
    });
    return true;
  }

  /** 落盘：只写事件库读不出来的那些事实。 */
  private persist(): void {
    if (!this.opts.dataDir) return;
    const { error } = saveState(stateFilePath(this.opts.dataDir), {
      version: 1,
      dayKey: this.state.dayKey,
      nudgesToday: this.state.nudgesToday,
      rounds: this.rounds,
      lastNudgeAt: this.lastNudgeAt > 0 ? new Date(this.lastNudgeAt).toISOString() : null,
      lastOutcome: this.state.lastOutcome,
      lastOutcomeAt: this.state.lastOutcomeAt,
    });
    if (error) this.host?.log.warn('作息:状态写不进去', { error });
  }
}
