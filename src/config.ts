/**
 * 作息（Rhythm）World 的配置段与 WebUI 配置组。
 *
 * `worlds.rhythm` 是组装层给出的活引用：WebUI 在「模块」页改值时就地写进这个对象，
 * World 每个检查周期现读，所以改完立即生效，不需要重启。
 */
import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import type { Language } from 'cortico/core/language.ts';
import type { WorldSection } from 'cortico/world.ts';
import { uiText } from './ui-text.ts';

/** World id。内置 World 是 console / desktop-pet / coopanion，扩展 World 用不冲突的名字。 */
export const RHYTHM_ID = 'rhythm';

export interface RhythmConfigSection extends WorldSection {
  /** 安静多少分钟后第一次叫醒 Coo；0 关闭计时（世界保持挂载但不再叫醒）。 */
  quietMinutes: number;
  /** 一次叫醒之后，若还是没人说话，隔多久再叫醒一次。 */
  repeatMinutes: number;
  /** 一段安静里最多叫醒几次；0 表示不限；使用者一说话就重新计数。 */
  maxRounds: number;
  /** 间隔的随机浮动比例（0–0.5）：实际间隔 = 基准 × (1 + 随机 × jitter)。 */
  jitter: number;
  /** 睡眠时段，`HH:MM-HH:MM`；留空表示不启用。结束 ≤ 开始表示跨午夜。 */
  sleepWindow: string;
  /** 休息时段，可写多个，逗号分隔；留空表示没有。 */
  restWindows: string;
  /** 一天（部署时区）最多叫醒几次；0 表示不限。 */
  dailyCap: number;
  /** 搭话意愿：按「未回应次数」递减再次叫醒的频率（取代旧退避）。 */
  willingnessEnabled: boolean;
  /** 意愿最低时，再次叫醒的绝对封顶（分钟）。 */
  willingnessMaxMinutes: number;
  /** 递减期间是否在叫醒正文里加一句情绪提示。 */
  willingnessHint: boolean;
  /** 诊断模式：写可分享的 diagnostics.json 与 debug.log；默认关。 */
  debug: boolean;
  /** 到点按概率跳过这一次（0–1）。预留：这版不进配置组，留 0 即关闭。 */
  skipChance: number;
  /** 睡眠时段的「该睡了 / 该醒了」两条提示。 */
  sleepHint: boolean;
  /** 睡眠时段被叫醒时，兜底给 Coo 一条「你被吵醒了」的提示（piggyback，迟到作废）。 */
  wakeHint: boolean;
  /** 同一场打扰的合并间隔：超过它再有人来才算「又被吵醒一次」。 */
  wakeGapMinutes: number;
  /** 「被吵醒」提示的保鲜期（秒）：超过它就作废，不事后补发。 */
  wakeHintSeconds: number;
  /** 额外认定为「搭话」的工具名，逗号分隔；自动学习认不出的插件用它补。 */
  speakTools: string;
  /** 不算「搭话」的工具名，逗号分隔；误判时用它排除（优先于其他规则）。 */
  speakIgnore: string;
  /** 宽松匹配：工具名里出现说话动词就算，不管前缀（默认关，误判率更高）。 */
  speakMatchAnywhere: boolean;
  /** 影子模式：只计算与记日志，不投递任何事件。 */
  dryRun: boolean;
  /** 叫醒正文里带「最后谁在说话 / 它上次开口有没有被接」这些事实。 */
  contextAware: boolean;
  /** 允许在上下文可能丢失时引用原话。 */
  contextQuotes: boolean;
  /** 安静超过这么多分钟，就认为该复习一下，允许引用。 */
  contextStaleMinutes: number;
  /** 渠道别名：`clawbridge=微信, qq=QQ`，给提示文案里的 `{by}` 用。 */
  channelAliases: string;
  /** 叫醒后核对工具回执：据实排除发送失败的那一轮。 */
  verifySpeakReceipts: boolean;
  /** 叫醒时探测锁屏/空闲（仅 Windows 生效），把结果写进正文。 */
  awayDetection: boolean;
  /** 超过这么多分钟无输入，就提示「可能在忙」。 */
  awayIdleMinutes: number;
  /** 锁屏期间跳过叫醒（解锁后下一拍再说）。 */
  pauseWhenLocked: boolean;
  /** 是否把探测结果写进叫醒正文。 */
  awayHint: boolean;
  /** 是否用 Add-Type 取键鼠空闲秒数（会触发运行时编译，默认关）。 */
  awayIdleProbe: boolean;
  /** 夜里做梦总开关（默认关）。 */
  dreamEnabled: boolean;
  /** 每夜做梦的概率（0–1）。 */
  dreamChance: number;
  /** 入睡多久后才可能做梦。 */
  dreamAfterMinutes: number;
  /** 一夜最多几次梦。 */
  dreamMaxPerNight: number;
  /** 梦的小本本路径（相对 Coo 的工作区，写进提示词让它自己记）；留空则不提示。 */
  dreamDiary: string;
  /**
   * 只用桌宠与控制台的旧白名单判断「有人回来了」。
   * false（缺省）= 任何渠道的人侧事件都算：微信、QQ、B 站、Discord 等扩展都自动生效。
   */
  knownChannelsOnly: boolean;
  /** 不算「有人回来了」的事件类型，逗号分隔；以 * 结尾表示前缀匹配（如 qq.system*）。 */
  activityIgnore: string;
  /** 主循环正在跑模型或工具时先不叫醒，等它回到空闲。 */
  onlyWhenIdle: boolean;
}

