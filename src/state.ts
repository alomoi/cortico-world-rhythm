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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
  /** 上一次叫醒的时刻（ISO）；没有则 null。 */
  lastNudgeAt: string | null;
  /** 上一次叫醒的投递结果；没有则 null。 */
  lastOutcome: 'delivered' | 'discarded' | null;
  /** 上一次结果发生的时刻（ISO）。 */
  lastOutcomeAt: string | null;
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

function emptyState(dayKey: string): RhythmState {
  return {
    version: 1,
    dayKey,
    nudgesToday: 0,
    rounds: 0,
    lastNudgeAt: null,
    lastOutcome: null,
    lastOutcomeAt: null,
  };
}

const countOf = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

const isoOf = (value: unknown): string | null =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

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
    lastNudgeAt: isoOf(bag.lastNudgeAt),
    lastOutcome: bag.lastOutcome === 'delivered' || bag.lastOutcome === 'discarded' ? bag.lastOutcome : null,
    lastOutcomeAt: isoOf(bag.lastOutcomeAt),
  };
  if (state.dayKey !== dayKey) {
    state.dayKey = dayKey;
    state.nudgesToday = 0;
  }
  return { state };
}

/** 写状态；原子替换，失败只返回文案（调用方记日志，不抛）。 */
export function saveState(file: string, state: RhythmState): { error?: string } {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    renameSync(tmp, file);
    return {};
  } catch (error) {
    return { error: message(error) };
  }
}
