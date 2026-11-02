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
 * 睡眠表现（P2，全部是「建议」而非命令）：
 * - 进睡眠时段发一句「该睡了」、出睡眠时段发一句「该醒了」（`sleepHint`，文案可改）；
 * - 睡眠时段内有人来找 Coo 时，按 `wakeGapMinutes` 合并计一次「被吵醒」，
 *   留一条归档事件 `rhythm.woke`，并在 `wakeHint` 打开时投一条 piggyback 提示
 *   （只搭着这一轮走，超过 90 秒就作废，不会事后突然冒出起床气）。
 * - 同时把公开状态写到 `<dataDir>/rhythm/status.json`，供其他插件读取。
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
import { join } from 'node:path';
import type { EventEnvelope, OutputTap, RunPhase, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import { shortTime } from 'cortico/core/util.ts';
import { rhythmConfigGroup, RHYTHM_ID, type RhythmConfigSection } from './config.ts';
import { fillTemplate, loadMessages, messagesPath, type HintKind } from './messages.ts';
import { NUDGE_TEXT, type ModelLanguage } from './model-text.ts';
import { loadState, localDayKey, saveState, stateFilePath, writeJsonAtomic, type RhythmState } from './state.ts';
import { uiText, type LampInfo } from './ui-text.ts';
import { formatClock, matchWindow, minutesOfDay, parseWindowList, type ClockWindow } from './windows.ts';

/** 叫醒事件的类型。 */
export const NUDGE_TYPE = 'rhythm.nudge';

/** 睡眠提示事件的类型（入睡 / 醒来 / 被吵醒）。 */
export const HINT_TYPE = 'rhythm.hint';

/** 被吵醒的归档事件：只入库、不投递。 */
export const WOKE_TYPE = 'rhythm.woke';

/** 检查周期：配置以分钟计，5 秒的粒度足够，也几乎不花什么。 */
const CHECK_EVERY_MS = 5_000;

/** 最近 events 窗口里找使用者的动作；够覆盖一段对话，读起来便宜。 */
const SCAN_LIMIT = 500;

/** Coo 自己的自录事件都以 `.self` 结尾（desktop-pet.self / console.self），不算有人回来。 */
const SELF_SUFFIX = '.self';

/** 「被吵醒」提示的保鲜期由配置给（`wakeHintSeconds`，缺省 90 秒），超过就作废。 */
const DEFAULT_WAKE_HINT_SECONDS = 90;

/** 算「主动搭话」的工具名；配置是逗号分隔的字符串。 */
const DEFAULT_SPEAK_TOOLS = 'pet_say, pet_ask, console_send, clawbridge_send';

/** 说话动词：工具名 `<渠道前缀>_<动词>` 时用它判断是不是在跟人说话。 */
const SPEECH_VERBS: ReadonlySet<string> = new Set([
  'say', 'send', 'ask', 'reply', 'message', 'post', 'tell', 'chat', 'whisper', 'notify', 'dm',
]);

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
  /** 部署数据目录；状态、公开状态与提示文案都放它的 `rhythm/` 下。 */
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
  sleepHint: boolean;
  wakeHint: boolean;
  wakeGapMinutes: number;
  wakeHintSeconds: number;
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
  /** 落盘的运行时状态（今日次数、睡眠会话等）。 */
  private state: RhythmState;
  /** 时段缓存的原始字符串；配置热改时重解析。 */
  private windowsKey = '';
  private sleepWindows: ClockWindow[] = [];
  private restWindows: ClockWindow[] = [];
  /** 上一拍是否在睡眠/休息时段里；用来发现「刚睡醒」与进入时发提示。 */
  private lastWindow: 'sleep' | 'rest' | null = null;
  /** 概率跳过时压制到这一刻（epoch ms）。 */
  private suppressedUntil = 0;
  /**
   * 最近一次叫醒之后的那一轮：它有没有对外开口。
   * 只有「开了口又没人回」才计入退避；安静地结束、或去查资料都不算。
   */
  private attempt: { at: number; spoke: boolean } | null = null;
  /** 文案文件的损坏只报一次，别每次提示都刷屏。 */
  private messagesWarned = false;
  /**
   * 从事件库学到的聊天渠道前缀（`qq.message` → `qq`）。
   * 有插件推过用户消息，它的说话工具（如 `qq_send`）就能被自动认出来，不用人工登记。
   */
  private channelPrefixes = new Set<string>();

  constructor(private readonly opts: RhythmOptions) {
    this.state = {
      version: 1,
      dayKey: localDayKey(opts.timezone, Date.now()),
      nudgesToday: 0,
      rounds: 0,
      unanswered: 0,
      lastNudgeAt: null,
      lastOutcome: null,
      lastOutcomeAt: null,
      sleep: {
        nightKey: null,
        sleepHintSent: false,
        wakeHintSent: false,
        wokeCount: 0,
        lastWokeAt: null,
        lastWokeBy: null,
        lastCountedAt: null,
      },
    };
  }

  /** 不加环境段：机制只通过事件本身说明，不占每次请求的前缀。 */
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
    this.attempt = null;
    if (error) host.log.warn('作息:状态文件读不出来，按新的一天开始', { error });
    this.warnMessageProblems();

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
    const opening = this.currentWindow(now);
    this.lastWindow = opening?.kind ?? null;
    if (opening?.kind === 'sleep') {
      // 重启时已经在睡眠时段里：不补发「该睡了」，但把这一夜记成已发，免得下次进入又发。
      const key = this.nightKeyOf(opening.window, now);
      if (this.state.sleep.nightKey !== key) {
        this.state.sleep = {
          nightKey: key,
          sleepHintSent: true,
          wakeHintSent: false,
          wokeCount: 0,
          lastWokeAt: null,
          lastWokeBy: null,
          lastCountedAt: null,
        };
        this.persist();
      }
    }
    host.log.info('作息:启动', {
      quietMinutes: limits.quietMinutes,
      maxRounds: limits.maxRounds,
      dailyCap: limits.dailyCap,
      sleepWindow: String(this.opts.cfg.sleepWindow ?? ''),
      restWindows: String(this.opts.cfg.restWindows ?? ''),
      sleepHint: limits.sleepHint,
      wakeHint: limits.wakeHint,
      nudgesToday: state.nudgesToday,
      rounds: this.rounds,
      stretchAlive,
      inWindow: this.lastWindow,
      wokeCount: this.state.sleep.wokeCount,
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

  /**
   * 主 session 的输出流旁路：只看“它有没有调用对外说话的工具”。
   * 这是判断“主动搭话”的可靠信号——即使某个渠道（如微信桥）不把自己的发出消息写进事件库。
   */
  outputTap(): OutputTap {
    return { onEvent: (event) => this.observeStream(event) };
  }

  /** 从流事件里认出 function_call；只有 `speakTools` 里的工具才算开口。 */
  private observeStream(event: Parameters<OutputTap['onEvent']>[0]): void {
    const e = event as unknown as { type?: string; item?: { type?: string; name?: string } | null };
    if (e.type !== 'response.output_item.added') return;
    const item = e.item;
    if (!item || item.type !== 'function_call' || typeof item.name !== 'string') return;
    const speech = this.isSpeakTool(item.name);
    // 只在叫醒后的那一轮里记观察日志，别把普通对话也刷满
    if (!this.attempt) return;
    this.host?.log.debug('作息:叫醒后的工具调用', { tool: item.name, countsAsSpeech: speech });
    if (!speech || this.attempt.spoke) return;
    this.attempt.spoke = true;
    this.host?.log.debug('作息:叫醒后开口了', { tool: item.name });
  }

  /** 记下一个聊天渠道前缀（上限 64 个，够用且防失控）。 */
  private noteChannel(type: string): void {
    const prefix = type.split('.')[0]?.toLowerCase() ?? '';
    if (!prefix || this.channelPrefixes.has(prefix) || this.channelPrefixes.size >= 64) return;
    this.channelPrefixes.add(prefix);
  }

  /** 逗号分隔的名单里有没有这个工具名（大小写不敏感）。 */
  private inNameList(raw: unknown, name: string): boolean {
    if (typeof raw !== 'string' || raw.trim() === '') return false;
    const target = name.trim().toLowerCase();
    for (const part of raw.split(',')) {
      if (part.trim().toLowerCase() === target) return true;
    }
    return false;
  }

  /**
   * 工具名是否算「主动搭话」。三层：
   * 1. `speakIgnore` 命中 → 不算（优先）；
   * 2. `speakTools` 显式命中 → 算（补命名不按约定的插件）；
   * 3. 自动：前缀是学到的聊天渠道（`qq.message` → `qq`），且动词是说话动词 → 算；
   *    打开 `speakMatchAnywhere` 时，只看名字里有没有说话动词。
   */
  private isSpeakTool(name: string): boolean {
    const lower = name.trim().toLowerCase();
    if (!lower) return false;
    if (this.inNameList(this.opts.cfg.speakIgnore, lower)) return false;
    const explicit = typeof this.opts.cfg.speakTools === 'string' ? this.opts.cfg.speakTools : DEFAULT_SPEAK_TOOLS;
    if (this.inNameList(explicit, lower)) return true;
    if (this.opts.cfg.speakMatchAnywhere === true) {
      for (const verb of SPEECH_VERBS) if (lower.includes(verb)) return true;
      return false;
    }
    const underscore = lower.indexOf('_');
    if (underscore <= 0) return false;
    const prefix = lower.slice(0, underscore);
    if (!this.channelPrefixes.has(prefix)) return false;
    const verb = lower.slice(underscore + 1).split('_')[0];
    return SPEECH_VERBS.has(verb);
  }

  /**
   * 结算上一轮叫醒：坐下来数一数，“这次它到底有没有主动开口”。
   * - 人在这期间说过话：算被回应，清零；
   * - 它调用了说话工具、又没人回应：`unanswered += 1`，退避据此变稀；
   * - 它安静地结束、或去查资料/整理文件：什么都不记。
   */
  private settleAttempt(): void {
    const attempt = this.attempt;
    this.attempt = null;
    if (!attempt) return;
    const answered = this.latestPersonActivity().at > attempt.at;
    if (answered) {
      if (this.state.unanswered !== 0) {
        this.state.unanswered = 0;
        this.host?.log.debug('作息:有人回应了，退避归零');
      }
      return;
    }
    if (!attempt.spoke) {
      this.host?.log.debug('作息:这一轮没有对外搭话，不计入退避', { round: this.rounds });
      return;
    }
    this.state.unanswered += 1;
    this.host?.log.info('作息:搭话没人理', {
      unanswered: this.state.unanswered,
      backoffAfter: this.limits().backoffAfter,
      waitedMin: Math.max(1, Math.round((Date.now() - attempt.at) / 60_000)),
    });
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
      sleepHint: cfg.sleepHint !== false,
      wakeHint: cfg.wakeHint !== false,
      wakeGapMinutes: Math.floor(numberIn(cfg.wakeGapMinutes, 30, 1, 240)),
      wakeHintSeconds: Math.floor(numberIn(cfg.wakeHintSeconds, DEFAULT_WAKE_HINT_SECONDS, 10, 300)),
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

  /** 这一夜的身份：睡眠时段开始那天的本地日期。 */
  private nightKeyOf(window: ClockWindow, nowMs: number): string {
    const minute = minutesOfDay(nowMs, this.opts.timezone);
    return minute >= window.start
      ? localDayKey(this.opts.timezone, nowMs)
      : localDayKey(this.opts.timezone, nowMs - 24 * 3_600_000);
  }

  /**
   * 退避倍数：数的是「主动搭话却没人回」的次数（`state.unanswered`），不是叫醒次数。
   * 它安静地结束一轮、或者去查资料/整理文件，都不算一次失败的搭话。
   */
  private backoffMultiplier(limits: Limits): number {
    if (limits.backoffAfter <= 0) return 1;
    // 连续 N 次被无视之后开始变稀：第 N+1 次起乘一次 factor。
    const extra = this.state.unanswered - limits.backoffAfter + 1;
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
    if (event.type === HINT_TYPE) return false;
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
        this.noteChannel(event.type);
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

    // 睡眠/休息时段：不主动叫醒；睡眠时段内还要数「被吵醒」。
    const windowNow = this.currentWindow(now);
    if (windowNow) {
      if (this.lastWindow !== windowNow.kind) this.enterWindow(windowNow, now);
      if (windowNow.kind === 'sleep') this.countWakes(now, limits);
      return;
    }
    if (this.lastWindow) this.leaveWindow(now, limits);

    const latest = this.latestPersonActivity();
    if (latest.at > this.lastActivitySeen) {
      const hadRounds = this.rounds > 0;
      this.lastActivitySeen = latest.at;
      this.rounds = 0;
      this.state.unanswered = 0;
      this.attempt = null;
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

  // ── 睡眠时段 ────────────────────────────────────────────────────────────

  /** 进入某个时段；进入睡眠时段时开一夜的会话并发「该睡了」。 */
  private enterWindow(windowNow: { kind: 'sleep' | 'rest'; window: ClockWindow }, now: number): void {
    const host = this.host;
    this.lastWindow = windowNow.kind;
    this.attempt = null;
    if (windowNow.kind !== 'sleep') {
      host?.log.info('作息:进入休息时段', { until: formatClock(windowNow.window.end) });
      return;
    }
    const key = this.nightKeyOf(windowNow.window, now);
    const limits = this.limits();
    if (this.state.sleep.nightKey !== key) {
      this.state.sleep = {
        nightKey: key,
        sleepHintSent: false,
        wakeHintSent: false,
        wokeCount: 0,
        lastWokeAt: null,
        lastWokeBy: null,
        lastCountedAt: null,
      };
      if (limits.sleepHint) {
        this.sendHint('sleep', now);
        this.state.sleep.sleepHintSent = true;
      }
      this.persist();
    }
    host?.log.info('作息:进入睡眠时段', {
      night: key,
      until: formatClock(windowNow.window.end),
      hint: limits.sleepHint ? 'sent' : 'off',
    });
  }

  /** 离开时段；离开睡眠时段时发「该醒了」并收尾这一夜。 */
  private leaveWindow(now: number, limits: Limits): void {
    const host = this.host;
    const was = this.lastWindow;
    this.lastWindow = null;
    if (was === 'rest') {
      host?.log.info('作息:休息时段结束，安静计时重新开始', { quietMinutes: limits.quietMinutes });
    } else {
      if (limits.sleepHint && this.state.sleep.sleepHintSent && !this.state.sleep.wakeHintSent) {
        this.sendHint('wake', now);
        this.state.sleep.wakeHintSent = true;
      }
      host?.log.info('作息:睡眠时段结束', {
        wokeCount: this.state.sleep.wokeCount,
        hints: { sleep: this.state.sleep.sleepHintSent, wake: this.state.sleep.wakeHintSent },
      });
      this.state.sleep = {
        nightKey: null,
        sleepHintSent: false,
        wakeHintSent: false,
        wokeCount: 0,
        lastWokeAt: null,
        lastWokeBy: null,
        lastCountedAt: null,
      };
      this.persist();
    }
    // 无论 sleep 还是 rest：安静与轮次都从头开始，避免时段结束整点立刻跳出来。
    this.lastActivitySeen = now;
    this.rounds = 0;
    this.state.unanswered = 0;
    this.attempt = null;
    this.lastNudgeAt = 0;
    this.suppressedUntil = 0;
    this.rollJitter();
  }

  /**
   * 睡眠时段内数「被吵醒」：同一场打扰按 `wakeGapMinutes` 合并；
   * 每计一次就落一条归档事件，并按需投一条 piggyback 的起床气提示。
   */
  private countWakes(now: number, limits: Limits): void {
    const host = this.host;
    if (!host) return;
    const latest = this.latestPersonActivity();
    if (latest.at === 0) return;
    // 上一条人侧事件的时刻（更新前）；用来判断「两次说话之间是不是真的安静了」。
    const previous = this.lastActivitySeen;
    if (latest.at > previous) this.lastActivitySeen = latest.at;
    if (!latest.type) return;
    // 有人来找它：无论这一下是否计一次「被吵醒」，退避都从头开始。
    this.state.unanswered = 0;
    this.attempt = null;

    const gapMs = limits.wakeGapMinutes * 60_000;
    const countedAt = this.state.sleep.lastCountedAt ? Date.parse(this.state.sleep.lastCountedAt) : 0;
    // 第一场打扰一定算；之后只有「上一次说话已经是 gap 分钟以前」才算新的一次。
    // 用 previous 而不是 countedAt：连续聊天时上一条就在几分钟前，不会凑满 30 分钟又记一次。
    if (countedAt > 0 && latest.at - previous < gapMs) return;

    this.state.sleep.wokeCount += 1;
    this.state.sleep.lastWokeAt = new Date(latest.at).toISOString();
    this.state.sleep.lastWokeBy = latest.type;
    this.state.sleep.lastCountedAt = new Date(latest.at).toISOString();
    host.log.info('作息:被吵醒', {
      by: latest.type,
      wokeCount: this.state.sleep.wokeCount,
      sinceLastWokeMin: countedAt > 0 ? Math.round((latest.at - countedAt) / 60_000) : null,
    });
    // 归档事件：只入库、不投递，供同进程的其他插件按时间轴读取。
    void host.pushEvent({
      type: WOKE_TYPE,
      ts: new Date(latest.at).toISOString(),
      source: RHYTHM_ID,
      origin: 'internal',
      senderKey: WOKE_TYPE,
      text: `睡眠时段内被 ${latest.type} 吵醒（今夜第 ${this.state.sleep.wokeCount} 次）`,
      meta: { count: this.state.sleep.wokeCount, by: latest.type },
    }, { deliver: false }).catch((error: unknown) => {
      host.log.warn('作息:被吵醒记录没写进去', { error });
    });
    if (limits.wakeHint) {
      this.sendHint('woken', now, { by: latest.type, count: this.state.sleep.wokeCount });
    }
    this.persist();
  }

  // ── 提示 ────────────────────────────────────────────────────────────────

  /** 读一次文案文件（允许热改；坏了就退回默认并只报一次）。 */
  private readMessages(): ReturnType<typeof loadMessages>['messages'] {
    const { messages, problems } = loadMessages(messagesPath(this.opts.dataDir));
    if (problems.length && !this.messagesWarned) {
      this.messagesWarned = true;
      this.host?.log.warn('作息:提示文案文件有问题，先用内置默认', { problems });
    }
    return messages;
  }

  private warnMessageProblems(): void {
    const { problems } = loadMessages(messagesPath(this.opts.dataDir));
    if (problems.length) {
      this.messagesWarned = true;
      this.host?.log.warn('作息:提示文案文件有问题，先用内置默认', { problems });
    }
  }

  /**
   * 发一条睡眠提示。
   * `sleep` / `wake` 用 flush（要及时送到）；`woken` 用 piggyback（只搭着正在进行的一轮走），
   * 并且超过保鲜期就作废——永远不在对话结束后突然冒出「你刚才被吵醒了」。
   */
  private sendHint(kind: HintKind, now: number, vars: { by?: string; count?: number } = {}): void {
    const host = this.host;
    if (!host) return;
    const limits = this.limits();
    const template = this.readMessages()[this.opts.language()][kind];
    const text = fillTemplate(template, {
      at: shortTime(this.opts.timezone, new Date(now)),
      by: vars.by ?? '',
      count: vars.count === undefined ? '' : String(vars.count),
    });
    const staleAfterMs = limits.wakeHintSeconds * 1000;
    host.log.info('作息:睡眠提示', { kind, phase: this.phaseState });
    host.pushDeferred({
      type: HINT_TYPE,
      origin: 'internal',
      senderKey: HINT_TYPE,
      meta: { kind },
      render: () => {
        if (kind === 'woken' && Date.now() - now > staleAfterMs) return null;
        return text;
      },
    }, { trigger: kind === 'woken' ? 'piggyback' : 'flush' });
  }

  // ── 叫醒 ────────────────────────────────────────────────────────────────

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
    this.settleAttempt();
    this.rounds += 1;
    this.attempt = { at: now, spoke: false };
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

  // ── 落盘 ────────────────────────────────────────────────────────────────

  /** 落盘：内部状态 + 对外公开的 status.json。 */
  private persist(): void {
    if (!this.opts.dataDir) return;
    const { error } = saveState(stateFilePath(this.opts.dataDir), {
      version: 1,
      dayKey: this.state.dayKey,
      nudgesToday: this.state.nudgesToday,
      rounds: this.rounds,
      unanswered: this.state.unanswered,
      lastNudgeAt: this.lastNudgeAt > 0 ? new Date(this.lastNudgeAt).toISOString() : null,
      lastOutcome: this.state.lastOutcome,
      lastOutcomeAt: this.state.lastOutcomeAt,
      sleep: this.state.sleep,
    });
    if (error) this.host?.log.warn('作息:状态写不进去', { error });
    this.writeStatus();
  }

  /** 给其他软件读的公开状态：只放非敏感事实。 */
  private writeStatus(): void {
    const now = Date.now();
    const limits = this.limits();
    this.refreshWindows();
    const windowNow = this.currentWindow(now);
    const sleeping = windowNow?.kind === 'sleep';
    const { error } = writeJsonAtomic(join(this.opts.dataDir, 'rhythm', 'status.json'), {
      version: 1,
      generatedAt: new Date(now).toISOString(),
      sleep: {
        active: sleeping,
        window: sleeping && windowNow ? `${formatClock(windowNow.window.start)}-${formatClock(windowNow.window.end)}` : null,
        endsAt: sleeping && windowNow ? formatClock(windowNow.window.end) : null,
        wokeCount: this.state.sleep.wokeCount,
        lastWokeAt: this.state.sleep.lastWokeAt,
        lastWokeBy: this.state.sleep.lastWokeBy,
      },
      today: { nudges: this.state.nudgesToday, cap: limits.dailyCap },
      speak: { channels: [...this.channelPrefixes].sort(), unanswered: this.state.unanswered },
    });
    if (error) this.host?.log.warn('作息:公开状态写不进去', { error });
  }
}
