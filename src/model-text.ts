/**
 * 模型读到的文本（叫醒事件正文），中文与英文两版。
 *
 * 语言跟 Coopanion 的模型文本语言走：应用语言是 zh / zh-Hant 用中文，其余用英文。
 * 应用语言从部署目录的 config.json 现读；读不到时按中文。
 */
import { readFileSync } from 'node:fs';

export type ModelLanguage = 'zh' | 'en';

/**
 * config.json 的 `language` → 模型文本语言。
 * 与 Coopanion core/language.ts 的 modelLanguage 同一条规则：zh 与 zh-Hant（以及缺省）用中文，其余用英文。
 */
export function modelLanguageOf(value: unknown): ModelLanguage {
  return value === 'zh' || value === 'zh-Hant' || typeof value !== 'string' ? 'zh' : 'en';
}

/** 从一份部署的 config.json 读应用语言；文件缺失或读不成 JSON 时按中文。 */
export function modelLanguageOfConfigFile(file: string): ModelLanguage {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { language?: unknown };
    return modelLanguageOf(raw.language);
  } catch {
    return 'zh';
  }
}

export interface NudgeLine {
  /** 使用者那边的本地时刻，HH:MM。 */
  at: string;
  /** 这次安静了多久（分钟）。 */
  quietMinutes: number;
  /** 这一段安静里不是第一次叫醒。 */
  again: boolean;
}

/**
 * 叫醒事件的正文。开头带时刻，和桌宠事件的习惯一致。
 * 正文只说明「发生了什么、可以怎么做」，开不开口、做什么由 Coo 自己决定。
 */
export const NUDGE_TEXT: Record<ModelLanguage, (line: NudgeLine) => string> = {
  zh: (line) => line.again
    ? `[${line.at}] [自主发言] 又安静了大约 ${line.quietMinutes} 分钟，还是没有人来。想接着刚才的话说下去、自己做点事，或者跟自己聊两句都可以；不想就结束这一轮。`
    : `[${line.at}] [自主发言] 安静了大约 ${line.quietMinutes} 分钟，没有人跟你说话。现在你可以自己决定:想说话就在气泡里跟对方说点什么，想做事就用工具，自己跟自己说几句也可以；不想就结束这一轮。`,
  en: (line) => line.again
    ? `[${line.at}] [self-talk] Another ${line.quietMinutes} quiet minutes have passed and nobody has come. You can carry on from where you were, do something on your own, or just talk to yourself a little; if you would rather not, end this turn.`
    : `[${line.at}] [self-talk] It has been quiet for about ${line.quietMinutes} minutes; nobody is talking to you. It is your call: say something to the person in your bubble, do something with your tools, or just talk to yourself a little; if you have nothing to say, end this turn.`,
};
