# 自主发言（selftalk）fork · 开发笔记

> 这份文件只写**本地开发环境与这个 fork 的工作方式**。功能设计见 `fork-plan.md`，
> 宿主 API 详见 `host-apis.md`，Coo 现有能力详见 `coo-capabilities.md`。
>
> fork 基线：`cortico-world-selftalk@0.2.2`（npm 上最新版，2026-10 装机时的版本）。
> 上游 GitHub 仓库在本机**连不上**（`git ls-remote` → `Recv failure: Connection was reset`，
> 系统代理 `127.0.0.1:10808` 未开启），所以 fork 起点是安装目录里已装的源码，没有 git 历史。

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

- 包名 `cortico-world-selftalk`，World id **`selftalk`**，`cortico.kind = "world"`、`cortico.api = 6`。
- 入口 `src/index.ts` 导出 `WorldDefinition`：`id` / `label` / `defaults()` / `create()` / `describe`。
- 框架用 `module.registerHooks` 把 `cortico/*` 映射到宿主 `src/*`（`extensions/runtime.ts`），
  扩展与框架共享同一份模块实例；源码是 TypeScript，由宿主自带 `tsx` 直接加载，**无需构建**。
- 配置段 `worlds.selftalk`，WebUI 改完立即生效（每个 5 秒检查周期现读）。
- 默认 `enabled: false`，是否启用由 bot 声明与部署配置决定。

### 本机当前部署（2026-11-01 读 `config.json`）

| 项 | 值 |
|---|---|
| bot | `cormini`，显示名「小肥鱼」 |
| 语言 | `zh` |
| `worlds.selftalk` | **已启用**：`quietMinutes=30`、`repeatMinutes=45`、`maxRounds=3`、`jitter=0.2` |
| 同时启用的其他 World | `websearch`、`devtools`、`clawbridge`（微信桥）、`localvision` 未设 |

⚠️ `clawbridge` 已启用 —— 微信里的人和 Coo 说话**不会重置**自主发言的安静计时（见第 5 节第 1 条），
这是真机上最容易犯的错，改代码时优先处理。

### 真机日志佐证（`core.log`，2026-11-01）

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

## 4. 基线行为（0.2.2）逐条拆解

| 行为 | 代码位置 | 说明 |
|---|---|---|
| 检查周期 5 秒 | `src/world.ts:26` | `setInterval(() => this.tick(), 5000)` |
| 事件扫描窗口 500 条 | `src/world.ts:29` | `store.range({ limit: 500 })`，找最近的使用者动作 |
| 「使用者动作」白名单 | `src/world.ts:35-43` | 只有 `desktop-pet.*`（message/speech/answer/touch/figure）与 `console.*`（message/invite） |
| 时间参数 | `src/world.ts:120-129` | `quietMinutes` 0–720、`repeatMinutes` 1–720、`maxRounds` 0=不限、`jitter` 0–0.5 |
| 安静判定 | `src/world.ts:153-175` | 首次：`lastActivitySeen + quiet × jitter`；再次：`lastNudgeAt + repeat × jitter` |
| 叫醒投递 | `src/world.ts:177-198` | `pushDeferred(..., { trigger: 'flush' })`，`origin: 'internal'` |
| 投递位置 | `core/loop.ts:706-712` | internal 正文拼进同一条 user 消息的正文行，**不进 system 前缀** |
| 投递时机 | `core/bus.ts:107-110` | `flush` 不打断正在跑的回合，等轮边界（工具全返回或下一次请求前） |
| 渲染期限 | `core/loop.ts:243`、`846-855` | `render()` 超过 3 秒、抛错或返回 `null` 都等于这条事件不存在 |
| 排队作废 | `src/world.ts:190-193` | `render()` 时若期间有新人侧事件 → 返回 `null`，这条不投递 |
| 叫醒正文 | `src/model-text.ts` | 中文/英文两版，开头带 `HH:MM`；语言读部署 `config.json` 的 `language` |
| WebUI | `src/ui-text.ts`、`src/config.ts` | 一个状态灯 + 一个配置组；没有自定义面板 |
| 工具 | `src/index.ts`、`world.ts:100` | 没有工具（`tools(): []`） |