/** 各键的缺省值；enabled 恒为 false，是否启用由 bot 声明与部署配置决定。 */
export const RHYTHM_DEFAULTS: RhythmConfigSection = {
  enabled: false,
  quietMinutes: 15,
  repeatMinutes: 25,
  maxRounds: 0,
  jitter: 0.2,
  sleepWindow: '22:00-08:00',
  restWindows: '',
  dailyCap: 12,
  willingnessEnabled: false,
  willingnessMaxMinutes: 480,
  willingnessHint: true,
  debug: false,
  skipChance: 0,
  sleepHint: true,
  wakeHint: true,
  wakeGapMinutes: 30,
  wakeHintSeconds: 90,
  speakTools: 'pet_say, pet_ask, console_send, clawbridge_send',
  speakIgnore: '',
  speakMatchAnywhere: false,
  dryRun: false,
  contextAware: true,
  contextQuotes: true,
  contextStaleMinutes: 120,
  channelAliases: 'clawbridge=微信, desktop-pet=桌宠, console=控制台, coopanion=应用, qq=QQ',
  verifySpeakReceipts: true,
  awayDetection: true,
  awayIdleMinutes: 10,
  pauseWhenLocked: false,
  awayHint: true,
  awayIdleProbe: false,
  dreamEnabled: false,
  dreamChance: 0.3,
  dreamAfterMinutes: 60,
  dreamMaxPerNight: 1,
  dreamDiary: 'partner/dreams.md',
  knownChannelsOnly: false,
  activityIgnore: '',
  onlyWhenIdle: true,
};

