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

export type HintKind = 'sleep' | 'wake' | 'woken';

export interface RhythmMessages {
  version: 1;
  zh: Record<HintKind, string>;
  en: Record<HintKind, string>;
}

/** 内置默认值：文件缺失时写到磁盘，也是文件损坏时的兜底。 */
export const DEFAULT_MESSAGES: RhythmMessages = {
  version: 1,
  zh: {
    sleep: '[{at}] [作息] 到睡觉时间了。想睡的话可以用 pet_act 的 sleep 动作躺下（它会保持到你下一次动作）；不想睡就做自己的事，或者结束这一轮。',
    wake: '[{at}] [作息] 早上好，醒醒神。想动一动可以用 pet_act 的 stand 站起来，然后想做什么就做什么。',
    woken: '[{at}] [作息] 你刚才在睡觉，被 {by} 吵醒了（今夜第 {count} 次）。要不要带点起床气，你自己决定；不想理就结束这一轮。',
  },
  en: {
    sleep: '[{at}] [rhythm] It is bedtime. If you feel like it, you can lie down with the pet_act motion "sleep" (it is held until your next action); if not, do your own thing or end this turn.',
    wake: '[{at}] [rhythm] Morning, time to wake up. You can stand up with the pet_act motion "stand" and then do whatever you like.',
    woken: '[{at}] [rhythm] You were asleep and {by} woke you up (wake-up #{count} tonight). Being a little grumpy about it is up to you; ignore it and end the turn if you would rather not.',
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
    for (const kind of ['sleep', 'wake', 'woken'] as const) {
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
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return normalize(raw);
  } catch (error) {
    return { messages: DEFAULT_MESSAGES, problems: [`not valid JSON: ${message(error)}`] };
  }
}

/** 简单占位符替换：`{at}` 之类；替换不到就保持原样。 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? vars[name] : whole));
}
