# Changelog

## 1.0.7

- 场景感知：锁屏与空闲互斥——锁屏只写「不在电脑前（屏幕锁着）」，没锁屏且空闲达到阈值才写「电脑已经 N 分钟没动过了，{user}或许不在电脑前」。

## 1.0.6

- 市场简介：cortico.locales 中英双语改为与顶层一致的「什么时候主动搭话、什么时候安静、什么时候睡觉和休息、有时还会做梦」。

## 1.0.5 · 市场准备

- 新增 256×256 图标 `icon.png`（月亮下打瞌睡的小肥鱼）。
- `package.json`：作者改为「大肥鱼」，contributors 保留上游；新增 `cortico.icon` 与中英双语 `locales`；`private: false` + `publishConfig.access: public`。
- 重写 README 为面向用户的说明：功能、六张设置卡片、边界、隐私、离线安装、上游致谢与作者碎碎念。
- 新增离线安装：`*-offline.tgz` + `install.bat` / `install.ps1`，不需要联网。
- 修复：有梦时「梦的信息」插在醒来提示的开头之后、行为选项之前，不会被「结束这一轮」挡在后面。
- 源码加入一条作者的彩蛋注释。

## 1.0.4 · 提示词收紧

- 「该睡了 / 该醒了」改为「说话或动作，二选一，然后结束这一轮」，不再保留「做自己的事」；去掉 `pet_act` 工具名，避免工具改名后失效。
- 做梦模板改用 `{date} · {type}梦` 占位符，明确只写两条分隔线之间的内容；写日记不算对外沟通；写完后保持睡姿并结束这一轮。
- 提示词里的用户称呼统一为 `{user}`；梦的类型增加到 11 种（荒诞 / 冒险 / 怀旧 / 食物 / 紧张 / 安静 / 关于{user} 等）。

## 1.0.3 · 更接近自然作息

- `dreamEnabled` 与 `willingnessEnabled` 改为默认开启。

## 1.0.2 · 设置文案整理

- 称呼统一为「桌宠」；被吵醒提示改为「提示保鲜期」；影子模式移到诊断模式上方；「再次叫醒间隔」说明补充为递减基数；回执核对说明改写；做梦相关去掉「一次」。
- 搭话意愿情绪提示改为依次递进：担心 → 寂寞 → 失落。

## 1.0.1 · 设置分卡

- 设置面板按功能拆成 6 张卡片：基础作息 / 睡眠与休息 / 搭话意愿 / 做梦 / 场景感知 / 高级与排障。
- 框架不支持真正的选项卡，多配置组会被渲染成同一页里的分区卡片，不引入自定义 WebUI bundle。

## 1.0.0 · 作息完整版

第一个正式版本：P0–P8 全部功能。

- **P0 正确性**：渠道无关的活动检测、空闲门控、状态持久化、结构化日志、状态灯/徽标。
- **P1 作息时段**：睡眠/休息时段、每日上限、概率跳过。
- **P2 睡眠表现**：该睡/该醒提示、可编辑 `messages.json`、被吵醒计数（30 分钟合并）、公开 `status.json`。
- **P3 内容感知**：影子模式、上下文事实与引用、渠道中性措辞。
- **退避改造**：渠道别名、回复排除、发送回执核对（失败不计）。
- **P5 场景感知**：锁屏探测（纯 cmdlet，可选空闲探测）、写进叫醒正文。
- **P6 做梦**：入夜掷骰、到点提示、由桌宠自己写 `partner/dreams.md`、早上只给事实。
- **P7 搭话意愿**：未回应时 ×1.5 递减（封顶 8 小时）、对话清零、戳摸减半、睡醒减半、情绪提示；回合结束即结算。
- **P8 诊断**：`debug` 开关，生成 `diagnostics.json` / `debug.log`，可分享排障。
- `status.json` 增加 `version` / `debug` / `willingness` 字段。

## 0.3.0（本地 fork，未发布）

- 从已安装的 `cortico-world-selftalk@0.2.2` 取源码作为 fork 基线（上游 GitHub 不可达，无历史）。
- **改名以匹配新目标（让桌宠有自己的作息）**：包名 `cortico-world-rhythm`、World id `rhythm`、
  显示名「作息」、事件类型 `rhythm.nudge`、配置段 `worlds.rhythm`、日志前缀 `作息:叫醒 Coo`。
  类与符号同步改名（`RhythmWorld` / `RhythmConfigSection` / `RHYTHM_DEFAULTS` / `rhythmConfigGroup`）。
