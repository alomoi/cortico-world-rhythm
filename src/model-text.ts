/**
 * 模型读到的文本（叫醒事件正文），中文与英文两版。
 *
 * 语言跟 Coopanion 的模型文本语言走：应用语言是 zh / zh-Hant 用中文，其余用英文。
 * 应用语言从部署目录的 config.json 现读；读不到时按中文。
 *
 * 正文落到上下文里是 user 消息中的一行（internal 投递，不进 system 前缀），
 * 所以带上 [时刻][作息] 标记，让 Coo 一眼看出这是机制在说话，不是对方发言。
 *
 * P3 起是「轻量内容感知」：默认只给事实（安静多久、它上次开口有没有被接），
 * 原话引用只在「上下文可能丢了」时才会传进来（见 world.ts 的 stale 判定）。
 * 措辞保持渠道中性——不写「气泡」「微信」，避免暗示某个渠道。
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

export interface NudgeQuote {
  /** 当地时刻 HH:MM。 */
  at: string;
  text: string;
  /** 它说完之后有没有人接话（只对「它自己说的话」有意义）。 */
  answered?: boolean;
}

export interface NudgeLine {
  /** 使用者那边的本地时刻，HH:MM。 */
  at: string;
  /** 这次安静了多久（分钟）。 */
  quietMinutes: number;
  /** 这一段安静里不是第一次叫醒。 */
  again: boolean;
  /** 这一段安静里已经叫了几次（用来轮换收尾句）。 */
  round: number;
  /** 它上一次开口有没有被接——只给事实，不含内容。 */
  unanswered: boolean;
  /** 主人是否在电脑前：锁屏 / 长时间没输入（二者只出一个）。 */
  away?: { kind: 'locked' } | { kind: 'idle'; idleMinutes: number } | null;
  /** 上下文可能丢失时才提供的引用（对方 / 自己）。 */
  quoteUser?: NudgeQuote | null;
  quoteSelf?: NudgeQuote | null;
}

/** 正文上限（字符数）；超了先丢引用。 */
const MAX_BODY_CHARS = 320;

/** 唯一的收尾句：每次都保留「说话 / 用工具 / 结束」三个选项。 */
const CLOSING: Record<ModelLanguage, (user: string) => string> = {
  zh: (user) => `想说话就用你平时的方式跟${user}说一句，想做事就用工具，不想就结束这一轮。`,
  en: (user) => `If you want to say something, say it the way you usually do to ${user}; use your tools if you have something to do; otherwise end this turn.`,
};
const OPENINGS: Record<ModelLanguage, (line: NudgeLine) => string> = {
  zh: (line) => `[${line.at}] [作息] 安静了约 ${line.quietMinutes} 分钟，${line.user ?? 'ta'}没有跟你说话。`,
  en: (line) => `[${line.at}] [rhythm] It has been quiet for about ${line.quietMinutes} minutes; ${line.user ?? 'the person'} is not talking to you.`,
};

const UNANSWERED_FACT: Record<ModelLanguage, (user: string) => string> = {
  zh: (user) => `你前面说过一句，${user}还没接。`,
  en: () => 'You spoke up earlier and nobody has answered yet.',
};

/**
 * 拼出叫醒正文。
 * `round` 驱动收尾句轮换（防复读）；引用存在时给两行，总长超限就先丢引用。
 */
export function nudgeText(language: ModelLanguage, line: NudgeLine): string {
  const user = line.user ?? (language === 'zh' ? 'ta' : 'the person');
  const optional: string[] = [];
  const quotes: string[] = [];
  // 锁屏与空闲互斥：锁屏只说锁屏，没锁才说空闲
  if (line.away) {
    if (line.away.kind === 'locked') {
      optional.push(language === 'zh'
        ? `${user}现在不在电脑前（屏幕锁着）。`
        : `${user} is not at the computer right now (the screen is locked).`);
    } else {
      const idle = line.away.idleMinutes;
      optional.push(language === 'zh'
        ? `电脑已经 ${idle} 分钟没动过了，${user}或许不在电脑前。`
        : `The computer has been idle for ${idle} minutes; ${user} may not be at the desk.`);
    }
  }
  if (line.quoteUser) {
    quotes.push(language === 'zh'
      ? `${user}最后一句（${line.quoteUser.at}）：「${line.quoteUser.text}」`
      : `The last thing ${user} said (${line.quoteUser.at}): "${line.quoteUser.text}"`);
  }
  if (line.quoteSelf) {
    quotes.push(language === 'zh'
      ? `你上次说（${line.quoteSelf.at}）：「${line.quoteSelf.text}」${line.quoteSelf.answered ? '。' : '，还没人接话。'}`
      : `You last said (${line.quoteSelf.at}): "${line.quoteSelf.text}"${line.quoteSelf.answered ? '.' : ', and nobody has replied.'}`);
  }
  // 事实之间是 AND：away 不会挤掉它；只有 quoteSelf 已经写明「还没人接话」时才省略这一行
  if (line.unansweredText) optional.push(line.unansweredText);
  else if (line.unanswered && !line.quoteSelf) optional.push(UNANSWERED_FACT[language](user));

  const closing = CLOSING[language](user);
  optional.push(...quotes);
  const build = (extra: readonly string[]): string => [OPENINGS[language](line), ...extra, closing].join('\n');

  let body = build(optional);
  // 超长就先丢引用，保留事实与收尾
  while (body.length > MAX_BODY_CHARS && optional.length > 0) {
    optional.pop();
    body = build(optional);
  }
  return body;
}
