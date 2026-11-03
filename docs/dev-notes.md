# 作息（rhythm）fork · 开发笔记

> 这份文件只写**本地开发环境与这个 fork 的工作方式**。功能设计见 `fork-plan.md`，
> 宿主 API 详见 `host-apis.md`，Coo 现有能力详见 `coo-capabilities.md`。
>
> fork 基线：`cortico-world-selftalk@0.2.2`（npm 上最新版，2026-10 装机时的版本）。
> **本 fork 已改名**：包 `cortico-world-rhythm`、World id `rhythm`、显示名「作息」。
> 上游 GitHub 仓库在本机**连不上**（`git ls-remote` → `Recv failure: Connection was reset`，
> 系统代理 `127.0.0.1:10808` 未开启），所以 fork 起点是安装目录里已装的源码，没有 git 历史。
>
> 改名带来的直接后果：配置段从 `worlds.selftalk` 变成 `worlds.rhythm`，上游那份配置（本机 30/45/3/0.2）
> 不会自动搬过来；两套同时启用会各叫各的（双份 token、双份插嘴）。真机启用前先停用上游「自主发言」。

---

## 1. 环境地图

| 东西 | 位置 |
|---|---|
| 本 fork（唯一可写目录） | `D:\文档\deepseek-harness\default-workspace\selftalk\` |
| Coopanion 安装目录 | `%LOCALAPPDATA%\Programs\Coopanion`（只读） |
| 框架/宿主源码 | `<安装目录>\resources\app\build\cortico\src\`（只读，TypeScript 原文） |
| 已装扩展 | `<安装目录>\data\extensions\node_modules\`（只读，除非主人同意装包） |
| 部署目录 | `<安装目录>\data\home\companion\`（`config.json`、`deployment.json`） |
| 日志 | `<安装目录>\data\logs\core.log` |
| Coo 的 bot 代码 | `deployment.json` → `"bot": "cormini"` |

**没有系统 node**：`node` / `pnpm` 都不在 PATH 里。一切脚本都用 Coopanion 自带的 Electron
Node（v24.21.0）：

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
```

`Coopanion.exe` 是 **GUI 子系统**程序：`& $exe ...` 会立刻返回空结果、拿不到输出。
必须 `Start-Process -Wait -PassThru` + 重定向到文件。`scripts/run.ps1` 已经封装好这些。

---

## 2. 日常命令

都在 `selftalk\` 下跑：

| 命令 | 作用 | 何时用 |
|---|---|---|
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run.ps1 check.mjs` | 干装载：manifest、`defaults()`/`create()`/`tools()`/`envPromptVars()`/`webUi()`、配置组路径、`describe.json` 一致性 | 每次改完代码 |
| `... -File scripts/run.ps1 check.mjs --write` | 按定义重写 `describe.json` | 改了工具/事件声明之后 |
| `... -File scripts/run.ps1 smoke.mjs` | 行为冒烟：假宿主 + 假时钟，验证安静计时、重复叫醒、次数上限、重置、作废等分支 | 改了 `world.ts` 逻辑之后 |

`npm run check` / `npm run describe` / `npm run smoke` 是上面三条的快捷方式（同样走 `scripts/run.ps1`）。

两个脚本都**不启动 Coopanion、不写安装目录**：scratch 目录固定为本仓库的 `.scratch/`（已 gitignore），跑完自动删除。

### run.ps1 的两条硬规则（踩过）

1. `--import` 后面必须是**模块 specifier**。传 `C:\...\runtime.ts` 会被当成 scheme 为 `c:` 的 URL，
   报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。用 `([System.Uri]$path).AbsoluteUri` 转成 `file:///...`。
2. 入口脚本反过来**要传普通 Windows 路径**。传 `file:///D:/%E6%96%87%E6%A1%A3/...` 会被
   `Start-Process` 的参数拼接二次编码成 `%25E6...`，报 `ERR_MODULE_NOT_FOUND`。
   路径里有中文时尤其明显。

---

## 3. 这个插件挂在哪里

- 包名 `cortico-world-rhythm`，World id **`rhythm`**，`cortico.kind = "world"`、`cortico.api = 6`、
  显示名「作息」（上游是 `cortico-world-selftalk` / `selftalk` / 「自主发言」）。
