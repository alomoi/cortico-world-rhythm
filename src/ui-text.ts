/**
 * 人读的界面文案（World 名、配置组标题与说明、状态灯），中文与英文两版。
 * 与模型读到的正文（model-text.ts）分开：这里只给控制台看。
 */
import type { Language } from 'cortico/core/language.ts';

/** 状态灯要显示的事实；由 World 现算，文案在这里按语言渲染。 */
export interface LampInfo {
  /** 0 = 计时关闭。 */
  quietMinutes: number;
  /** 0 = 不限。 */
  maxRounds: number;
  nudgesToday: number;
  /** 距下次叫醒还有几分钟（向上取整）；本轮已到上限时为 null。 */
  nextInMinutes: number | null;
  /** 这一段安静里叫醒次数已达上限。 */
  capped: boolean;
}

export interface RhythmUi {
  label: string;
  configTitle: string;
  configDescription: string;
  quietTitle: string;
  quietDescription: string;
  repeatTitle: string;
  repeatDescription: string;
  maxRoundsTitle: string;
  maxRoundsDescription: string;
  jitterTitle: string;
  jitterDescription: string;
  knownChannelsTitle: string;
  knownChannelsDescription: string;
  activityIgnoreTitle: string;
  activityIgnoreDescription: string;
  onlyWhenIdleTitle: string;
  onlyWhenIdleDescription: string;
  /** 状态灯的名字（悬停标题）。 */
  lampLabel: string;
  /** 状态灯悬停说明。 */
  lampHint: (info: LampInfo) => string;
  /** 计时关闭时的悬停说明。 */
  lampOff: string;
  /** 徽标名：今日叫醒次数。 */
  badgeToday: string;
}

const zh: RhythmUi = {
  label: '作息',
  configTitle: '作息',
  configDescription: '安静一段时间后叫醒 Coo，让它自己决定说不说话、做点什么，慢慢过上自己的日子。改这里立即生效。',
  quietTitle: '安静多少分钟后叫醒',
  quietDescription: '没有人跟 Coo 说话多久之后叫醒它一次；0 表示关掉叫醒。',
  repeatTitle: '再次叫醒间隔',
  repeatDescription: '叫醒一次之后还是没有人说话，隔多少分钟再叫醒一次。',
  maxRoundsTitle: '最多叫醒几次',
  maxRoundsDescription: '对方一直不说话时，一段安静里最多叫醒几次；0 表示不限；对方一说话就重新计数。',
  jitterTitle: '间隔浮动',
  jitterDescription: '让每个等待间隔都不那么固定：每个间隔在基准的 1–(1+浮动) 倍之间随机。',
  knownChannelsTitle: '只把桌宠和控制台当成有人',
  knownChannelsDescription: '打开后只认桌宠与控制台的旧事件清单（旧版本行为），微信、QQ 等其他渠道的消息不算“有人回来了”。默认关闭：任何渠道的人侧事件都算。',
  activityIgnoreTitle: '不算“有人回来了”的事件类型',
  activityIgnoreDescription: '逗号分隔，可写多个；以 * 结尾表示前缀匹配（例如 qq.system*）。一般留空即可。',
  onlyWhenIdleTitle: '只在 Coo 空闲时叫醒',
  onlyWhenIdleDescription: '它正在跑模型或执行工具时先不叫醒，等这一轮结束。默认打开，避免打断它手上的事。',
  lampLabel: '叫醒计时',
  lampHint: (info) => {
    if (info.capped) {
      return `在线：本轮已叫醒 ${info.maxRounds} 次，等有人说话后重新计时（今日 ${info.nudgesToday} 次）。`;
    }
    if (info.nextInMinutes !== null) {
      const cap = info.maxRounds > 0 ? `，本轮上限 ${info.maxRounds} 次` : '';
      return `在线：约 ${info.nextInMinutes} 分钟后叫醒 Coo${cap}（今日 ${info.nudgesToday} 次）。`;
    }
    return `在线：等安静满 ${info.quietMinutes} 分钟再叫醒（今日 ${info.nudgesToday} 次）。`;
  },
  lampOff: '在线：安静计时已关闭。',
  badgeToday: '今日叫醒',
};

const en: RhythmUi = {
  label: 'Rhythm',
  configTitle: 'Rhythm',
  configDescription: 'After a quiet stretch the app wakes the bot so it can decide for itself whether to speak or do something, and slowly settle into a life of its own. Changes apply immediately.',
  quietTitle: 'Wake after quiet minutes',
  quietDescription: 'How long nobody talks to the bot before it is woken once; 0 turns the timer off.',
  repeatTitle: 'Wake again after',
  repeatDescription: 'Minutes before it is woken again when the quiet continues.',
  maxRoundsTitle: 'At most how many wake-ups',
  maxRoundsDescription: 'Wake-ups per quiet stretch; 0 means no limit; talking to the bot starts the count over.',
  jitterTitle: 'Interval jitter',
  jitterDescription: 'Every waiting interval is drawn between 1 and 1+jitter times its base, so the rhythm is never mechanical.',
  knownChannelsTitle: 'Only the pet and console count as a person',
  knownChannelsDescription: 'Uses the old whitelist: only desktop-pet and console events count as "somebody came back". Messages from WeChat, QQ and other channels are ignored. Off by default: person-side events from every channel count.',
  activityIgnoreTitle: 'Event types that are not "somebody came back"',
  activityIgnoreDescription: 'Comma-separated; a trailing * matches a prefix (e.g. qq.system*). Usually leave empty.',
  onlyWhenIdleTitle: 'Only wake the bot while it is idle',
  onlyWhenIdleDescription: 'Skips the wake-up while the model or a tool is running, and waits for the turn to end. On by default so it never interrupts itself.',
  lampLabel: 'Wake timer',
  lampHint: (info) => {
    if (info.capped) {
      return `Online: ${info.maxRounds} wake-ups this stretch; the clock restarts when someone speaks (${info.nudgesToday} today).`;
    }
    if (info.nextInMinutes !== null) {
      const cap = info.maxRounds > 0 ? `, at most ${info.maxRounds} this stretch` : '';
      return `Online: next wake-up in about ${info.nextInMinutes} min${cap} (${info.nudgesToday} today).`;
    }
    return `Online: waiting for ${info.quietMinutes} quiet minutes (${info.nudgesToday} today).`;
  },
  lampOff: 'Online: the quiet timer is off.',
  badgeToday: 'Wakes today',
};

/** 界面文案语言：zh 与 zh-Hant 用中文，其余（含未指明）用英文，与 Coopanion 的界面语言取法一致。 */
export function uiText(language: Language | undefined): RhythmUi {
  return language === 'zh' || language === 'zh-Hant' || language === undefined ? zh : en;
}