- `private: true`：本 fork 只装本机，不发布 npm / 扩展市场。
- 修正 upstream 注释里「internal 事件落到系统提示位置」的说法：实际是 user 消息中的正文行。
- 新增本地开发脚手架，不需要启动 Coopanion：
  - `scripts/run.ps1`：用 Coopanion 自带 Node + `tsx` + 框架解析钩子跑脚本（GUI 子系统程序的输出重定向已封装）。
  - `scripts/check.mjs`：干装载检查（manifest / `defaults` / `create` / `tools` / `webUi` / 配置路径 / `describe.json` 一致性），`--write` 重新生成 `describe.json`。
  - `scripts/smoke.mjs`：假宿主 + 假时钟的行为冒烟测试（P0+P1 后 124 条断言）。
- 新增 `docs/dev-notes.md`（环境与工作方式）与 `docs/fork-plan.md`（改进计划）。

### P0：正确性与可观测性

- **「有人回来了」改成渠道无关**：任何 `origin: 'external'` 且类型不以 `.self` 结尾的事件都算。
  微信、QQ、B 站、Discord 等通讯扩展装上即自动生效，不再需要登记类型。
  （`desktop-pet.self` 也是 external，只是 `deliver:false`，必须靠类型后缀排除。）
  新增 `knownChannelsOnly` 可一键退回旧白名单。
- 新增 `activityIgnore`：逗号分隔的事件类型，`qq.system*` 形式做前缀匹配，用来排除周期性系统事件。
- **只在 Coo 空闲时叫醒**：新增 `onRunPhase` 记录主循环状态 + `onlyWhenIdle` 开关（缺省开），
  模型或工具在跑时先不叫醒，避免 `flush` 排队迟到。
- **状态持久化**（`src/state.ts`）：`<dataDir>/rhythm/state.json` 记今日叫醒次数、本轮轮次、
  上次叫醒时刻与投递结果；原子写入、坏文件容错、跨天自动清零；重启时从事件库重算最近活动，
  停机太久不补叫（`stretchAlive` 判定）。
- **投递结果回写**：`onEventsSettled` 记 `delivered` / `discarded`；被丢弃时今日计数回退。
- **状态灯倒计时 + 徽标**：灯里显示「约 X 分钟后叫醒 / 今日 N 次 / 本轮已到上限」，徽标显示今日次数。
- **结构化日志**：`作息:启动`、`作息:叫醒 Coo`（含 phase、轮次、今日次数、最后活动类型）、
  `作息:叫醒结果`、debug 级 `作息:有人回来了`。

### P1：作息时段与节制

- **睡眠时段** `sleepWindow`（缺省 `22:00-08:00`）与**休息时段** `restWindows`（可写多个，
  逗号分隔，例如 `12:30-14:00, 18:00-18:30`）：时段内不主动叫醒；支持跨午夜；
  坏条目跳过并在日志里 warn，不会让整个配置失效。
- **离开时段重新计时**：从睡眠/休息进入正常时段时，安静计时从那一刻重新开始，不会在整点立刻跳出来。
- **排队跨时段作废**：叫醒事件排队期间进入睡眠/休息时段，`render()` 返回 `null` 并回退今日计数。
- **每日上限** `dailyCap`（缺省 12，0 = 不限）：按部署时区自然日计数，复用 `nudgesToday`。
- **退避** `backoffAfter` / `backoffFactor` / `backoffMaxFactor`（缺省关闭）：
  连续没人理时再次叫醒的间隔按倍数拉长、封顶；人一说话立刻恢复。
  这个机制预留给后面的「心情」驱动（心情可以只替换「倍数/意愿」的来源，不动调度骨架）。
- **概率跳过** `skipChance`：逻辑已实现（压制到下一个间隔），缺省 0 且不进配置组，等后续再决定是否暴露。
- **jitter 语义固定**：`基准 × (1 + random × jitter)`，只往后偏、每个间隔重掷、不落盘；
  与退避是乘法叠加。
- 状态灯新增时段/上限提示；新增日志 `作息:进入睡眠时段`、`作息:休息结束，安静计时重新开始`、
  `作息:排队的叫醒已作废`。

### P2：睡眠表现与「被吵醒」

