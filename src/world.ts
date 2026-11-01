/**
 * 自主发言 World：一段时间没人跟 Coo 说话，就把它叫醒一次，让它自己决定开不开口、
 * 先用哪个工具、还是什么都不说（end_turn）。叫醒靠一条 internal 事件投递，正文由
 * model-text.ts 按模型文本语言给；事件以 flush 投递，空闲的主循环收到即开始一轮。
 *
 * 「安静」的判定：从事件库里找最近一条「使用者的动作」——桌宠的打字、语音、回答、
 * 戳摸、换装，或控制台发言、按下对话按钮。Coo 自己说的话（desktop-pet.self /
 * console.self）不算：它们不能被叫醒本身重置，不然第二轮叫醒就永远等不到。
 * 使用者的动作一出现，计数清零，安静计时从那个时刻重新开始。
 *
 * 时间参数都在 worlds.selftalk 里（config.ts），每个检查周期现读，WebUI 改完立即生效。
 * 每个间隔（第一次叫醒与每次再次叫醒）各自乘以一次随机倍数（jitter），让节奏不机械。
 * 叫醒事件在投递时才渲染（pushDeferred）：如果排队期间使用者回来了，这一条作废。
 */
import type { World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { Language } from 'cortico/core/language.ts';
import { shortTime } from 'cortico/core/util.ts';
import { selftalkConfigGroup, SELFTALK_ID, type SelfTalkConfigSection } from './config.ts';
import { NUDGE_TEXT, type ModelLanguage } from './model-text.ts';
import { uiText } from './ui-text.ts';

/** 叫醒事件的类型。 */
export const NUDGE_TYPE = 'selftalk.nudge';

/** 检查周期：配置以分钟计，5 秒的粒度足够，也几乎不花什么。 */
const CHECK_EVERY_MS = 5_000;

/** 最近 events 窗口里找使用者的动作；够覆盖一段对话，读起来便宜。 */
const SCAN_LIMIT = 500;

/**
 * 使用者的动作：出现任何一种，就算有人在跟 Coo 互动，安静计时从头开始。
 * 内置两个对话渠道（桌宠与控制台）的全部人侧事件；Coo 自己的自录事件不在此列。
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

export interface SelfTalkOptions {
  /** 组装层给的活引用：`worlds.selftalk`。 */
  cfg: SelfTalkConfigSection;
  /** 部署时区，叫醒行里的时刻用它渲染。 */
  timezone: string;
  /** 模型文本语言；每条事件渲染时现取。 */
  language: () => ModelLanguage;
}

export class SelfTalkWorld implements World {
  readonly id = SELFTALK_ID;

  private host: WorldHost | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 世界开始的时刻：找不到更早的活动时，安静从这里算。 */
  private startedAt = 0;
  /** 已看见的最近一次使用者动作（epoch ms）。 */
  private lastActivitySeen = 0;
  /** 这一段安静里已叫醒几次。 */
  private rounds = 0;
  /** 上一次叫醒的时刻；repeatMinutes 从它起算。 */
  private lastNudgeAt = 0;
  /** 第一次叫醒间隔的随机倍数（1–1+jitter），一段安静里固定，免得来回抖。 */
  private jitterFactor = 1;

  constructor(private readonly opts: SelfTalkOptions) {}

  /** 不加环境段：机制只通过叫醒事件本身说明，不占每次请求的前缀。 */
  envPromptVars(): null {
    return null;
  }

  /** 控制台「模块」页的名片：名字、状态灯与配置组。 */
  webUi(language?: Language): WorldWebUiDecl {
    const t = uiText(language);
    const quietMinutes = this.limits().quietMinutes;
    const maxRounds = this.limits().maxRounds;
    return {
      label: t.label,
      lamps: [{
        label: t.lampLabel,
        state: 'online',
        hint: quietMinutes > 0 ? t.lampHint(quietMinutes, maxRounds) : t.lampOff,
      }],
      config: [selftalkConfigGroup(language ?? 'zh')],
    };
  }

