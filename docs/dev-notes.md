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

## 4. 当前行为（0.3.0 P0 之后）

| 行为 | 代码位置 | 说明 |
|---|---|---|
| 检查周期 5 秒 | `src/world.ts:34` | `setInterval(() => this.tick(), 5000)` |
| 事件扫描窗口 500 条 | `src/world.ts:37` | `store.range({ limit: 500, origin: 'external' })`，只扫外部事件 |
| 「有人回来了」判定 | `src/world.ts:262-268` | external + 类型不以 `.self` 结尾 + 不在 `activityIgnore` 里；`knownChannelsOnly` 打开才退回旧白名单（`world.ts:46`） |
| 主循环忙不叫醒 | `src/world.ts:199-201`、`302` | `onRunPhase` 只记 phase；`onlyWhenIdle` 时 phase ≠ idle 直接跳过 |
| 时间参数 | `src/world.ts:214-224` | `quietMinutes` / `repeatMinutes` / `maxRounds` / `jitter`，外加 P0 的三个开关 |
| 安静判定 | `src/world.ts:291-331` | 首次：`lastActivitySeen + quiet × jitter`；再次：`lastNudgeAt + repeat × jitter` |
| 叫醒投递 | `src/world.ts:334-366` | `pushDeferred(..., { trigger: 'flush' })`，`origin: 'internal'` |
| 状态落盘 | `src/state.ts`、`src/world.ts:370-382` | `<dataDir>/rhythm/state.json`：今日次数、本轮轮次、上次叫醒与结果；重启续算 |
| 投递结果 | `src/world.ts:204-212` | `onEventsSettled` 记 delivered/discarded；discarded 时今日计数回退 |
| 投递位置 | `core/loop.ts:706-712` | internal 正文拼进同一条 user 消息的正文行，**不进 system 前缀** |
| 投递时机 | `core/bus.ts:107-110` | `flush` 不打断正在跑的回合，等轮边界（工具全返回或下一次请求前） |
| 渲染期限 | `core/loop.ts:243`、`846-855` | `render()` 超过 3 秒、抛错或返回 `null` 都等于这条事件不存在 |
| 排队作废 | `src/world.ts:352-358` | `render()` 时若期间有新人侧事件 → 返回 `null`，这条不投递 |
| 状态灯/徽标 | `src/world.ts:112-135`、`src/ui-text.ts` | 灯里给「约 X 分钟后叫醒 / 今日 N 次 / 本轮已到上限」；徽标给今日次数 |
| 叫醒正文 | `src/model-text.ts` | 中文/英文两版，开头带 `HH:MM`；语言读部署 `config.json` 的 `language` |
| 工具 | `src/index.ts`、`world.ts:139` | 没有工具（`tools(): []`） |

**叫醒事件正文（首次）**：

```
[15:32] [作息] 安静了大约 15 分钟，没有人跟你说话。现在你可以自己决定:想说话就在气泡里跟对方说点什么，想做事就用工具，自己跟自己说几句也可以；不想就结束这一轮。
```

---

## 5. 问题清单与 P0 处理结果

| # | 问题 | 状态 |
|---|---|---|
| 1 | 只认桌宠/控制台的人侧事件（微信里正聊着天也插嘴） | ✅ **P0 已修**：改成渠道无关（external 且非 `*.self`），并给 `knownChannelsOnly` 留回退；`activityIgnore` 可排除周期性系统事件 |
| 2 | 叫醒是「定时闹钟」不是「想起什么」：正文机械、不看上下文、没人理也照叫 | ⬜ 待 P1/P3（退避 + 内容感知） |
| 3 | 不持久化，重启后轮次/今日次数全丢 | ✅ **P0 已修**：`rhythm/state.json`，重启续算、跨天清零、坏文件容错 |
| 4 | 看不到「距下次叫醒多久/今天叫了几次/上一次结果」 | ✅ **P0 部分修**：状态灯倒计时 + 徽标（今日次数）+ 日志带 `onEventsSettled` 结果 |
| 5 | 没有节制机制：免打扰时段、每日上限、概率跳过、退避 | ⬜ 待 P1 |
| 6 | `maxRounds` 每段安静重置，一段安静可以无限长，夜里会一直叫 | ⬜ 待 P1（时段表） |
| 7 | 语言文件每次叫醒都读盘 | ⬜ 小优化，可忽略 |
| 8 | 订阅窗口硬编码 500 条 | ⬜ 已加 `origin: 'external'` 过滤，量减半；上限本身仍硬编码 |
| 9 | World 被隐藏时叫醒静默消失 | 🟡 **P0 部分修**：`onEventsSettled` 报 `discarded` 时计数回退并记日志；但「事件根本没被投递过」这种情况宿主不会通知，仍看不出来（受限于宿主接口） |
| 10 | 主循环忙时叫醒会排队迟到 | ✅ **P0 已修**：`onRunPhase` + `onlyWhenIdle`，只在 idle 时叫醒 |

### P0 具体改动（2026-11-01）

1. **渠道无关的活动检测**（`src/world.ts:262-268`）：`origin === 'external'` && 类型不以 `.self` 结尾 &&
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

**本地验证**：`smoke.mjs` 67 条断言全绿，覆盖微信/QQ/B 站/Discord 未知渠道、`*.self` 排除、
旧白名单回退、前缀忽略、空闲门控、重启续算、跨天清零、坏文件、投递结果回退、灯/徽标。
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
2. **配置组能渲染**：三个新开关（`knownChannelsOnly` / `activityIgnore` / `onlyWhenIdle`）出现在页面上，改完立即生效。
3. **微信渠道真的重置计时**：微信里发一条，`core.log` 出现 debug 级 `作息:有人回来了`，状态灯倒计时重置到 30 分钟。
4. **空闲门控**：叫醒后 Coo 正在回话的那一轮里不应再排队新的叫醒（日志里 `phase` 字段不是 `idle` 时不该有叫醒）。
5. **投递结果**：`作息:叫醒结果` 出现 `delivered`；若把 World 隐藏，看是否出现 `discarded`（宿主对「根本没投递」可能不通知）。
6. **状态文件**：`data\home\companion\data\rhythm\state.json` 生成；重启进程后「今日叫醒」不归零。
7. **徽标/灯**：状态灯悬停显示「约 X 分钟后叫醒…今日 N 次」。

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

## 8. 约定

- 源码保持**零依赖 ESM TypeScript**（跟宿主同构，`tsx` 直接加载）。
- 人读文案放 `ui-text.ts`，给模型读的正文放 `model-text.ts`，两者都要 zh/en。
- 新增配置键：必须同时出现在 `defaults()` 与配置组 schema 里，路径以 `worlds.rhythm.` 开头
  （`dryMountWorld` 会检查，缺一个直接 FAIL）。
- 新增工具：名字用 `rhythm_` 前缀，写进 `describe`，跑 `check.mjs --write` 更新 `describe.json`。
- 新增事件：写进 `describe.events`（含 zh/en 描述与 trigger）。
