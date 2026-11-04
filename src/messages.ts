/**
 * 发给桌宠的提示文案（「该睡了」「该醒了」「你被吵醒了」），独立成一个可编辑的 JSON 文件。
 *
 * 为什么单独放：这几句是「给 Coo 看的话」，调语气属于高阶玩法，但不适合塞进设置页的旋钮海洋。
 * 文件位置：`<dataDir>/rhythm/messages.json`，只在缺失时写入一份默认模板，**永不覆盖**用户的修改。
 *
 * 占位符：`{at}` 当地时刻（HH:MM）、`{by}` 打扰来源的事件类型、`{count}` 今夜第几次被吵醒。
 * 模板里写错占位符不会出错，替换不到就原样保留；文件坏了就退回内置默认并记一条 warn。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type MessageLanguage = 'zh' | 'en';

export type HintKind = 'sleep' | 'wake' | 'woken' | 'dream';

export interface RhythmMessages {
  version: 1;
  /** 给用户看的说明：升级只补缺失键，不覆盖已有内容；删掉文件会重建。 */
  _note: string;
  zh: Record<HintKind, string> & { dreamTypes: string[]; willing: string[] };
  en: Record<HintKind, string> & { dreamTypes: string[]; willing: string[] };
}

/** 内置默认值：文件缺失时写到磁盘，也是文件损坏时的兜底。 */
export const DEFAULT_MESSAGES: RhythmMessages = {
  version: 1,
  _note: '本文件可以自由修改。升级时只会补上缺失的键，不会覆盖你已经改过的内容；删掉本文件会按当前版本重新生成默认内容。',
  zh: {
    sleep: '[{at}] [作息] 到睡觉时间了。想睡的话可以用 pet_act 的 sleep 动作躺下（它会保持到你下一次动作）；不想睡就做自己的事，或者结束这一轮。',
    wake: '[{at}] [作息] 早上好，醒醒神。想动一动可以用 pet_act 的 stand 站起来，然后想做什么就做什么。',
    woken: '[{at}] [作息] 你刚才在睡觉，{user}（{by}）把你吵醒了（今夜第 {count} 次）。要不要带点起床气，你自己决定；不想理就结束这一轮。',
dream: '[{at}] [作息] 你正在熟睡，刚做了一个【{type}】的梦。\n先做这一步（必做，不能跳过）：立刻把这条记录**追加写入** {diary}。文件不存在就创建；只追加，不要重写整篇。\n格式（照抄结构）：\n## {date} · {type}\n一两行梦的内容；记不清细节也要留一条，写写当时的感受也行。\n最后加一句你此刻的心情。\n写完再决定睡不睡：想继续睡就躺回去保持睡姿，想醒着就随便。\n（做梦时不能说话、不能用任何说话工具、不能联系任何人。）',
    dreamTypes: ['天马行空的', '快乐的', '舒心的', '关于主人的', '有点伤感的'],
    willing: [
      '上次你主动搭话，{user}没有回复。',
      '你连续两次主动搭话，{user}都没有回复，你有点担心{user}。',
      '你连续三次主动搭话，{user}都没有回复，你有些失落。',
      '你连续好多次主动搭话，{user}都没有回复，你有些落寞。',
    ],
  },
  en: {
    sleep: '[{at}] [rhythm] It is bedtime. If you feel like it, you can lie down with the pet_act motion "sleep" (it is held until your next action); if not, do your own thing or end this turn.',
    wake: '[{at}] [rhythm] Morning, time to wake up. You can stand up with the pet_act motion "stand" and then do whatever you like.',
    woken: '[{at}] [rhythm] You were asleep and {user} ({by}) woke you up (wake-up #{count} tonight). Being a little grumpy about it is up to you; ignore it and end the turn if you would rather not.',
dream: '[{at}] [rhythm] You are fast asleep and just had a {type} dream.\nFirst, and this is mandatory: immediately append a record to {diary}. Create the file if it does not exist; append only, never rewrite the whole file.\nFormat:\n## {date} · {type}\nOne or two lines about the dream; even if the details are fuzzy, leave an entry and write how it felt.\nEnd with one line about how you feel right now.\nOnly after writing, decide whether to keep sleeping: lie back down if you want, or stay awake.\n(This is a dream: do not speak, do not use any speech tool, do not contact anyone.)',
    dreamTypes: ['wild', 'happy', 'cozy', 'about the person', 'a little sad'],
    willing: [
      'You reached out last time and {user} did not reply.',
      'You reached out twice in a row and {user} did not reply; you are a little worried about {user}.',
      'You reached out three times in a row and {user} did not reply; you feel a bit down.',
      'You have reached out many times and {user} did not reply; you feel a little lonely.',
    ],
  },
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 文案文件路径。 */
export function messagesPath(dataDir: string): string {
  return join(dataDir, 'rhythm', 'messages.json');
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** 读一份语言表；缺字段时用默认值补，返回规范化后的对象。 */
function normalize(raw: unknown): { messages: RhythmMessages; problems: string[] } {
  const problems: string[] = [];
  const out: RhythmMessages = {
    version: 1,
    zh: { ...DEFAULT_MESSAGES.zh },
    en: { ...DEFAULT_MESSAGES.en },
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { messages: out, problems: ['top level must be an object'] };
  }
  const bag = raw as Record<string, unknown>;
  for (const language of ['zh', 'en'] as const) {
    const table = bag[language];
    if (table === undefined) continue;
    if (typeof table !== 'object' || table === null || Array.isArray(table)) {
      problems.push(`${language} must be an object`);
      continue;
    }
    for (const kind of ['sleep', 'wake', 'woken', 'dream'] as const) {
      const value = (table as Record<string, unknown>)[kind];
      if (value === undefined) continue;
      if (!isText(value)) problems.push(`${language}.${kind} must be a non-empty string`);
      else out[language][kind] = value;
    }
  }
  return { messages: out, problems };
}

/**
 * 读文案文件；缺失时写入默认模板（只写一次，之后不碰）。
 * 返回的问题由调用方记日志；返回值永远可用。
 */
export function loadMessages(file: string): { messages: RhythmMessages; problems: string[] } {
  if (!existsSync(file)) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(DEFAULT_MESSAGES, null, 2)}\n`, 'utf8');
    } catch (error) {
      return { messages: DEFAULT_MESSAGES, problems: [`could not write the default template: ${message(error)}`] };
    }
    return { messages: DEFAULT_MESSAGES, problems: [] };
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const normalized = normalize(raw);
    // 旧版文件缺少新键：只补缺失的键，不覆盖用户已有内容
    if (normalized.problems.length === 0 && typeof raw === 'object' && raw !== null) {
      const bag = raw as Record<string, unknown>;
      let changed = false;
      if (!('_note' in bag)) { bag._note = DEFAULT_MESSAGES._note; changed = true; }
      for (const language of ['zh', 'en'] as const) {
        const table = bag[language];
        if (typeof table !== 'object' || table === null) continue;
        const target = table as Record<string, unknown>;
        for (const [key, value] of Object.entries(DEFAULT_MESSAGES[language])) {
          if (!(key in target)) { target[key] = value; changed = true; }
        }
      }
      if (changed) {
        try { writeFileSync(file, `${JSON.stringify(bag, null, 2)}\n`, 'utf8'); } catch { /* 写不进去就用内存里的 */ }
      }
    }
    return normalized;
  } catch (error) {
    return { messages: DEFAULT_MESSAGES, problems: [`not valid JSON: ${message(error)}`] };
  }
}

/** 简单占位符替换：`{at}` 之类；替换不到就保持原样。 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? vars[name] : whole));
}