/** 配置组：出现在作息 World 页，改值立即生效（检查周期里现读）。 */
export function rhythmConfigGroup(language: Language): ConfigGroup {
  const t = uiText(language);
  const owner = `world:${RHYTHM_ID}` as const;
  return {
    id: owner,
    owner,
    schema: {
      type: 'object',
      title: t.configTitle,
      description: t.configDescription,
      properties: {
        [`worlds.${RHYTHM_ID}.quietMinutes`]: {
          type: 'integer',
          title: t.quietTitle,
          description: t.quietDescription,
          minimum: 0,
          maximum: 720,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.repeatMinutes`]: {
          type: 'integer',
          title: t.repeatTitle,
          description: t.repeatDescription,
          minimum: 1,
          maximum: 720,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.maxRounds`]: {
          type: 'integer',
          title: t.maxRoundsTitle,
          description: t.maxRoundsDescription,
          minimum: 0,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.jitter`]: {
          type: 'number',
          title: t.jitterTitle,
          description: t.jitterDescription,
          minimum: 0,
          maximum: 0.5,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.sleepWindow`]: {
          type: 'string',
          title: t.sleepTitle,
          description: t.sleepDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.restWindows`]: {
          type: 'string',
          title: t.restTitle,
          description: t.restDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.dailyCap`]: {
          type: 'integer',
          title: t.dailyCapTitle,
          description: t.dailyCapDescription,
          minimum: 0,
          maximum: 200,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.willingnessEnabled`]: {
          type: 'boolean',
          title: t.willingnessEnabledTitle,
          description: t.willingnessEnabledDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.willingnessMaxMinutes`]: {
          type: 'integer',
          title: t.willingnessMaxTitle,
          description: t.willingnessMaxDescription,
          minimum: 60,
          maximum: 720,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.willingnessHint`]: {
          type: 'boolean',
          title: t.willingnessHintTitle,
          description: t.willingnessHintDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.debug`]: {
          type: 'boolean',
          title: t.debugTitle,
          description: t.debugDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.sleepHint`]: {
          type: 'boolean',
          title: t.sleepHintTitle,
          description: t.sleepHintDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.wakeHint`]: {
          type: 'boolean',
          title: t.wakeHintTitle,
          description: t.wakeHintDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.wakeGapMinutes`]: {
          type: 'integer',
          title: t.wakeGapTitle,
          description: t.wakeGapDescription,
          minimum: 1,
          maximum: 240,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.wakeHintSeconds`]: {
          type: 'integer',
          title: t.wakeHintSecondsTitle,
          description: t.wakeHintSecondsDescription,
          minimum: 10,
          maximum: 300,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.speakTools`]: {
          type: 'string',
          title: t.speakToolsTitle,
          description: t.speakToolsDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.speakIgnore`]: {
          type: 'string',
          title: t.speakIgnoreTitle,
          description: t.speakIgnoreDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.channelAliases`]: {
          type: 'string',
          title: t.channelAliasesTitle,
          description: t.channelAliasesDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.verifySpeakReceipts`]: {
          type: 'boolean',
          title: t.verifyReceiptsTitle,
          description: t.verifyReceiptsDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.awayDetection`]: {
          type: 'boolean',
          title: t.awayDetectionTitle,
          description: t.awayDetectionDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.awayIdleMinutes`]: {
          type: 'integer',
          title: t.awayIdleTitle,
          description: t.awayIdleDescription,
          minimum: 1,
          maximum: 720,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.pauseWhenLocked`]: {
          type: 'boolean',
          title: t.pauseLockedTitle,
          description: t.pauseLockedDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.awayHint`]: {
          type: 'boolean',
          title: t.awayHintTitle,
          description: t.awayHintDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.awayIdleProbe`]: {
          type: 'boolean',
          title: t.awayIdleProbeTitle,
          description: t.awayIdleProbeDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.dreamEnabled`]: {
          type: 'boolean',
          title: t.dreamEnabledTitle,
          description: t.dreamEnabledDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.dreamChance`]: {
          type: 'number',
          title: t.dreamChanceTitle,
          description: t.dreamChanceDescription,
          minimum: 0,
          maximum: 1,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.dreamAfterMinutes`]: {
          type: 'integer',
          title: t.dreamAfterTitle,
          description: t.dreamAfterDescription,
          minimum: 10,
          maximum: 720,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.dreamMaxPerNight`]: {
          type: 'integer',
          title: t.dreamMaxTitle,
          description: t.dreamMaxDescription,
          minimum: 1,
          maximum: 3,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.dreamDiary`]: {
          type: 'string',
          title: t.dreamDiaryTitle,
          description: t.dreamDiaryDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.dryRun`]: {
          type: 'boolean',
          title: t.dryRunTitle,
          description: t.dryRunDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.contextAware`]: {
          type: 'boolean',
          title: t.contextAwareTitle,
          description: t.contextAwareDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.contextQuotes`]: {
          type: 'boolean',
          title: t.contextQuotesTitle,
          description: t.contextQuotesDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.contextStaleMinutes`]: {
          type: 'integer',
          title: t.contextStaleTitle,
          description: t.contextStaleDescription,
          minimum: 10,
          maximum: 1440,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.speakMatchAnywhere`]: {
          type: 'boolean',
          title: t.speakAnywhereTitle,
          description: t.speakAnywhereDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.knownChannelsOnly`]: {
          type: 'boolean',
          title: t.knownChannelsTitle,
          description: t.knownChannelsDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.activityIgnore`]: {
          type: 'string',
          title: t.activityIgnoreTitle,
          description: t.activityIgnoreDescription,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.onlyWhenIdle`]: {
          type: 'boolean',
          title: t.onlyWhenIdleTitle,
          description: t.onlyWhenIdleDescription,
          'x-hot': true,
        },
      },
    },
  };
}