- 入口 `src/index.ts` 导出 `WorldDefinition`：`id` / `label` / `defaults()` / `create()` / `describe`。
- 框架用 `module.registerHooks` 把 `cortico/*` 映射到宿主 `src/*`（`extensions/runtime.ts`），
  扩展与框架共享同一份模块实例；源码是 TypeScript，由宿主自带 `tsx` 直接加载，**无需构建**。
- 配置段 `worlds.rhythm`，WebUI 改完立即生效（每个 5 秒检查周期现读）。
- 默认 `enabled: false`，是否启用由 bot 声明与部署配置决定。
- 日志前缀（fork）：`worlds.rhythm: 作息:叫醒 Coo`；上游仍是 `worlds.selftalk: 自言自语:叫醒 Coo`。

### 本机当前部署（2026-11-01 读 `config.json`）

| 项 | 值 |
|---|---|
| bot | `cormini`，显示名「小肥鱼」 |
| 语言 | `zh` |
| `worlds.selftalk`（**上游插件**） | **已启用**：`quietMinutes=30`、`repeatMinutes=45`、`maxRounds=3`、`jitter=0.2` |
| `worlds.rhythm`（**本 fork**） | 尚未安装，无配置段 |
| 同时启用的其他 World | `websearch`、`devtools`、`clawbridge`（微信桥）、`localvision` 未设 |

⚠️ `clawbridge` 已启用 —— 微信里的人和 Coo 说话**不会重置**安静计时（见第 5 节第 1 条），
这是真机上最容易犯的错，改代码时优先处理。

⚠️ 本 fork 换了 id，上游不会自动消失。启用「作息」之前先在控制台停用上游「自主发言」，
否则两个 World 各叫各的（双份 token、双份插嘴）。

### 真机日志佐证（`core.log`，2026-11-01，均来自**上游**插件）

```
[16:42:08] INFO  worlds.selftalk: 自言自语:叫醒 Coo
[16:44:45] INFO  worlds.selftalk: 自言自语:叫醒 Coo
[16:45:17] INFO  worlds.clawbridge: clawbridge: 已发送微信消息
[16:45:19] INFO  worlds.clawbridge: clawbridge: 已发送微信消息
[16:46:00] ERROR core.loop: 投递水位停滞:有该进上下文的外部事件长时间没被投递,水位没有推进
[16:52:42] INFO  worlds.clawbridge: clawbridge: 已发送微信消息
[16:52:44] INFO  worlds.clawbridge: clawbridge: 已发送微信消息
[16:53:16] INFO  worlds.selftalk: 自言自语:叫醒 Coo     ← 微信对话进行中又叫醒了一次
[16:54:02] INFO  worlds.clawbridge: clawbridge: 已发送微信消息
```

- 结论一：**微信对话进行中照样叫醒**（16:52 刚发完消息，16:53 就叫醒），白名单问题在真机上确实发生。
- 结论二：叫醒后 1 分钟出现过一次「投递水位停滞」，随后自行解除（`caughtUp: 6`）。
  目前没有证据把两者联系起来，但**改 flush 投递策略时要复现这条日志**，确认不会把外部事件堵在队列里。



---

## 4. 当前行为（0.3.0 P0 + P1 + P2）

> 行号会漂，所以「代码位置」写函数/文件，不再写绝对行号。