  /** 没有自己的工具：叫醒后用什么工具，是 Coo 和别的 World 的事。 */
  tools(): [] {
    return [];
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    const now = Date.now();
    this.startedAt = now;
    this.lastActivitySeen = now;
    this.rounds = 0;
    this.rollJitter();
    this.timer = setInterval(() => this.tick(), CHECK_EVERY_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.host = null;
  }

  private limits(): { quietMinutes: number; repeatMinutes: number; maxRounds: number; jitter: number } {
    const cfg = this.opts.cfg;
    return {
      quietMinutes: numberIn(cfg.quietMinutes, 15, 0, 720),
      repeatMinutes: numberIn(cfg.repeatMinutes, 25, 1, 720),
      // 0 表示不限；正数即上限，没有额外的数字上限
      maxRounds: Math.max(0, Math.floor(numberIn(cfg.maxRounds, 0, 0, Number.MAX_SAFE_INTEGER))),
      jitter: numberIn(cfg.jitter, 0.2, 0, 0.5),
    };
  }

  /** 为下一个间隔掷一次随机倍数（1–1+jitter），第一次叫醒与每次再次叫醒之前各掷一次。 */
  private rollJitter(): void {
    this.jitterFactor = 1 + Math.random() * this.limits().jitter;
  }

  /** 最近一条使用者动作的时刻；上限是已知时刻。 */
  private latestPersonActivity(): number {
    const host = this.host;
    if (!host) return this.lastActivitySeen;
    let latest = this.lastActivitySeen;
    try {
      for (const event of host.store.range({ limit: SCAN_LIMIT })) {
        if (!ACTIVITY_TYPES.has(event.type)) continue;
        const at = Date.parse(event.ts);
        if (Number.isFinite(at) && at > latest) latest = at;
      }
    } catch {
      // 事件库读不出（还在重建）：这一拍按没有新活动处理
    }
    return latest;
  }

  private tick(): void {
    const host = this.host;
    if (!host) return;
    const { quietMinutes, repeatMinutes, maxRounds } = this.limits();
    if (quietMinutes <= 0) return;

    const latest = this.latestPersonActivity();
    if (latest > this.lastActivitySeen) {
      this.lastActivitySeen = latest;
      this.rounds = 0;
      this.rollJitter();
    }

    const now = Date.now();
    // maxRounds 为 0 表示不限：一段安静里可以一直叫醒，直到有人说话
    if (this.rounds >= maxRounds && maxRounds > 0) return;
    // 每个间隔各自乘以当轮掷出的随机倍数：第一次是安静起点掷的，再次叫醒是上一次叫醒时掷的
    const due = this.rounds === 0
      ? this.lastActivitySeen + quietMinutes * 60_000 * this.jitterFactor
      : this.lastNudgeAt + repeatMinutes * 60_000 * this.jitterFactor;
    if (now < due) return;
    this.nudge(now);
  }

  private nudge(now: number): void {
    const host = this.host;
    if (!host) return;
    const again = this.rounds > 0;
    this.rounds += 1;
    this.lastNudgeAt = now;
    // 下一次「再次叫醒」间隔的随机倍数现在掷
    this.rollJitter();
    host.log.info('自言自语:叫醒 Coo', { round: this.rounds, again });
    host.pushDeferred({
      type: NUDGE_TYPE,
      origin: 'internal',
      senderKey: NUDGE_TYPE,
      render: () => {
        // 排队期间使用者回来了：这一条作废，安静从新的活动时刻重新算。
        if (this.latestPersonActivity() > this.lastNudgeAt) return null;
        const elapsed = Math.max(1, Math.round((Date.now() - this.lastActivitySeen) / 60_000));
        const language = this.opts.language();
        return NUDGE_TEXT[language]({ at: shortTime(this.opts.timezone), quietMinutes: elapsed, again });
      },
    }, { trigger: 'flush' });
  }
}
