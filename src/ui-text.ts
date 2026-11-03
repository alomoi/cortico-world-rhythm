/**
 * 人读的界面文案（World 名、配置组标题与说明、状态灯），中文与英文两版。
 * 与模型读到的正文（model-text.ts）分开：这里只给控制台看。
 */
import type { Language } from 'cortico/core/language.ts';

/** 状态灯要显示的事实；由 World 现算，文案在这里按语言渲染。 */
export interface LampInfo {
  /** 0 = 计时关闭。 */
  quietMinutes: number;
  /** 0 = 不限。 */
  maxRounds: number;
  nudgesToday: number;
  /** 距下次叫醒还有几分钟（向上取整）；本轮已到上限、或不在可叫醒时段时为 null。 */
  nextInMinutes: number | null;
  /** 这一段安静里叫醒次数已达上限。 */
  capped: boolean;
  /** 每日上限；0 = 不限。 */
  dailyCap: number;
  /** 今天的次数已经用满。 */
  capReached: boolean;
  /** 当前是否处在不叫醒的时段。 */
  windowKind: 'sleep' | 'rest' | null;
  /** 该时段的结束时刻 `HH:MM`。 */
  windowEndsAt: string | null;
  /** 影子模式：只算不发。 */
  shadow: boolean;
}

export interface RhythmUi {
  label: string;
  configTitle: string;
  configDescription: string;
  quietTitle: string;
  quietDescription: string;
  repeatTitle: string;
  repeatDescription: string;
  maxRoundsTitle: string;
  maxRoundsDescription: string;
  jitterTitle: string;
  jitterDescription: string;
  sleepTitle: string;
  sleepDescription: string;
  restTitle: string;
  restDescription: string;
  dailyCapTitle: string;
  dailyCapDescription: string;
  backoffAfterTitle: string;
  backoffAfterDescription: string;
  backoffFactorTitle: string;
  backoffFactorDescription: string;
  backoffMaxTitle: string;
  backoffMaxDescription: string;
  sleepHintTitle: string;
  sleepHintDescription: string;
  wakeHintTitle: string;
  wakeHintDescription: string;
  wakeGapTitle: string;
  wakeGapDescription: string;
  wakeHintSecondsTitle: string;
  wakeHintSecondsDescription: string;
  knownChannelsTitle: string;
  knownChannelsDescription: string;
  activityIgnoreTitle: string;
  activityIgnoreDescription: string;
  onlyWhenIdleTitle: string;
  onlyWhenIdleDescription: string;
  /** 状态灯的名字（悬停标题）。 */
  lampLabel: string;
  /** 「搭话」工具名单的标题与说明（退避只数这些）。 */
  speakToolsTitle: string;
  speakToolsDescription: string;
  speakIgnoreTitle: string;
  speakIgnoreDescription: string;
  speakAnywhereTitle: string;
  speakAnywhereDescription: string;
  channelAliasesTitle: string;
  channelAliasesDescription: string;
  verifyReceiptsTitle: string;
  verifyReceiptsDescription: string;
  awayDetectionTitle: string;
  awayDetectionDescription: string;
  awayIdleTitle: string;
  awayIdleDescription: string;
  pauseLockedTitle: string;
  pauseLockedDescription: string;
  awayHintTitle: string;
  awayHintDescription: string;
  awayIdleProbeTitle: string;
  awayIdleProbeDescription: string;
  dryRunTitle: string;
  dryRunDescription: string;
  contextAwareTitle: string;
  contextAwareDescription: string;
  contextQuotesTitle: string;
  contextQuotesDescription: string;
  contextStaleTitle: string;
  contextStaleDescription: string;
  /** 状态灯悬停说明。 */
  lampHint: (info: LampInfo) => string;
  /** 计时关闭时的悬停说明。 */
  lampOff: string;
  /** 徽标名：今日叫醒次数。 */
  badgeToday: string;
}