| 行为 | 代码位置 | 说明 |
|---|---|---|
| 检查周期 5 秒 | `world.ts › CHECK_EVERY_MS` | `setInterval(() => this.tick(), 5000)` |
| 事件扫描窗口 500 条 | `world.ts › latestPersonActivity` | `store.range({ limit: 500, origin: 'external' })`，只扫外部事件 |
| 「有人回来了」判定 | `world.ts › isPersonActivity` | external + 类型不以 `.self` 结尾 + 不在 `activityIgnore` 里；`knownChannelsOnly` 打开才退回旧白名单 |
| 主循环忙不叫醒 | `world.ts › onRunPhase` / `tick` | 只记 phase；`onlyWhenIdle` 时 phase ≠ idle 直接跳过 |
| 时段判定 | `windows.ts`、`world.ts › currentWindow` | `sleepWindow` 单段 + `restWindows` 多段；跨午夜；坏条目容错 |
| 时段内与离开时段 | `world.ts › tick` | 时段内直接返回；离开时把安静起点重置到当前时刻 |
| 时间参数 | `world.ts › limits` | 全局四个 + 时段/上限/退避六个 |
| 安静判定 | `world.ts › dueAt` / `backoffMultiplier` | 首次 `quiet × jitter`；再次 `repeat × 退避倍数 × jitter` |
| 做梦 | `world.ts › planDream` / `maybeDream` / `onTurnEnded` | 入夜掷一次骰子；到点发一条 dream 提示；`outputText.delta` 抓正文，回合结束写进小本本 |
| 主人状态探测 | `presence.ts`、`world.ts › nudgeAfterProbe` | 默认只查锁屏（纯 cmdlet，不编译，PS 5.1 兼容）；可选 `awayIdleProbe` 用 Add-Type 取空闲秒数；2s 超时、60s 缓存，不阻塞 tick |
| 叫醒正文 | `world.ts › composeNudge` / `stamp` | 一条稳定模板 + 事实行（AND：锁屏、未接、引用）；时刻带日期 `11-03 周一 14:05`；跨天引用补日期 |
| 叫醒正文（旧） | `world.ts › composeNudge`、`context.ts`、`model-text.ts` | 默认只给事实；交接后/长间隔才引原话（40 字、剥渠道标记）；收尾句轮换防复读 |
| 影子模式 | `world.ts › shadowNudge` / `tick` | `dryRun` 时不投递、不计数，只写日志与 `status.plan` |
| 「搭话」判定 | `world.ts › outputTap` / `observeStream` / `isSpeakTool` | 看主会话流里的 `function_call` 名字是否在 `speakTools` 里（缺省 pet_say/pet_ask/console_send/clawbridge_send） |
| 退避计数 | `world.ts › settleAttempt` | 只给「开了口又没人回」加一；安静结束/查资料不加；有人回话清零 |
| 每日上限 | `world.ts › tick` | `dailyCap`，按部署时区自然日；复用 `nudgesToday` |
| 概率跳过 | `world.ts › tick` | `skipChance`（无 UI，缺省 0），压制到下一个间隔 |
| 叫醒投递 | `world.ts › nudge` | `pushDeferred(..., { trigger: 'flush' })`，`origin: 'internal'` |
| 状态落盘 | `state.ts`、`world.ts › persist` | `<dataDir>/rhythm/state.json`：今日次数、本轮轮次、上次叫醒与结果；重启续算 |
| 投递结果 | `world.ts › onEventsSettled` | 记 delivered/discarded；discarded 时今日计数回退 |
| 投递位置 | `core/loop.ts:706-712` | internal 正文拼进同一条 user 消息的正文行，**不进 system 前缀** |
| 投递时机 | `core/bus.ts:107-110` | `flush` 不打断正在跑的回合，等轮边界（工具全返回或下一次请求前） |
| 渲染期限 | `core/loop.ts:243`、`846-855` | `render()` 超过 3 秒、抛错或返回 `null` 都等于这条事件不存在 |
| 排队作废 | `world.ts › queuedNudgeCancelled` | 人回来了、或已进入睡眠/休息时段 → 返回 `null` 并回退计数 |
| 状态灯/徽标 | `world.ts › lampInfo`、`ui-text.ts` | 灯里给时段/倒计时/上限/今日次数；徽标给今日次数 |
| 睡眠提示 | `world.ts › enterWindow` / `leaveWindow` / `sendHint` | 「该睡了」用 flush；「该醒了」在离开时段时发；文案来自 `messages.json` |
| 「被吵醒」计数 | `world.ts › countWakes` | 睡眠时段内人侧事件，按 `wakeGapMinutes` 合并；计一次推一条归档 `rhythm.woke` |
| 被吵醒提示 | `world.ts › sendHint('woken')` | `piggyback`（只搭车不发车），超过 90 秒 `render` 返回 null |
| 提示文案文件 | `messages.ts` | `<dataDir>/rhythm/messages.json`，缺失时生成默认模板，永不覆盖；占位符 `{at}/{by}/{count}` |
| 公开状态 | `world.ts › writeStatus` | `<dataDir>/rhythm/status.json`：`sleep.active/endsAt/wokeCount/lastWokeBy`、`today.nudges/cap` |
| 叫醒正文 | `model-text.ts` | 中文/英文两版，开头带 `HH:MM`；语言读部署 `config.json` 的 `language` |
| 工具 | `index.ts`、`world.ts › tools` | 没有工具（`tools(): []`） |