- **两条睡眠提示**（`sleepHint`，缺省开）：进入睡眠时段发「该睡了」、离开时发「该醒了」，
  正文建议 Coo 用 `pet_act` 的 `sleep` / `stand` 动作；只在启用睡眠时段时生效，每夜各一条。
- **可编辑文案**：`<dataDir>/rhythm/messages.json`，首次运行生成默认模板，之后不会被覆盖；
  三句（sleep/wake/woken），占位符 `{at}` / `{by}` / `{count}`；坏文件退回默认并只 warn 一次。
- **「被吵醒」计数**（`wakeGapMinutes`，缺省 30）：睡眠时段内的人侧事件按间隔合并计一次；
  internal 与 `*.self`（软件唤醒、Coo 自己的动作）天然不计，灰区用 `activityIgnore` 排除。
  每计一次推一条归档事件 `rhythm.woke`（`deliver: false`）。
- **兜底提示**（`wakeHint`，缺省开）：`piggyback` 只搭着正在进行的那一轮，`wakeHintSeconds`（缺省 90，可调 10–300）内没搭上车就作废，
  不会在对话结束后突然冒出「你被吵醒了」。
- **公开状态**：`<dataDir>/rhythm/status.json`（`sleep.active/endsAt/wokeCount/lastWokeAt/lastWokeBy`、
  `today.nudges/cap`），原子写，供其他插件读取；不含敏感字段。
- `describe.json` 新增 `rhythm.hint` 与 `rhythm.woke` 两个事件声明。

### 退避语义修正：只数「主动搭话没人回」

- 之前退避数的是叫醒次数：Coo 安静地结束一轮、或跑去查资料/整理文件，也会被当成「没人理」——
  这是上游就有的问题。
- 现在改数 state.unanswered：每次叫醒记一轮 ttempt；outputTap 里看到
  esponse.output_item.added 的 unction_call 且名字在 speakTools 里，才算「开口了」；
  下一次叫醒前结算——有人回 → 清零，开了口没人回 → +1，没开口 → 不变。
- 新增配置 speakTools（缺省 pet_say, pet_ask, console_send, clawbridge_send）：
  装了新的通讯插件就把它的发送工具名加进来。
- 倍数公式随之改为 min(上限, factor ^ max(0, unanswered - backoffAfter + 1))。
### P3：内容感知（轻量版）+ 影子模式

- **影子模式** `dryRun`：照常算「什么时候该叫、正文长什么样」，只写日志与 `status.plan`，
  不投递、不计数、不占每日上限。用于真机上验证排程而不打扰桌宠。
- **叫醒正文**（`src/context.ts` + `model-text.ts`）：默认只给事实（安静多久、它上次开口有没有被接）；
  原话引用只在「上下文可能丢失」（交接后、或安静超过 `contextStaleMinutes`）时出现，
  截断 40 字并剥掉 `【…】`/`<…>`/`sticker:` 等渠道标记。
- **防复读**：收尾句按本轮次数轮换三档；措辞改为渠道中性（不再写「在气泡里」）。
- **微信兜底**：`outputTap` 抓 `clawbridge_send` 等说话工具的参数，补上「它上次说了什么」。
- 新增配置：`dryRun`、`contextAware`、`contextQuotes`、`contextStaleMinutes`；
  `status.json` 增加 `plan.nextNudgeAt / shadow`。
### 渠道别名与退避的两条例外

- 新增 `channelAliases`：`clawbridge=微信`、`desktop-pet=桌宠`、`console=控制台`、`qq=QQ`；
  提示文案里的 `{by}` 用可读名字，不再出现 `clawbridge.message` 这种技术名。
- 退避不计「回话」：叫醒那一轮如果期间有人说过话，视为回复而不是主动搭话。
- 退避不计「发送失败」：新增 `verifySpeakReceipts`（缺省开）。叫醒后记下说话工具的 `call_id`，
  结算时去 `<dataDir>/session-main.jsonl` 尾部按 `call_id` 找工具回执；回执含失败标记（失败/过期/未连接…）
  就不计入退避。只读尾部、不落盘、不记正文；找不到回执时按原行为处理。
  渠道也可选推 `<前缀>.send-failed` 事件，作为补充信号。
### P5：主人状态探测（已实现，未部署）

