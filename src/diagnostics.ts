/**
 * 诊断模式（默认关）：把「它为什么在这个时刻做了这个决定」写成可分享的文件。
 *
 * 打开后写两个文件（都在 `<dataDir>/rhythm/` 下）：
 * - `diagnostics.json`：当前版本、配置快照、状态、最近决策日志——用户直接发给我们即可；
 * - `debug.log`：逐条追加的决策日志，超过 256 KB 自动轮转成 `debug.log.1`。
 *
 * 不含聊天正文、不含主人说的话；只包含时机、计数、配置与事件类型。
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeJsonAtomic } from './state.ts';

const DEBUG_LOG_LIMIT = 256 * 1024;

/** 插件版本：从 package.json 读，读不到就退回 0.0.0。 */
export function pluginVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8').replace(/^\uFEFF/, '');
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function diagnosticsPath(dataDir: string): string {
  return join(dataDir, 'rhythm', 'diagnostics.json');
}

export function debugLogPath(dataDir: string): string {
  return join(dataDir, 'rhythm', 'debug.log');
}

/** 追加一行诊断日志；文件过大时轮转。写不进去就算了，绝不影响主流程。 */
export function appendDebugLine(dataDir: string, line: string): void {
  const file = debugLogPath(dataDir);
  try {
    mkdirSync(dirname(file), { recursive: true });
    try {
      if (statSync(file).size > DEBUG_LOG_LIMIT) renameSync(file, `${file}.1`);
    } catch {
      // 文件还不存在：第一次写
    }
    appendFileSync(file, `${line}\n`, 'utf8');
  } catch {
    // 诊断失败不影响叫醒
  }
}

export function writeDiagnostics(dataDir: string, payload: unknown): { error?: unknown } {
  try {
    mkdirSync(join(dataDir, 'rhythm'), { recursive: true });
  } catch {
    // 目录建不出来时交给 writeJsonAtomic 报错
  }
  return writeJsonAtomic(diagnosticsPath(dataDir), payload);
}