**叫醒事件正文（首次）**：

```
[15:32] [作息] 安静了大约 15 分钟，没有人跟你说话。现在你可以自己决定:想说话就在气泡里跟对方说点什么，想做事就用工具，自己跟自己说几句也可以；不想就结束这一轮。
```

---

## 5. 问题清单与处理结果

| # | 问题 | 状态 |
|---|---|---|
| 1 | 只认桌宠/控制台的人侧事件（微信里正聊着天也插嘴） | ✅ **P0 已修**：改成渠道无关（external 且非 `*.self`），并给 `knownChannelsOnly` 留回退；`activityIgnore` 可排除周期性系统事件 |
| 2 | 叫醒是「定时闹钟」不是「想起什么」：正文机械、不看上下文 | ⬜ 待 P3（内容感知）；退避已在 P1 落地 |
| 3 | 不持久化，重启后轮次/今日次数全丢 | ✅ **P0 已修**：`rhythm/state.json`，重启续算、跨天清零、坏文件容错 |
| 4 | 看不到「距下次叫醒多久/今天叫了几次/上一次结果」 | ✅ **P0 部分修**：状态灯倒计时 + 徽标（今日次数）+ 日志带 `onEventsSettled` 结果；P1 又加了时段/上限提示 |
| 5 | 没有节制机制：免打扰时段、每日上限、退避 | ✅ **P1 已修**：睡眠/休息时段、`dailyCap`、退避；`skipChance` 逻辑已备好但无 UI |
| 6 | 夜里会一直叫 | ✅ **P1 已修**：`sleepWindow` 缺省 `22:00-08:00`，离开时段时重新计时 |
| 7 | 语言文件每次叫醒都读盘 | ⬜ 小优化，可忽略 |
| 8 | 订阅窗口硬编码 500 条 | ⬜ 已加 `origin: 'external'` 过滤，量减半；上限本身仍硬编码 |
| 9 | World 被隐藏时叫醒静默消失 | 🟡 **P0 部分修**：`onEventsSettled` 报 `discarded` 时计数回退并记日志；但「事件根本没被投递过」这种情况宿主不会通知，仍看不出来（受限于宿主接口） |
| 10 | 主循环忙时叫醒会排队迟到 | ✅ **P0 已修**：`onRunPhase` + `onlyWhenIdle`，只在 idle 时叫醒 |

### P0 具体改动（2026-11-01）

1. **渠道无关的活动检测**（`src/world.ts:isPersonActivity`）：`origin === 'external'` && 类型不以 `.self` 结尾 &&
   不在忽略表里。`.self` 是关键：`desktop-pet.self` 同样是 external（只是 `deliver:false`），
   不排除就会把 Coo 自己说的话当成「有人回来了」，叫醒永远等不到。
2. **`activityIgnore`**：逗号分隔，`qq.system*` 形式做前缀匹配，留给「某些渠道会推周期性系统事件」的情况。
3. **`knownChannelsOnly`**：一键退回旧白名单，出事时能立刻降级。
4. **`onlyWhenIdle` + `onRunPhase`**：模型/工具在跑时不叫醒，避免 flush 排队迟到。
5. **状态落盘**（`src/state.ts`）：`<dataDir>/rhythm/state.json`，原子写（tmp + rename），坏文件给 warn 不崩；
   重启时从事件库重算「最近一次人侧活动」，只恢复事件库读不出来的东西。停机太久不补叫（`stretchAlive` 判定）。
6. **徽标 + 状态灯倒计时**（`src/ui-text.ts:lampHint`）：不需要浏览器 bundle。
7. **结构化日志**：`作息:启动`（含是否接续）、`作息:叫醒 Coo`（轮次/今日次数/phase/最后活动类型）、
   `作息:叫醒结果`（delivered/discarded）、`作息:有人回来了`（debug 级）。

### P1 具体改动（2026-11-01）

1. **时段**（`src/windows.ts`）：`sleepWindow` 单段 + `restWindows` 逗号分隔多段；跨午夜、坏条目容错、
   空 = 不启用。时段内 `tick` 直接返回；离开时段把安静起点重置到当前时刻。
