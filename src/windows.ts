/**
 * 作息时段的解析与判定（纯函数，方便直接测）。
 *
 * 设计取舍：配置 schema 只能渲染标量，放不下「对象数组」，所以时段用字符串写：
 *   sleepWindow: "22:00-08:00"                  （留空 = 不启用）
 *   restWindows: "12:30-14:00, 18:00-18:30"     （逗号/分号/换行分隔，留空 = 没有）
 * 结束 ≤ 开始表示跨午夜。`start === end` 视为非法（长度为零的窗口没有意义）。
 *
 * 时间一律按部署时区的墙钟分钟算：不做 DST 的插值，跨夏令时那天最多偏一小时，
 * 对「夜里别叫」这个用途无感。
 */

/** 一个时段窗口，单位为「当天第几分钟」，区间左闭右开：[start, end)。 */
export interface ClockWindow {
  start: number;
  end: number;
  /** 原始写法，日志与状态灯用。 */
  raw: string;
}

const HH_MM = /^(\d{1,2}):(\d{2})$/;

/** `"9:00"` / `"09:00"` → 当天第几分钟；非法返回 null。 */
export function parseClock(raw: string): number | null {
  const match = HH_MM.exec(raw.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 分钟数 → `"08:00"`。 */
export function formatClock(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

/** `"22:00-08:00"` → 窗口；非法返回 null。 */
export function parseWindow(raw: string): ClockWindow | null {
  const text = raw.trim();
  const dash = text.indexOf('-');
  if (dash <= 0) return null;
  const start = parseClock(text.slice(0, dash));
  const end = parseClock(text.slice(dash + 1));
  if (start === null || end === null) return null;
  // 长度为零的窗口没有意义：start === end 会让「跨午夜」和「空窗口」无法区分
  if (start === end) return null;
  return { start, end, raw: text };
}

/**
 * 解析一组时段（逗号、分号或换行分隔）。
 * 非法条目跳过并给出可读的错误，而不是让整个配置失效。
 */
export function parseWindowList(raw: unknown): { windows: ClockWindow[]; errors: string[] } {
  if (typeof raw !== 'string' || raw.trim() === '') return { windows: [], errors: [] };
  const windows: ClockWindow[] = [];
  const errors: string[] = [];
  for (const piece of raw.split(/[,;\n]/)) {
    const text = piece.trim();
    if (!text) continue;
    const window = parseWindow(text);
    if (window) windows.push(window);
    else errors.push(`"${text}" 不是合法的时段（要写成 HH:MM-HH:MM，例如 22:00-08:00）`);
  }
  return { windows, errors };
}

/** 部署时区的墙钟分钟（0–1439）。时区为空时按系统时区。 */
export function minutesOfDay(nowMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || undefined,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const pick = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  // Intl 在部分语言/实现下把午夜给成 24 时，归一化一下
  return (pick('hour') % 24) * 60 + pick('minute');
}

/** 当前时刻是否落在窗口内（左闭右开，支持跨午夜）。 */
export function inWindow(minuteOfDay: number, window: ClockWindow): boolean {
  return window.end > window.start
    ? minuteOfDay >= window.start && minuteOfDay < window.end
    : minuteOfDay >= window.start || minuteOfDay < window.end;
}

/** 第一个包含当前时刻的窗口；没有则 null。 */
export function matchWindow(minuteOfDay: number, windows: readonly ClockWindow[]): ClockWindow | null {
  for (const window of windows) {
    if (inWindow(minuteOfDay, window)) return window;
  }
  return null;
}

/** 窗口剩余的分钟数（至少 1），用来在状态灯里说「还有多久结束」。 */
export function minutesUntilWindowEnd(minuteOfDay: number, window: ClockWindow): number {
  const remaining = (window.end - minuteOfDay + 1440) % 1440;
  return remaining === 0 ? 0 : remaining;
}
