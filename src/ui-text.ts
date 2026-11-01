/**
 * 人读的界面文案（World 名、配置组标题与说明、状态灯），中文与英文两版。
 * 与模型读到的正文（model-text.ts）分开：这里只给控制台看。
 */
import type { Language } from 'cortico/core/language.ts';

export interface SelfTalkUi {
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
  lampLabel: string;
  /** 状态灯悬停说明：每安静 q 分钟叫醒一次，最多 m 次。 */
  lampHint: (quietMinutes: number, maxRounds: number) => string;
  lampOff: string;
}

const zh: SelfTalkUi = {
  label: '自主发言',
  configTitle: '自主发言',
  configDescription: '安静一段时间后叫醒 Coo，让它自己决定说不说话、做点什么。改这里立即生效。',
  quietTitle: '安静多少分钟后叫醒',
  quietDescription: '没有人跟 Coo 说话多久之后叫醒它一次；0 表示关掉叫醒。',
  repeatTitle: '再次叫醒间隔',
  repeatDescription: '叫醒一次之后还是没有人说话，隔多少分钟再叫醒一次。',
  maxRoundsTitle: '最多叫醒几次',
  maxRoundsDescription: '对方一直不说话时，一段安静里最多叫醒几次；0 表示不限；对方一说话就重新计数。',
  jitterTitle: '间隔浮动',
  jitterDescription: '让每个等待间隔都不那么固定：每个间隔在基准的 1–(1+浮动) 倍之间随机。',
  lampLabel: '叫醒计时',
  lampHint: (quietMinutes, maxRounds) => maxRounds > 0
    ? `在线：每安静满 ${quietMinutes} 分钟叫醒 Coo 一次，最多 ${maxRounds} 次。`
    : `在线：每安静满 ${quietMinutes} 分钟叫醒 Coo 一次，不设次数上限。`,
  lampOff: '在线：安静计时已关闭。',
};

const en: SelfTalkUi = {
  label: 'Self-talk',
  configTitle: 'Self-talk',
  configDescription: 'After a quiet stretch the app wakes the bot so it can decide for itself whether to speak or do something. Changes apply immediately.',
  quietTitle: 'Wake after quiet minutes',
  quietDescription: 'How long nobody talks to the bot before it is woken once; 0 turns the timer off.',
  repeatTitle: 'Wake again after',
  repeatDescription: 'Minutes before it is woken again when the quiet continues.',
  maxRoundsTitle: 'At most how many wake-ups',
  maxRoundsDescription: 'Wake-ups per quiet stretch; 0 means no limit; talking to the bot starts the count over.',
  jitterTitle: 'Interval jitter',
  jitterDescription: 'Every waiting interval is drawn between 1 and 1+jitter times its base, so the rhythm is never mechanical.',
  lampLabel: 'Wake timer',
  lampHint: (quietMinutes, maxRounds) => `Online: woken once every ${quietMinutes} quiet minutes, ${maxRounds > 0 ? `at most ${maxRounds} times` : 'without limit'}.`,
  lampOff: 'Online: the quiet timer is off.',
};

/** 界面文案语言：zh 与 zh-Hant 用中文，其余（含未指明）用英文，与 Coopanion 的界面语言取法一致。 */
export function uiText(language: Language | undefined): SelfTalkUi {
  return language === 'zh' || language === 'zh-Hant' || language === undefined ? zh : en;
}