- 新增 `src/presence.ts`：**默认只查锁屏**（纯 cmdlet 读 `LogonUI`/`LockApp` 进程，不编译、不写盘、不改策略），
  兼容 Windows 自带 PowerShell 5.1；可选 `awayIdleProbe` 用 `Add-Type` 取键鼠空闲秒数（默认关，避免触发杀软）。
  2 秒超时、60 秒缓存；非 Windows 直接 `unknown`。任何失败都不影响叫醒。
- 叫醒正文增加事实行：锁屏 → 「主人现在不在电脑前（屏幕锁着）」；空闲超过 `awayIdleMinutes` →
  「屏幕已经 N 分钟没有输入」。不给渠道建议。
- `pauseWhenLocked`（缺省关）：打开后锁屏期间跳过叫醒，解锁后下一拍再说。
- `status.json` 增加 `presence` 字段（state/locked/idleSeconds）。
### P6：做梦（已实现，未部署）

- 睡眠时段内**入夜掷一次骰子**（做不做 / 几点 / 什么类型），一夜最多 `dreamMaxPerNight` 次；被吵醒则取消。
- 到点投一条 `rhythm.hint`（`meta.kind = 'dream'`），正文由 `messages.json` 的 `dream` 模板与 `dreamTypes` 词表决定，
  明确要求「别说话、别用说话工具、别联系任何人」。
- 提示词让 **Coo 自己**把梦追加到 `dreamDiary`（默认 `partner/dreams.md`，相对它的工作区）；
  插件不抓正文、不替它写文件。
- 早上的「该醒了」提示补一句事实（梦的内容 + 「要不要跟主人提，由你决定」），沿用 P3 的「只给事实」原则。
- 旧的 `messages.json` 会自动补上 `dream` / `dreamTypes`，不覆盖用户已有文案。
### 醒发正文：稳定模板 + 事实行 + 日期

- 去掉按次数轮换的三套收尾句，改成**一条稳定模板**；变化全部来自事实行，行为选项（说话/工具/结束）每次都保留。
- 事实行之间是 AND：锁屏、未接、引用互不挤占；唯一省略的是 `quoteSelf` 已经写明「还没人接话」的重复行。
- 所有给模型看的时刻都带日期（`11-03 周一 14:05`）；引用跨天时补日期，不再出现孤零零的 `[00:30]`。
### P7：搭话意愿（已实现，未部署）

- 未回应次数决定再次叫醒间隔：`repeatMinutes × 1.5^n`，封顶 `willingnessMaxMinutes`（默认 480 分钟 = 8h）。
- 对话（文字/语音/回答/控制台/外部消息）立刻清零；戳/摸减半；拎起/摔/换装不算。
- 睡醒后未回应次数减半（最少 1），不会把一整夜的递减带进第二天。
- 递减期间正文按次数插入一句情绪提示（`{user}` 取配置里的称呼），只给信息，怎么应对由 Coo 决定。
- `{user}` 同步用在叫醒开头/收尾与被吵醒提示；默认关闭（`willingnessEnabled=false`）。
### P7 收尾：结算提前 + 状态不再误导

- 叫醒的「有没有被回应」改在**回合结束**时结算，被无视后下一次间隔立刻按倍数拉伸（不再晚一格）。
  下一次叫醒时仍保留一次兜底结算（ttempt 已清空则无操作）。
- status.json 的 plan 增加 capped；maxRounds 用满时 
extNudgeAt 与 willingness.nextNudgeInMinutes 都为 
ull，
  不再显示一个不会发生的理论时间。
## 0.2.2

- 包简介换成中文（npm 页面与扩展市场显示）。

## 0.2.1

- 「间隔浮动」改为对**每个间隔**生效：第一次叫醒与每次再次叫醒都会各自乘一次随机倍数（之前只浮动第一次）。

## 0.2.0

- 插件显示名改为「自主发言」（`cortico.displayName` 与 World 标签）。
- 「最多叫醒几次」缺省改为 **0 = 不限**；正数（1–10）仍表示一段安静里的上限。

## 0.1.0

- 第一个版本：安静计时后叫醒 Coo 的自主发言 World（`selftalk.nudge`，internal 投递）。
- 时间参数（`quietMinutes` / `repeatMinutes` / `maxRounds` / `jitter`）在控制台 World 配置里，改完立即生效。
- 检测使用者动作（桌宠与控制台的人侧事件），Coo 自己的发言不计入安静计时。
- 支持 `describe.json` 自描述与本地干装载检查。