const zh: RhythmUi = {
  label: '作息',
  configTitle: '作息',
  configDescription: '安静一段时间后叫醒 Coo，让它自己决定说不说话、做点什么，慢慢过上自己的日子。改这里立即生效。',
  quietTitle: '安静多少分钟后叫醒',
  quietDescription: '没有人跟 Coo 说话多久之后叫醒它一次；0 表示关掉叫醒。',
  repeatTitle: '再次叫醒间隔',
  repeatDescription: '叫醒一次之后还是没有人说话，隔多少分钟再叫醒一次。',
  maxRoundsTitle: '最多叫醒几次',
  maxRoundsDescription: '对方一直不说话时，一段安静里最多叫醒几次；0 表示不限；对方一说话就重新计数。',
  jitterTitle: '间隔浮动',
  jitterDescription: '让每个间隔都不那么固定：每次在基准的 1–(1+浮动) 倍之间随机，只往后偏、不会比基准短。0 表示不浮动。',
  sleepTitle: '睡眠时段',
  sleepDescription: '格式 HH:MM-HH:MM，例如 22:00-08:00；结束早于开始表示跨午夜。留空表示不启用睡眠时段。',
  restTitle: '休息时段（可写多个）',
  restDescription: '逗号分隔，每段 HH:MM-HH:MM，例如 12:30-14:00, 18:00-18:30；留空表示没有休息时段。删掉某段就代表不再休息。',
  dailyCapTitle: '每日叫醒上限',
  dailyCapDescription: '一天（按部署时区）最多主动叫醒几次；0 表示不限。',
  backoffAfterTitle: '连续几次没人理后开始变稀',
  backoffAfterDescription: '叫醒之后一直没人说话，连续这么多次之后，再次叫醒的间隔按倍数拉长；对方一说话就恢复。0 表示不启用。',
  backoffFactorTitle: '变稀倍数',
  backoffFactorDescription: '每多一次没人回应，间隔乘这个数（1.0–3.0）。例如 1.5 表示每次延长一半。',
  backoffMaxTitle: '变稀封顶',
  backoffMaxDescription: '间隔最多拉长到基准的多少倍（1–10），防止越等越久。',
  sleepHintTitle: '睡眠时段给 Coo 提示',
  sleepHintDescription: '到点发一句「该睡了」、早上发一句「该醒了」，让 Coo 自己决定用不用 pet_act 躺下或站起来。文案在 data/rhythm/messages.json 里改。只在启用了睡眠时段时生效。',
  wakeHintTitle: '被吵醒时提示 Coo',
  wakeHintDescription: '睡眠时段里有人来找 Coo 时，搭着这一轮给它一句「你被吵醒了」，由它自己决定要不要有点起床气。超过 90 秒没搭上车就作废，不会事后突然冒出来。',
  wakeGapTitle: '同一场打扰的合并间隔',
  wakeGapDescription: '这几分钟内连续来的消息只算一次「被吵醒」；超过它再来人才算又一次。缺省 30 分钟。',
  wakeHintSecondsTitle: '「被吵醒」提示的保鲜期（秒）',
  wakeHintSecondsDescription: '这条提示只在这么多秒内能搭上正在进行的那一轮；超过就作废，不会在对话结束后突然冒出来。缺省 90 秒。',
  knownChannelsTitle: '只把桌宠和控制台当成有人',
  knownChannelsDescription: '打开后只认桌宠与控制台的旧事件清单（旧版本行为），微信、QQ 等其他渠道的消息不算“有人回来了”。默认关闭：任何渠道的人侧事件都算。',
  activityIgnoreTitle: '不算“有人回来了”的事件类型',
  activityIgnoreDescription: '逗号分隔，可写多个；以 * 结尾表示前缀匹配（例如 qq.system*）。一般留空即可。',
  onlyWhenIdleTitle: '只在 Coo 空闲时叫醒',
  onlyWhenIdleDescription: '它正在跑模型或执行工具时先不叫醒，等这一轮结束。默认打开，避免打断它手上的事。',
  lampLabel: '叫醒计时',
  speakToolsTitle: '哪些工具算「主动搭话」',
  speakToolsDescription: '额外认定为「搭话」的工具名，逗号分隔。一般不用填：插件推过用户消息时，它的说话工具（如 qq_send）会被自动认出来；命名不按约定的才需要手动补。',
  speakIgnoreTitle: '不算「搭话」的工具名单',
  speakIgnoreDescription: '误判时用来排除，逗号分隔，优先于自动识别。例如游戏里喊话的 minecraft_say。',
  speakAnywhereTitle: '宽松匹配工具名',
  speakAnywhereDescription: '打开后只要工具名里出现说话动词（send/say/reply…）就算搭话，不管前缀。能兜住 sendMsgToWechat 这种乱名，但误判率更高，默认关。',
  channelAliasesTitle: '渠道别名',
  channelAliasesDescription: '把事件前缀换成更好读的名字，例如 clawbridge=微信、qq=QQ；只影响提示文案里的渠道名。',
  verifyReceiptsTitle: '核对发送回执',
  verifyReceiptsDescription: '叫醒后如果它调用了发送工具，去会话记录里核对回执：回执写着失败（如微信 24 小时窗口过期），这一轮就不计入退避。默认开。',
  dryRunTitle: '影子模式（只算不发）',
  dryRunDescription: '打开后照常计算什么时候该叫、正文长什么样，但只写日志和状态文件，不投递任何事件。用来在真机上验证排程而不打扰桌宠。',
  awayDetectionTitle: '探测主人在不在电脑前',
  awayDetectionDescription: '叫醒时查一次锁屏与键鼠空闲（仅 Windows），把结果写进正文；探测失败就当不知道。',
  awayIdleTitle: '多久没输入算「可能在忙」',
  awayIdleDescription: '超过这么多分钟没有键鼠输入，就在正文里提示「可能在忙」。缺省 10 分钟。',
  pauseLockedTitle: '锁屏时不叫醒',
  pauseLockedDescription: '打开后，屏幕锁着时跳过这次叫醒，等解锁后的下一拍再说。默认关——锁屏时它可能更想用微信找你。',
  awayHintTitle: '把探测结果写进正文',
  awayHintDescription: '关掉后只写日志、不改正文。',
  awayIdleProbeTitle: '额外探测键鼠空闲（会编译代码）',
  awayIdleProbeDescription: '⚠ 默认只查锁屏（纯 cmdlet，不编译）。打开后会调用 Add-Type 现场编译 C# 读取键鼠空闲秒数：更准确，但属于运行时编译，可能被杀毒/EDR 拦截或告警，首次约 1 秒。如果你的安全软件拦截，请保持关闭——锁屏检测仍然有效。',
  contextAwareTitle: '叫醒时带上最近对话的事实',
  contextAwareDescription: '告诉 Coo「安静了多久、它上次开口有没有被接」。默认开；关掉就回到最朴素的叫醒。',
  contextQuotesTitle: '上下文可能丢失时引用原话',
  contextQuotesDescription: '只在交接后或安静很久时，引用最近一两句原话（40 字内，会剥掉渠道标记）。默认开。',
  contextStaleTitle: '多久算「上下文可能丢了」',
  contextStaleDescription: '安静超过这么多分钟就允许引用原话。缺省 120 分钟。',
  lampHint: (info) => {
    const prefix = info.shadow ? '［影子］' : '';
    if (info.windowKind === 'sleep') {
      return prefix + `在线：睡眠时段（${info.windowEndsAt} 醒）· 今日 ${info.nudgesToday} 次。`;
    }
    if (info.windowKind === 'rest') {
      return prefix + `在线：休息时段（${info.windowEndsAt} 恢复）· 今日 ${info.nudgesToday} 次。`;
    }
    if (info.capReached) {
      return prefix + `在线：今日已达上限 ${info.dailyCap} 次，明天再叫。`;
    }
    if (info.capped) {
      return prefix + `在线：本轮已叫醒 ${info.maxRounds} 次，等有人说话后重新计时（今日 ${info.nudgesToday} 次）。`;
    }
    if (info.nextInMinutes !== null) {
      const cap = info.dailyCap > 0 ? `，今日上限 ${info.dailyCap} 次` : '';
      return prefix + `在线：约 ${info.nextInMinutes} 分钟后叫醒 Coo（今日 ${info.nudgesToday} 次${cap}）。`;
    }
    return prefix + `在线：等安静满 ${info.quietMinutes} 分钟再叫醒（今日 ${info.nudgesToday} 次）。`;
  },
  lampOff: '在线：安静计时已关闭。',
  badgeToday: '今日叫醒',
};

