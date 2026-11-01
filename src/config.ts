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
  /** 连续几次没人理之后开始拉长间隔；0 表示不启用退避。 */
  backoffAfter: number;
  /** 每多一次没人回应，再次叫醒的间隔乘多少（1.0–3.0）。 */
  backoffFactor: number;
  /** 间隔最多拉长到基准的多少倍（1–10）。 */
  backoffMaxFactor: number;
  /** 到点按概率跳过这一次（0–1）。预留：这版不进配置组，留 0 即关闭。 */
  skipChance: number;
  /** 睡眠时段的「该睡了 / 该醒了」两条提示。 */
  sleepHint: boolean;
  /** 睡眠时段被叫醒时，兜底给 Coo 一条「你被吵醒了」的提示（piggyback，迟到作废）。 */
  wakeHint: boolean;
  /** 同一场打扰的合并间隔：超过它再有人来才算「又被吵醒一次」。 */
  wakeGapMinutes: number;
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
  backoffAfter: 0,
  backoffFactor: 1.5,
  backoffMaxFactor: 4,
  skipChance: 0,
  sleepHint: true,
  wakeHint: true,
  wakeGapMinutes: 30,
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
        [`worlds.${RHYTHM_ID}.backoffAfter`]: {
          type: 'integer',
          title: t.backoffAfterTitle,
          description: t.backoffAfterDescription,
          minimum: 0,
          maximum: 50,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.backoffFactor`]: {
          type: 'number',
          title: t.backoffFactorTitle,
          description: t.backoffFactorDescription,
          minimum: 1,
          maximum: 3,
          'x-hot': true,
        },
        [`worlds.${RHYTHM_ID}.backoffMaxFactor`]: {
          type: 'number',
          title: t.backoffMaxTitle,
          description: t.backoffMaxDescription,
          minimum: 1,
          maximum: 10,
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
