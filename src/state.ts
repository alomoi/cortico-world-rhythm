/**
 * 运行时状态的持久化。
 *
 * 为什么需要：上游把「这一段安静里已叫醒几次 / 上次叫醒在什么时候」全放在内存里，
 * 进程一重启就归零，「今天叫醒了几次」也无从统计。作息要有连续性，这些得落盘。
 *
 * 不存「最近一次人侧活动」：那个可以从事件库重新算出来（`store.range`），存了反而容易和
 * 事件库打架。落盘只放事件库读不出来的东西：今日次数、本轮轮次、上次叫醒时刻与结果。
 *
 * 文件位置：`<dataDir>/rhythm/state.json`。写入用「临时文件 + rename」的原子替换，
 * 坏文件不删（下次会被覆盖），只在日志里报一句。
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 落盘的状态；字段都可缺省容忍（手改坏了也不至于让 World 起不来）。 */
export interface RhythmState {
  version: 1;
  /** 本地日期 YYYY-MM-DD，用来判断「今日」要不要清零。 */
  dayKey: string;
  /** 今天已经叫醒几次（按投递排队计，被丢弃时回退）。 */
  nudgesToday: number;
  /** 这一段安静里已叫醒几次。 */
  rounds: number;
  /** 连续多少次「主动搭话」没人回应；退避用它，不再用叫醒次数。 */
  unanswered: number;
  /** 上一次叫醒的时刻（ISO）；没有则 null。 */
  lastNudgeAt: string | null;
  /** 上一次叫醒的投递结果；没有则 null。 */
  lastOutcome: 'delivered' | 'discarded' | null;
  /** 上一次结果发生的时刻（ISO）。 */
  lastOutcomeAt: string | null;
  /** 这一夜的睡眠会话：跨重启保留，避免重启后又发一遍「该睡了」。 */
  sleep: SleepSession;
}

/** 一夜的睡眠会话。`nightKey` 是睡眠时段开始那天的日期。 */
export interface SleepSession {
  nightKey: string | null;
  /** 这一夜是否已经投过「该睡了」。 */
  sleepHintSent: boolean;
  /** 这一夜是否已经投过「该醒了」。 */
  wakeHintSent: boolean;
  /** 这一夜被吵醒几次（按合并间隔计）。 */
  wokeCount: number;
  /** 上一次被吵醒的时刻（ISO）与来源事件类型。 */
  lastWokeAt: string | null;
  lastWokeBy: string | null;
  /** 上一次「计数过」的打扰时刻；用来合并同一场聊天。 */
  lastCountedAt: string | null;
  /** 这一夜做梦的计划（入夜时一次掷完）；null = 这一夜不做梦。 */
  dreamPlan: { at: number; type: string } | null;
  /** 这一夜已经做过的梦（含捕获到的正文）。 */
  dreams: Array<{ at: number; type: string; text: string }>;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 状态文件路径。 */
export function stateFilePath(dataDir: string): string {
  return join(dataDir, 'rhythm', 'state.json');
}

/**
 * 部署时区里的本地日期（YYYY-MM-DD）。
 * `timezone` 为空（部署没配时区）时按系统时区；Intl 不接受空字符串。
 */
export function localDayKey(timezone: string, at: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

function emptySleep(): SleepSession {
  return {
    nightKey: null,
    sleepHintSent: false,
    wakeHintSent: false,
    wokeCount: 0,
    lastWokeAt: null,
    lastWokeBy: null,
    lastCountedAt: null,
    dreamPlan: null,
    dreams: [],
  };
}

function emptyState(dayKey: string): RhythmState {
  return {
    version: 1,
    dayKey,
    nudgesToday: 0,
    rounds: 0,
    unanswered: 0,
    lastNudgeAt: null,
    lastOutcome: null,
    lastOutcomeAt: null,
    sleep: emptySleep(),
  };
}

const countOf = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

const isoOf = (value: unknown): string | null =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

const boolOf = (value: unknown): boolean => value === true;

function dreamPlanOf(value: unknown): { at: number; type: string } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const bag = value as Record<string, unknown>;
  const at = typeof bag.at === 'number' && Number.isFinite(bag.at) ? bag.at : 0;
  const type = typeof bag.type === 'string' ? bag.type : '';
  return at > 0 && type ? { at, type } : null;
}

function dreamsOf(value: unknown): Array<{ at: number; type: string; text: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ at: number; type: string; text: string }> = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const bag = item as Record<string, unknown>;
    const at = typeof bag.at === 'number' && Number.isFinite(bag.at) ? bag.at : 0;
    const type = typeof bag.type === 'string' ? bag.type : '';
    const text = typeof bag.text === 'string' ? bag.text : '';
    if (at > 0) out.push({ at, type, text });
  }
  return out;
}