2. **排队跨时段作废**：`render()` 里复查时段，命中就作废并回退「今日次数/轮次」。
3. **每日上限** `dailyCap`（缺省 12）：按部署时区自然日，复用 `nudgesToday`，跨天清零。
4. **退避** `backoffAfter/backoffFactor/backoffMaxFactor`（缺省关闭）：**数的是「主动搭话没人回」**，
   不是叫醒次数；人一说话清零。详见 P3 那一节。**这个机制预留给后面的「心情」驱动**——心情迟早会想直接压「唤醒意愿」，
   届时光改 `backoffMultiplier()` 或换一个意愿来源即可，不用动调度骨架。
5. **`skipChance`**：逻辑已实现（压制到下一个间隔），默认 0 且不进配置组，等 P3 再决定是否暴露。
6. **jitter 语义固定下来**：`基准 × (1 + random × jitter)`，只往后偏、每个间隔重掷、不落盘；
   与退避是乘法叠加（`基准 × 退避 × (1+随机)`）。测试用 `jitter: 0` 保证确定性。

### P2 具体改动（2026-11-01）

1. **两条睡眠提示**（`sleepHint`，缺省开）：进入睡眠时段发「该睡了」，离开时发「该醒了」；
   都走 `pushDeferred` + flush，正文建议 Coo 用 `pet_act` 的 `sleep` / `stand` 动作。
   只在启用了睡眠时段时生效；每夜各最多一条（`nightKey` 落盘，重启不重发）。
2. **可编辑文案**（`src/messages.ts`）：`<dataDir>/rhythm/messages.json`，首次运行生成默认模板，
   **永不覆盖**；三句（sleep/wake/woken），占位符 `{at}/{by}/{count}`；坏文件退回默认并只 warn 一次。
3. **「被吵醒」计数**（`wakeGapMinutes`，缺省 30）：睡眠时段内的人侧事件按间隔合并计一次；
   判定与「有人回来了」完全同一套（internal 与 `*.self` 天然不计，灰区用 `activityIgnore`）。
   每计一次推一条归档事件 `rhythm.woke`（`deliver:false`）。
4. **兜底提示**（`wakeHint`，缺省开）：`piggyback` 投递，只搭着正在进行的这一轮走；
   `render()` 里超过 `wakeHintSeconds`（缺省 90，可调 10–300）返回 `null`——不会在对话结束很久后突然冒出「你被吵醒了」。
   为什么不用 flush：见 `p2-sleep-design.md` §3（会多一次模型调用且可能迟到）。
5. **公开状态**（`status.json`）：`sleep.active/endsAt/wokeCount/lastWokeAt/lastWokeBy`、
   `today.nudges/cap`，原子写；供微信桥等插件读取，不含敏感字段。

### 退避语义修正（2026-11-02，主人指出上游的问题）

- **问题**：上游（以及我们 P1）把「叫醒次数」当退避依据。可 Coo 完全可能选择不说话、
  或者跑去查资料/整理文件——这些不该算「没人理」。
- **现在**：退避改数 `state.unanswered`，只统计「主动搭话却没人回应」：
  1. 每次叫醒记一轮 `attempt`；
  2. `outputTap` 看到 `response.output_item.added` + `item.type === 'function_call'`
     且工具名在 `speakTools`（缺省 `pet_say/pet_ask/console_send/clawbridge_send`）里 → 标记「开口了」；
  3. 下一次叫醒前 `settleAttempt()`：有人回过 → 清零；开了口但没人回 → +1；没开口 → 不变。
- **为什么用 outputTap**：桌宠与控制台会留 `.self` 事件，但微信桥**发出去的消息不落事件**，
  只有主会话输出流能统一看到「它调了哪个说话工具」。
- **自动学习**：扫描人侧事件时顺手记下渠道前缀（`qq.message` → `qq`），此后 `qq_send` / `qq_reply` 这类工具自动算作搭话，不需要提前知道 QQ 插件的存在；`speakTools` 只用来补命名不按约定的插件。
- **宽松匹配** `speakMatchAnywhere`（默认关）：名字里出现说话动词就算，兜 `sendMsgToWechat`；误判率更高，所以不默认开。
- **忽略名单** `speakIgnore`：优先于自动识别，用来排除 `minecraft_say` 这类「在别处喊话」。
- **观察日志**：叫醒后那一轮的每个 `function_call` 都会记一条 debug 日志（工具名、是否算搭话），排查时直接抄名字。
- **退避只数「主动搭话」**：那一轮如果是在回你的话（期间有人说过话），不计；渠道如果推了 `<渠道>.send-failed` 事件（如微信 24 小时窗口过期），也不计。
- **渠道别名** `channelAliases`：`clawbridge=微信`、`qq=QQ`，只影响提示文案里的 `{by}`。
- **发送回执核对**（`verifySpeakReceipts`，缺省开）：World 拿不到工具回执，但回执会以 `function_call_output` 写进 `<dataDir>/session-main.jsonl`。
  叫醒后记下 `call_id`，结算时读该文件尾部 512KB，按 `call_id` 找那条回执；出现失败标记（失败/过期/未连接/没发出去…）就不计入退避。
  只读尾部、只匹配自己的 `call_id`，不落盘、不记正文。找不到回执（交接/压缩后）就按原来的行为处理。
