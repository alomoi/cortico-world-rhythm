/**
 * 从事件里提取「最近这段对话」的事实，以及引用文本的净化。
 *
 * 两个原则：
 * 1. **只给事实**：谁最后说话、它上次开口有没有被接；原话只在「上下文可能丢了」时才用。
 * 2. **只读已经进过上下文的 text**，不碰 meta 里的原始报文；引用前把渠道标记剥掉，
 *    免得把一个渠道的表情语法带进另一个渠道（主人反馈过符号露出的问题）。
 */
import type { EventEnvelope } from 'cortico/core/types.ts';

/** 引用最多保留多少个字（超出加省略号）。 */
export const MAX_QUOTE_CHARS = 40;

export interface ThreadLine {
  /** epoch ms。 */
  at: number;
  text: string;
}

export interface Thread {
  /** 最后一条人侧消息。 */
  lastUser: ThreadLine | null;
  /** 它自己最后一次「说话」的事件（桌宠/控制台的 self 记录）。 */
  lastSelf: (ThreadLine & { answered: boolean }) | null;
}

/** 渠道标记：`【表情,动作】`、`<wink>`、`sticker:xx`、附件占位。 */
const MARKERS: readonly RegExp[] = [
  /【[^】]{0,80}】/g,
  /<[^>\n]{1,24}>/g,
  /sticker:[^\s,，。；:：]+/gi,
  /\[blob [^\]]{0,80}\]/g,
];

/** 去掉开头的时间前缀，例如 `[23:41] `。 */
const TIME_PREFIX = /^\[[\d:]{3,8}\]\s*/;

/**
 * 净化一段引用：剥掉渠道标记与时间前缀，压平空白，按字符数截断。
 * 全是标记时返回空串——调用方据此决定「这条不值得引用」。
 */
export function sanitizeQuote(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let text = raw.replace(TIME_PREFIX, '');
  for (const pattern of MARKERS) text = text.replace(pattern, '');
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const chars = [...text];
  return chars.length <= MAX_QUOTE_CHARS ? text : `${chars.slice(0, MAX_QUOTE_CHARS).join('')}…`;
}

/** 从 `.self` 事件里取它说的话；`meta.beats` 是桌宠的逐句记录。 */
function selfSpeechText(event: EventEnvelope): string {
  const meta = (event.meta ?? {}) as Record<string, unknown>;
  // 只有 say/ask 算「说话」；activity（工具动作）不算
  if (meta.kind !== 'say' && meta.kind !== 'ask') return '';
  const beats = meta.beats;
  if (Array.isArray(beats)) {
    const parts: string[] = [];
    for (const beat of beats) {
      if (!beat || typeof beat !== 'object') continue;
      const text = (beat as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim()) parts.push(text);
    }
    if (parts.length) return parts.join(' ');
  }
  if (typeof meta.question === 'string' && meta.question.trim()) return meta.question;
  return typeof event.text === 'string' ? event.text : '';
}

/**
 * 从事件序列里取最近一条人侧消息与最后一条自述发言。
 * `isPerson` 与叫醒判定共用同一套（渠道无关），保证口径一致。
 */
export function buildThread(
  events: readonly EventEnvelope[],
  opts: { isPerson: (event: EventEnvelope) => boolean },
): Thread {
  let lastUser: ThreadLine | null = null;
  let lastSelf: (ThreadLine & { answered: boolean }) | null = null;

  for (const event of events) {
    const at = Date.parse(event.ts);
    if (!Number.isFinite(at)) continue;

    if (opts.isPerson(event)) {
      const text = sanitizeQuote(event.text);
      if (text && (!lastUser || at >= lastUser.at)) lastUser = { at, text };
      continue;
    }
    if (!event.type.endsWith('.self')) continue;
    const text = sanitizeQuote(selfSpeechText(event));
    if (!text) continue;
    if (!lastSelf || at >= lastSelf.at) lastSelf = { at, text, answered: false };
  }

  // 它说完之后有人接话 → 不算「没人接」
  if (lastSelf && lastUser && lastUser.at > lastSelf.at) lastSelf.answered = true;
  return { lastUser, lastSelf };
}
