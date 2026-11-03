/**
 * 探测「主人是否在电脑前」：锁屏 / 键鼠空闲时长。
 *
 * 为什么不用 Electron 的 powerMonitor：Coopanion 的 Core 是主进程 fork 出来的子进程
 * （`core-host.cjs` 里 `fork(core/boot.ts)`），子进程里 `require('electron')` 只拿到可执行文件路径。
 * 所以走 Windows 本地探测：spawn 一个短命 PowerShell，内联 C# 调 user32。
 *
 * 这是 Coo 自己写过的同一套办法（`workspace/partner/probe.cs` + `idle.ps1`），
 * 实测锁屏时 `OpenInputDesktop` 拿不到输入桌面（err=5），据此判 locked。
 *
 * 只读系统状态：不读窗口标题、不截屏、不落盘。
 */
import { execFile } from 'node:child_process';

export interface Presence {
  /** 输入桌面不是 Default（锁屏/登录界面）→ true；拿不到结论 → null。 */
  locked: boolean | null;
  /** 键鼠空闲秒数；拿不到 → null。 */
  idleSeconds: number | null;
  /** 探测完成的时刻（epoch ms）。 */
  at: number;
}

export const UNKNOWN_PRESENCE: () => Presence = () => ({ locked: null, idleSeconds: null, at: Date.now() });

/**
 * 内联的 PowerShell：Add-Type 加载 C#，读输入桌面名与空闲秒数。
 * 与 Coo 的 probe.cs 等价；输出三行 `key=value`，好解析、不依赖 JSON。
 */
const PROBE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class RhythmProbe {
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool CloseDesktop(IntPtr h);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool GetUserObjectInformation(IntPtr hObj, int index, StringBuilder info, int len, out int needed);
  public static double IdleSeconds() {
    LASTINPUTINFO li = new LASTINPUTINFO();
    li.cbSize = (uint)Marshal.SizeOf(li);
    if (!GetLastInputInfo(ref li)) return -1;
    return (Environment.TickCount - (int)li.dwTime) / 1000.0;
  }
  public static string InputDesktop() {
    IntPtr h = OpenInputDesktop(0, false, 0x0100);
    if (h == IntPtr.Zero) return "unavailable";
    try {
      int needed;
      StringBuilder sb = new StringBuilder(256);
      if (!GetUserObjectInformation(h, 2, sb, sb.Capacity, out needed)) return "unknown";
      return sb.ToString();
    } finally { CloseDesktop(h); }
  }
}
"@
$desk = [RhythmProbe]::InputDesktop()
$idle = [RhythmProbe]::IdleSeconds()
Write-Output "desktop=$desk"
Write-Output "idle_seconds=$idle"
`;

function parseProbe(stdout: string): { locked: boolean | null; idleSeconds: number | null } {
  let desk: string | null = null;
  let idle: number | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim();
    if (text.startsWith('desktop=')) desk = text.slice('desktop='.length).trim();
    else if (text.startsWith('idle_seconds=')) {
      const value = Number(text.slice('idle_seconds='.length).trim());
      if (Number.isFinite(value) && value >= 0) idle = value;
    }
  }
  if (desk === null) return { locked: null, idleSeconds: idle };
  // 锁屏时输入桌面是 Winlogon；拿不到（err=5）也视为锁屏——这与 Coo 的实测一致
  const locked = desk !== 'Default';
  return { locked, idleSeconds: idle };
}

/**
 * 探测一次；任何失败都返回 unknown，绝不让探测拖慢或打断叫醒。
 * 超时也当作 unknown：宁可不知道，也不要误判「主人不在」。
 */
export function detectPresence(timeoutMs = 2000): Promise<Presence> {
  if (process.platform !== 'win32') return Promise.resolve(UNKNOWN_PRESENCE());
  return new Promise((resolve) => {
    let settled = false;
    const done = (presence: Presence): void => {
      if (settled) return;
      settled = true;
      resolve(presence);
    };
    try {
      const child = execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PROBE_SCRIPT],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 },
        (error, stdout) => {
          if (error) {
            done(UNKNOWN_PRESENCE());
            return;
          }
          const parsed = parseProbe(String(stdout ?? ''));
          done({ ...parsed, at: Date.now() });
        },
      );
      child.on('error', () => done(UNKNOWN_PRESENCE()));
    } catch {
      done(UNKNOWN_PRESENCE());
    }
  });
}