**叫醒事件正文（首次）**：

```
[15:32] [自主发言] 安静了大约 15 分钟，没有人跟你说话。现在你可以自己决定:想说话就在气泡里跟对方说点什么，想做事就用工具，自己跟自己说几句也可以；不想就结束这一轮。
```

---

## 5. 基线里明确存在的问题（改进候选，按优先级）

1. **只认两个渠道的人侧事件**：`ACTIVITY_TYPES` 硬编码 `desktop-pet.*` 与 `console.*`。
   微信桥推的是 `clawbridge.message`（`clawbridge/plugin/src/config.js:19`、`world.js:1019`），
   不在白名单里 → 用户在微信里聊天**不会**重置安静计时，插件会在人家正聊得热闹时插嘴。
   本机 `clawbridge` 与 `selftalk` 都已启用，这是真机问题。
   → 应改成「任何非 self 的外部事件」或可配置渠道表。
2. **叫醒是「定时闹钟」，不是「想起什么」**：每次正文一样，不看最近聊了什么；连续几次都没人理
   也照常按时叫。→ 需要内容感知 + 退避/自适应。
3. **不持久化**：`rounds` / `lastNudgeAt` 全在内存里，重启进程就归零；「今天叫醒了几次」无从统计。
4. **没有面板**：看不到「距下次叫醒还有多久」「上一次叫醒的结果」「今天叫了几次」，
   也没有「现在试叫一次」的按钮，调试全靠日志。
5. **没有节制机制**：没有免打扰时段、每日上限、按概率跳过、无人回应时的指数退避。
6. **`maxRounds` 每段安静重置**，但一段安静可以无限长（没人说话时 0=不限），夜里会一直叫。
7. **语言文件每次叫醒都读盘**（`model-text.ts` 的 `readFileSync`），可忽略，但改成启动时读一次更干净。
8. **订阅窗口硬编码 500 条**，长会话里人侧事件多时扫描成本与正确性都值得复核。
9. **World 被隐藏时叫醒会静默消失**：`pushDeferred` 对隐藏 World 直接丢弃（`core/core.ts:511-527`、`533-534`），
   日志里也看不出「被丢掉」。改的时候要能把这两种情况分开。

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

**注意**：同名包（`cortico-world-selftalk`）会顶掉现在装的 0.2.2。若想并存，得同时改包名与 World id，
这会影响已有配置段 `worlds.selftalk`。装之前先定这件事（见 `fork-plan.md` 的待决问题）。

---

## 7. 调试流程

1. 先跑 `check.mjs` 与 `smoke.mjs`（秒级，不碰宿主）。
2. 需要真机行为时：装包 → 重启进程 → 看日志过滤自己的 world id：

```powershell
$log = "$env:LOCALAPPDATA\Programs\Coopanion\data\logs\core.log"
Get-Content $log -Tail 200 -Encoding utf8 | Select-String -Pattern 'selftalk'
```

3. 关键路径落 JSON 快照到 `dataDir`（不要写 token / 本地绝对路径）。
4. 退出码非 0 一律先查，别信「看起来成功了」。

---

## 8. 约定

- 源码保持**零依赖 ESM TypeScript**（跟宿主同构，`tsx` 直接加载）。
- 人读文案放 `ui-text.ts`，给模型读的正文放 `model-text.ts`，两者都要 zh/en。
- 新增配置键：必须同时出现在 `defaults()` 与配置组 schema 里，路径以 `worlds.selftalk.` 开头
  （`dryMountWorld` 会检查，缺一个直接 FAIL）。
- 新增工具：名字用 `selftalk_` 前缀，写进 `describe`，跑 `check.mjs --write` 更新 `describe.json`。
- 新增事件：写进 `describe.events`（含 zh/en 描述与 trigger）。