- 兼容约定：任何渠道也可以主动推 `<前缀>.send-failed` 事件，同样生效。
- **局限**：只发不收的渠道（从不推人侧事件）学不到前缀；不通过工具改状态的插件也看不到——这两种只能进 `speakTools`。
- **公式**：`倍数 = min(上限, factor ^ max(0, unanswered - backoffAfter + 1))`——连续 N 次被无视后开始变稀。
**本地验证**：`smoke.mjs` 266 条断言全绿，覆盖 P0/P1/P2：渠道无关判定、`*.self` 排除、时段解析与跨午夜、
睡眠阻断与重新计时、排队作废、每日上限、退避时间表、概率跳过、重启续算、坏文件、
**两条睡眠提示、重启不重发、被吵醒合并计数（30 分钟）、内部/自录不计、piggyback 与 90 秒过期、
自定义文案、status.json 内容**。
**尚未真机验证**（需要装包）：见第 6 节末尾的清单。

---

## 6. 装进 Coopanion（**需要主人点头才能做**）

装包会改安装目录（`data\extensions\package.json` 与 `node_modules\`），属于「其他地方只能看不能改」的范畴。
流程按上游 README 与 `clawbridge\docs\coopanion-plugin-guide.md`：

```powershell
# 1) 打包
cd D:\文档\deepseek-harness\default-workspace\selftalk
# 用自带 pnpm：$app = "$env:LOCALAPPDATA\Programs\Coopanion"
# $env:ELECTRON_RUN_AS_NODE='1'
# Start-Process "$app\Coopanion.exe" -ArgumentList @("$app\resources\app\node_modules\pnpm\bin\pnpm.cjs",'pack') -NoNewWindow -Wait

