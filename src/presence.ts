/**
 * 探测「主人是否在电脑前」。
 *
 * 为什么不用 Electron 的 powerMonitor：Coopanion 的 Core 是主进程 fork 出来的子进程，
 * 子进程里 `require('electron')` 只拿到可执行文件路径。所以走 Windows 本地探测。
 *
 * **默认只查锁屏，不编译任何代码**（避免触发杀软/EDR 的运行时编译检测）：
 *   powershell.exe -NoProfile -NonInteractive -Command "Get-Process -Name LogonUI,LockApp ..."
 * 只读进程名，不写文件、不联网、不改注册表，PS 5.1 完全支持。
 *
 * 需要「键鼠空闲多久」时，可以打开 `full`：用 Add-Type 内联编译 C# 调 user32。
 * 这条路径更准，但会触发运行时编译（杀软常见告警点），所以默认关闭、由用户显式选择；
 * 代码按 C# 5 / Windows PowerShell 5.1 写，不依赖 PowerShell 7。
 */
import { execFile } from 'node:child_process';

export interface Presence {
  /** 锁屏/登录界面在显示 → true；拿不到结论 → null。 */
  locked: boolean | null;
  /** 键鼠空闲秒数；没开 full 模式或拿不到 → null。 */
  idleSeconds: number | null;
  /** 探测完成的时刻（epoch ms）。 */
  at: number;
}

export const UNKNOWN_PRESENCE: () => Presence = () => ({ locked: null, idleSeconds: null, at: Date.now() });

/** 只查锁屏：纯 cmdlet，不编译、不写盘。Win10/11 锁屏时 LogonUI 与 LockApp 至少有一个在跑。 */
const LOCK_SCRIPT = [
  '$ErrorActionPreference = \'SilentlyContinue\'',
  '$procs = Get-Process -Name LogonUI, LockApp -ErrorAction SilentlyContinue',
  'if ($null -ne $procs) { Write-Output \'locked=true\' } else { Write-Output \'locked=false\' }',
].join('; ');

/**
 * 完整探测：锁屏 + 空闲秒数。Add-Type 会编译 C#，默认不用。
 * 与 Coo 的 `workspace/partner/probe.cs` 等价（`OpenInputDesktop` + `GetLastInputInfo`）。
 */
const FULL_SCRIPT = `
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

/** 解析两种脚本的输出；任何缺项都留 null，由调用方当成 unknown。 */
export function parseProbe(stdout: string): { locked: boolean | null; idleSeconds: number | null } {
  let desk: string | null = null;
  let idle: number | null = null;
  let explicitLocked: boolean | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim();
    if (text.startsWith('desktop=')) desk = text.slice('desktop='.length).trim();
    else if (text.startsWith('locked=')) {
      const value = text.slice('locked='.length).trim().toLowerCase();
      if (value === 'true') explicitLocked = true;
      else if (value === 'false') explicitLocked = false;
    } else if (text.startsWith('idle_seconds=')) {
      const value = Number(text.slice('idle_seconds='.length).trim());
      if (Number.isFinite(value) && value >= 0) idle = value;
    }
  }
  if (desk !== null) {
    // 锁屏时输入桌面是 Winlogon；拿不到（err=5）也视为锁屏——与 Coo 的实测一致
    return { locked: desk !== 'Default', idleSeconds: idle };
  }
  return { locked: explicitLocked, idleSeconds: idle };
}

export interface DetectOptions {
  timeoutMs?: number;
  /** true = 用 Add-Type 取空闲秒数（会触发运行时编译）；缺省 false，只查锁屏。 */
  full?: boolean;
}

/**
 * 探测一次；任何失败都返回 unknown，绝不让探测拖慢或打断叫醒。
 * 显式使用 `powershell.exe`（Windows 自带 5.1），不依赖 PowerShell 7；
 * 脚本里不用 `??`、三元等 PS7 语法。
 */
export function detectPresence(opts: DetectOptions = {}): Promise<Presence> {
  if (process.platform !== 'win32') return Promise.resolve(UNKNOWN_PRESENCE());
  const timeoutMs = opts.timeoutMs ?? 2000;
  const script = opts.full ? FULL_SCRIPT : LOCK_SCRIPT;

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
        // 不用 -ExecutionPolicy Bypass：-Command 不受执行策略限制，少一个可疑参数
        ['-NoProfile', '-NonInteractive', '-Command', script],
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