function sleepOf(value: unknown): SleepSession {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return emptySleep();
  const bag = value as Record<string, unknown>;
  return {
    nightKey: typeof bag.nightKey === 'string' ? bag.nightKey : null,
    sleepHintSent: boolOf(bag.sleepHintSent),
    wakeHintSent: boolOf(bag.wakeHintSent),
    wokeCount: countOf(bag.wokeCount),
    lastWokeAt: isoOf(bag.lastWokeAt),
    lastWokeBy: typeof bag.lastWokeBy === 'string' ? bag.lastWokeBy : null,
    lastCountedAt: isoOf(bag.lastCountedAt),
    dreamPlan: dreamPlanOf(bag.dreamPlan),
    dreams: dreamsOf(bag.dreams),
  };
}

/**
 * 读状态。文件不存在是正常情况（第一次运行），不报错。
 * 文件坏了给出 error 文案并退回空状态；跨天时把今日次数清零。
 */
export function loadState(file: string, dayKey: string): { state: RhythmState; error?: string } {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return { state: emptyState(dayKey) };
  }

  let parsed: unknown;
  try {
    // 手改过或别的工具写过 BOM，JSON.parse 会直接拒绝
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (error) {
    return { state: emptyState(dayKey), error: `not valid JSON: ${message(error)}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { state: emptyState(dayKey), error: 'not a JSON object' };
  }

  const bag = parsed as Record<string, unknown>;
  const state: RhythmState = {
    version: 1,
    dayKey: typeof bag.dayKey === 'string' ? bag.dayKey : dayKey,
    nudgesToday: countOf(bag.nudgesToday),
    rounds: countOf(bag.rounds),
    unanswered: countOf(bag.unanswered),
    lastNudgeAt: isoOf(bag.lastNudgeAt),
    lastOutcome: bag.lastOutcome === 'delivered' || bag.lastOutcome === 'discarded' ? bag.lastOutcome : null,
    lastOutcomeAt: isoOf(bag.lastOutcomeAt),
    sleep: sleepOf(bag.sleep),
  };
  if (state.dayKey !== dayKey) {
    state.dayKey = dayKey;
    state.nudgesToday = 0;
  }
  return { state };
}

/**
 * 原子写一份 JSON（临时文件 + rename）。
 *
 * Windows 上 rename 偶尔会撞上 EPERM（杀毒、索引器或别的进程短暂打开了目标文件），
 * 实测凌晨 21:29 就发生过一次。这里重试三次；仍失败就退回直接覆盖写——原子性没了，
 * 但「状态没写进去」比「临时丢了原子性」更糟。两条路都失败才返回错误。
 */
export function writeJsonAtomic(file: string, value: unknown): { error?: string } {
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const tmp = `${file}.tmp`;
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(tmp, payload, 'utf8');
      renameSync(tmp, file);
      return {};
    } catch (error) {
      lastError = message(error);
      try { rmSync(tmp, { force: true }); } catch { /* 清理失败无所谓 */ }
      // 同步小睡 40ms 再试；不引入定时器，避免打乱调用方的时序
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40); } catch { /* 不支持就立刻重试 */ }
    }
  }
  try {
    writeFileSync(file, payload, 'utf8');
    return {};
  } catch (error) {
    return { error: `${message(error)}（rename 失败: ${lastError}）` };
  }
}

/** 写状态；原子替换，失败只返回文案（调用方记日志，不抛）。 */
export function saveState(file: string, state: RhythmState): { error?: string } {
  return writeJsonAtomic(file, state);
}