# 2) 装进扩展目录（--ignore-workspace --store-dir 两个参数缺一不可）
# 3) 重启 Coo 进程：控制台 →「扩展」→「重启进程」
```

**注意**：本 fork 换了包名与 id，可以和上游 `cortico-world-selftalk` **并存**（不会互相顶掉）。
代价是配置不共享：上游那份 `worlds.selftalk`（30/45/3/0.2）要手工对应到 `worlds.rhythm`；
而且两个都启用就会**各叫各的** —— 启用「作息」前先在控制台停用上游「自主发言」。

### 真机验证清单（P0 之后，需要装包才有意义）

本地假宿主验不到、只能在真机上确认的：

1. **World 能加载**：`core.log` 出现 `World 已启动: rhythm`，控制台「模块」页有「作息」。
2. **配置组能渲染**：P0 的三个开关（`knownChannelsOnly` / `activityIgnore` / `onlyWhenIdle`）与 P1 的六个
   （`sleepWindow` / `restWindows` / `dailyCap` / `backoffAfter` / `backoffFactor` / `backoffMaxFactor`）
   都出现在页面上；字符串/数字改动后立即生效（下一拍 tick 现读）。
3. **微信渠道真的重置计时**：微信里发一条，`core.log` 出现 debug 级 `作息:有人回来了`，状态灯倒计时重置。
4. **空闲门控**：叫醒后 Coo 正在回话的那一轮里不应再排队新的叫醒（日志 `phase` 不是 `idle` 时不该有叫醒）。
5. **投递结果**：`作息:叫醒结果` 出现 `delivered`；若把 World 隐藏，看是否出现 `discarded`（宿主对「根本没投递」可能不通知）。
6. **状态文件**：`data\home\companion\data\rhythm\state.json` 生成；重启进程后「今日叫醒」不归零。
7. **徽标/灯**：状态灯悬停显示「约 X 分钟后叫醒…今日 N 次」；夜里显示「睡眠时段（08:00 醒）……」。
8. **时段真的挡住**：把 `sleepWindow` 临时改成「当前时刻附近」的一分钟窗口，看日志出现 `作息:进入睡眠时段`，
   并且窗口内没有 `作息:叫醒 Coo`；窗口结束后出现 `作息:休息结束，安静计时重新开始`。
9. **坏配置不致命**：把 `sleepWindow` 写成 `25:00-08:00`，日志出现 `作息:时段设置有问题` 的 warn，World 照常运行。
10. **每日上限**：把 `dailyCap` 调到 1，观察第二次不再叫、灯里出现「今日已达上限」。
11. **睡眠提示真的发出去**：把 `sleepWindow` 设成「现在 + 2 分钟」到「现在 + 10 分钟」，
    看日志 `作息:进入睡眠时段`（`hint: sent`），并确认桌宠真的自己躺下了（`pet_act sleep` 生效）；
    再把窗口结束时间调到 +12 分钟，确认出现 `作息:睡眠时段结束` 与「该醒了」提示。
12. **被吵醒**：睡眠时段里往桌宠气泡发一句话，看 `作息:被吵醒`（`by: desktop-pet.message`、
    `wokeCount: 1`）；30 分钟内再发几条，`wokeCount` 不变；`status.json` 里 `sleep.wokeCount` 同步。
13. **文案热改**：编辑 `data\home\companion\data\rhythm\messages.json` 改一句话，下一条提示即生效（无需重启）。
14. **兜底提示不迟到**：睡眠时段里发消息后隔 3 分钟再看，日志里不应出现新的一轮「被吵醒」提示
    （`piggyback` 的 `wakeHintSeconds` 保鲜期应已把它作废）。
15. **退避只数搭话**：把 `backoffAfter` 设成 1，让 Coo 在叫醒后只查资料不开口 → 下一次间隔不应变长；
    让它用 `pet_say` 说一句而你不回 → 下一次间隔应该变长。

---

## 7. 调试流程

1. 先跑 `check.mjs` 与 `smoke.mjs`（秒级，不碰宿主）。
2. 需要真机行为时：装包 → 重启进程 → 看日志过滤自己的 world id：

```powershell
$log = "$env:LOCALAPPDATA\Programs\Coopanion\data\logs\core.log"
Get-Content $log -Tail 200 -Encoding utf8 | Select-String -Pattern 'worlds.rhythm'
```

3. 关键路径落 JSON 快照到 `dataDir`（不要写 token / 本地绝对路径）。
4. 退出码非 0 一律先查，别信「看起来成功了」。

---

### 7.1 `messages.json` 的更新策略

这是给模型看的提示词文件，用户可改。升级时不能覆盖用户的修改，但也不能让新功能没有文案。

| 阶段 | 做法 |
|---|---|
| **当前（未发布，自用测试）** | 安装/升级时由开发方直接把新键同步进文件；用户不需要做任何事。 |
| **正式发布后** | 新版本新增的提示词键，在**更新说明**里列出来；`messages.json` 里也带一段 `_note` 说明「升级只补缺失键、不覆盖已有内容；删掉本文件会按当前版本重建」。 |
| 用户既没改过、也没删掉 | 加载时自动补齐缺失的键（只补缺失、保留用户已有值），无需操作。 |
| 用户删掉文件 | 按当前版本重新生成默认内容。 |

实现：`loadMessages` 在读取时对照默认值补齐缺失键并回写（现在已对 `dream`/`dreamTypes` 这样做，
P7 时泛化到所有键）；新增键永远不覆盖已有值。

---
## 8. 约定

- 源码保持**零依赖 ESM TypeScript**（跟宿主同构，`tsx` 直接加载）。
- 人读文案放 `ui-text.ts`，给模型读的正文放 `model-text.ts`，两者都要 zh/en。
- 新增配置键：必须同时出现在 `defaults()` 与配置组 schema 里，路径以 `worlds.rhythm.` 开头
  （`dryMountWorld` 会检查，缺一个直接 FAIL）。
- 新增工具：名字用 `rhythm_` 前缀，写进 `describe`，跑 `check.mjs --write` 更新 `describe.json`。
- 新增事件：写进 `describe.events`（含 zh/en 描述与 trigger）。