const en: RhythmUi = {
  label: 'Rhythm',
  configTitle: 'Rhythm',
  configDescription: 'After a quiet stretch the app wakes the bot so it can decide for itself whether to speak or do something, and slowly settle into a life of its own. Changes apply immediately.',
  quietTitle: 'Wake after quiet minutes',
  quietDescription: 'How long nobody talks to the bot before it is woken once; 0 turns the timer off.',
  repeatTitle: 'Wake again after',
  repeatDescription: 'Minutes before it is woken again when the quiet continues.',
  maxRoundsTitle: 'At most how many wake-ups',
  maxRoundsDescription: 'Wake-ups per quiet stretch; 0 means no limit; talking to the bot starts the count over.',
  jitterTitle: 'Interval jitter',
  jitterDescription: 'Every interval is drawn between 1 and 1+jitter times its base, always longer, never shorter. 0 turns the jitter off.',
  sleepTitle: 'Sleep window',
  sleepDescription: 'HH:MM-HH:MM, e.g. 22:00-08:00; an end earlier than the start wraps past midnight. Leave empty to disable the sleep window.',
  restTitle: 'Rest windows (several allowed)',
  restDescription: 'Comma-separated HH:MM-HH:MM entries, e.g. 12:30-14:00, 18:00-18:30. Leave empty for none. Delete an entry to drop that rest.',
  dailyCapTitle: 'Daily wake-up cap',
  dailyCapDescription: 'How many proactive wake-ups per day (deployment timezone); 0 means no limit.',
  backoffAfterTitle: 'Start slowing after how many ignored wake-ups',
  backoffAfterDescription: 'After this many consecutive unanswered wake-ups the repeat interval starts stretching; talking to the bot resets it. 0 disables backoff.',
  backoffFactorTitle: 'Slow-down factor',
  backoffFactorDescription: 'Each extra unanswered wake-up multiplies the interval by this (1.0–3.0).',
  backoffMaxTitle: 'Slow-down cap',
  backoffMaxDescription: 'The interval never stretches beyond this multiple of its base (1–10).',
  sleepHintTitle: 'Sleep messages to the bot',
  sleepHintDescription: 'One "go to sleep" at the start of the window and one "wake up" at the end, so the bot may lie down or stand up with pet_act. Edit the wording in data/rhythm/messages.json. Only active when a sleep window is set.',
  wakeHintTitle: 'Tell the bot it was woken',
  wakeHintDescription: 'When someone talks to it during the sleep window, a "you were woken up" line rides along with that turn; being grumpy is its own call. Dropped if it cannot join within 90 seconds, so it never shows up late.',
  wakeGapTitle: 'Merge window for one interruption',
  wakeGapDescription: 'Messages inside this many minutes count as one wake-up; a new one starts after that. 30 minutes by default.',
  wakeHintSecondsTitle: 'How long the "you were woken" hint stays fresh (s)',
  wakeHintSecondsDescription: 'It can only join a turn that starts within this many seconds; after that it is dropped, so it never shows up once the conversation is over. 90 seconds by default.',
  knownChannelsTitle: 'Only the pet and console count as a person',
  knownChannelsDescription: 'Uses the old whitelist: only desktop-pet and console events count as "somebody came back". Messages from WeChat, QQ and other channels are ignored. Off by default: person-side events from every channel count.',
  activityIgnoreTitle: 'Event types that are not "somebody came back"',
  activityIgnoreDescription: 'Comma-separated; a trailing * matches a prefix (e.g. qq.system*). Usually leave empty.',
  onlyWhenIdleTitle: 'Only wake the bot while it is idle',
  onlyWhenIdleDescription: 'Skips the wake-up while the model or a tool is running, and waits for the turn to end. On by default so it never interrupts itself.',
  lampLabel: 'Wake timer',
  speakToolsTitle: 'Which tools count as "reaching out"',
  speakToolsDescription: 'Extra tool names treated as reaching out, comma-separated. Usually empty: once a plugin has pushed a person-side event, its speak tools (e.g. qq_send) are recognised automatically. Add names only for plugins that do not follow the convention.',
  speakIgnoreTitle: 'Tools that never count as reaching out',
  speakIgnoreDescription: 'Comma-separated; wins over everything else. Use it when something like minecraft_say is misread as talking to the person.',
  speakAnywhereTitle: 'Loose tool-name matching',
  speakAnywhereDescription: 'When on, any tool name containing a speech verb (send/say/reply…) counts, whatever its prefix. Catches names like sendMsgToWechat but misreads more often. Off by default.',
  channelAliasesTitle: 'Channel aliases',
  channelAliasesDescription: 'Readable names for event prefixes, e.g. clawbridge=WeChat, qq=QQ. Only affects the wording of prompts.',
  verifyReceiptsTitle: 'Verify send receipts',
  verifyReceiptsDescription: 'After a wake-up, checks the tool receipt in the session record. A failed send (e.g. the WeChat 24h window expired) does not count towards backoff. On by default.',
  dryRunTitle: 'Shadow mode (plan only)',
  dryRunDescription: 'Computes when it would wake and what it would say, but only writes logs and the status file - nothing is delivered. Use it to verify the schedule on the real machine without disturbing the pet.',
  awayDetectionTitle: 'Detect whether the person is at the computer',
  awayDetectionDescription: 'Checks lock state and idle time once per wake-up (Windows only) and puts the result in the prompt. A failed probe counts as unknown.',
  awayIdleTitle: 'Idle minutes before saying the person may be busy',
  awayIdleDescription: 'With no mouse or keyboard input for this long, the prompt mentions it. 10 minutes by default.',
  pauseLockedTitle: 'Do not wake while the screen is locked',
  pauseLockedDescription: 'Skips the wake-up while locked and waits for the next tick after unlocking. Off by default: it may prefer WeChat when you are away.',
  awayHintTitle: 'Put the probe result in the prompt',
  awayHintDescription: 'When off, the result only goes to the log.',
  awayIdleProbeTitle: 'Also probe keyboard/mouse idle time (compiles code)',
  awayIdleProbeDescription: 'Warning: by default only the lock state is checked with plain cmdlets. Turning this on uses Add-Type to compile C# at runtime and read keyboard/mouse idle seconds. More precise, but runtime compilation may be blocked or flagged by antivirus/EDR, and the first call takes about a second. Keep it off if your security software complains; lock detection still works.',
  contextAwareTitle: 'Tell the bot the recent facts',
  contextAwareDescription: 'Includes how long it has been quiet and whether its last outreach was answered. On by default; off gives the plain wake-up.',
  contextQuotesTitle: 'Quote the last lines when context may be stale',
  contextQuotesDescription: 'Only after a context handoff or a long quiet stretch, quotes one or two recent lines (40 chars, channel markers stripped). On by default.',
  contextStaleTitle: 'How quiet counts as stale context',
  contextStaleDescription: 'Quiet minutes after which quoting is allowed. 120 by default.',
  lampHint: (info) => {
    const prefix = info.shadow ? '[shadow] ' : '';
    if (info.windowKind === 'sleep') {
      return prefix + `Online: sleep window (awake at ${info.windowEndsAt}) · ${info.nudgesToday} today.`;
    }
    if (info.windowKind === 'rest') {
      return prefix + `Online: rest window (back at ${info.windowEndsAt}) · ${info.nudgesToday} today.`;
    }
    if (info.capReached) {
      return prefix + `Online: daily cap of ${info.dailyCap} reached; more tomorrow.`;
    }
    if (info.capped) {
      return prefix + `Online: ${info.maxRounds} wake-ups this stretch; the clock restarts when someone speaks (${info.nudgesToday} today).`;
    }
    if (info.nextInMinutes !== null) {
      const cap = info.dailyCap > 0 ? `, cap ${info.dailyCap}/day` : '';
      return prefix + `Online: next wake-up in about ${info.nextInMinutes} min (${info.nudgesToday} today${cap}).`;
    }
    return prefix + `Online: waiting for ${info.quietMinutes} quiet minutes (${info.nudgesToday} today).`;
  },
  lampOff: 'Online: the quiet timer is off.',
  badgeToday: 'Wakes today',
};

/** 界面文案语言：zh 与 zh-Hant 用中文，其余（含未指明）用英文，与 Coopanion 的界面语言取法一致。 */
export function uiText(language: Language | undefined): RhythmUi {
  return language === 'zh' || language === 'zh-Hant' || language === undefined ? zh : en;
}
