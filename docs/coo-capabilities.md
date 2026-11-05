# Coo 到底拥有什么：能力面技术笔记

> 调研对象：本机安装版 Coopanion 0.2.17。只读调研，未改动安装目录。
> 路径缩写（全文的"相对路径"都相对这些根）：
>
> | 缩写 | 根目录 |
> |---|---|
> | `[APP]` | `<Coopanion>\resources\app\` |
> | `[N]` | `[APP]node_modules\` |
> | `[DEP]` | `<Coopanion>\data\home\companion\` |
> | `[EXT]` | `<Coopanion>\data\extensions\node_modules\` |
> | `[PNPM]` | `[EXT].pnpm\` |
>
> 脱敏：本笔记不含任何 token / 密钥 / 完整用户 id；`[DEP].env` 里只有一项搜索 API key，未抄录。
>
> **注意**：本文调研的是**本机已装的上游插件** `cortico-world-selftalk@0.2.2`（World id `selftalk`，
> 显示名「自主发言」）。本 fork 已改名为 `cortico-world-rhythm` / id `rhythm` / 显示名「作息」，
> 代码逻辑目前仍是同一份；文中凡写 `selftalk` 的地方，换成 `rhythm` 即对应当前 fork。

---

## 1. 身份：`cortico-provider-coo` 是 provider，不是 persona

- `[N]cortico-provider-coo\package.json:32` 写的是 `"kind": "provider"`（另有 `"api": 6`，同文件 `:33`），入口 `main` 是 `./src/index.ts`（同文件 `:30`）。
- 它导出的 `COO` 对象 `satisfies ProviderModule`（`[N]cortico-provider-coo\src\index.ts:87`、`:183`），内容全是模型服务接入：协议、价格、模型列表、上下文窗口、推理档位。`describe.json:2-44` 只有 `provider` 段（`protocols` / `auth` / `input` / `reasoningTiers`）。
- **结论**：`cortico-provider-coo` 不 `declares` 任何 World，也不提供 persona / 系统提示词 / Memory / 工具。它的名字叫 "Coo Pet Provider"，只是"给 Coo 这个 bot 用的模型供应商模块"。
- 真正 `declares` World 的是 Coo 的 bot 定义：`[APP]core\companion.ts:505` → `declares: [CONSOLE.id, DESKTOP_PET.id, NOTICE.id]`，即 `console`、`desktop-pet`、`coopanion` 三个内建 World；其余 World 由扩展装载（`[APP]core\companion.ts:552-563`）。
- bot id 来自部署文件：`[DEP]deployment.json`（`{"bot": "cormini"}`），Persona 类是 `CoopanionPersona extends Cormini`（`[APP]core\persona.ts:127-129`）。

### 1.1 系统提示词结构（段 + 谁提供）

顶层模板 `[APP]build\cortico\bots\cormini\persona\PREFIX.md:1-6`，段序固定：

| 段 | 占位符 | 来源 |
|---|---|---|
| ORIENTATION | `{{persona.orientation}}` | `[APP]build\cortico\bots\cormini\persona\ORIENTATION.md`（可被部署侧 `prompts\ORIENTATION.md` 覆盖，`[APP]build\cortico\bots\cormini\index.ts:39`） |
| CONSTITUTION | `{{persona.constitution}}` | 工作区里的 `CONSTITUTION.md`（Coo 可自行改写，`[APP]core\persona.ts:4-6`） |
| PARTNER | `{{persona.partner}}` | 工作区 `PARTNER.md` 全文 + 固定提示（`[APP]core\persona.ts:28-35`） |
| 环境段 × N | `{{worlds.envPrompts}}` | 每个挂了 envPrompt 的 World 一段，逐个包壳并单独成段 `ENVIRONMENT · <world id>`（`[APP]build\cortico\bots\cormini\persona\persona.ts:403-442`） |
| MEMORY | `{{persona.memoryNote}}` | 工作区维护约定（`[APP]core\persona.ts:39-48`） |
| WORKSPACE | `{{persona.workspace}}` | 工作区文件清单（目录折叠成一行） |

- 段名/段源映射：`[APP]build\cortico\bots\cormini\persona\persona.ts:57-67`。
- 现状：desktop-pet、console、clawbridge 各贡献一个环境段；`websearch` 的 envPrompt 内容只有一个换行，被 `envPrompt.trim()` 过滤（`persona.ts:406-407`），**没有**环境段；`selftalk` 显式返回 `envPromptVars(): null`（`[PNPM]cortico-world-selftalk@0.2.2\node_modules\cortico-world-selftalk\src\world.ts:78-81`），也**没有**环境段，机制只通过叫醒事件本身说明。

### 1.2 Memory 形态

- 形态 = **工作区里的文本文件 + Git 历史**（`[APP]build\cortico\bots\cormini\persona\memory.ts:1-3`；`GitWorkspaceMemory`）。每次写工作区都由 Persona 提交一次 commit（`[APP]core\persona.ts:10-12`），`blobs/` 不进仓库（`[APP]core\persona.ts:53-54`）。
- bot 自描述里的 Memory 说明：`[APP]build\cortico\bots\cormini\index.ts:82-87`（"工作区目录里的文本文件；CONSTITUTION.md 与文件清单进系统前缀"）。
- 本机实际落盘：`[DEP]workspace\`（`CONSTITUTION.md`、`PARTNER.md`、`log\`、`archive\`、`handoffs\`、`partner\`、`blobs\`、`stickers\`），二进制走句柄 `mem:` / `log:`（`[APP]build\cortico\bots\cormini\persona\ORIENTATION.md:10-13`）。

### 1.3 Persona 自有工具（不属于任何 World）

`[APP]build\cortico\bots\cormini\persona\persona.ts:98-102`：

- 工作区文件工具：`read_file`、`write_file`、`edit_file`、`append_file`、`delete_file`、`move_file`、`list_files`、`glob_files`、`grep_files`（一句话说明 `:106-117`）
- `save_blob`（`:118-121`）
- `end_turn`（`:122`）——**唯一带屏障/结束语义的工具**：`tags:['flow']` + `barrierAfter: true` + `endsTurn: true`（`persona.ts:75-85`）
- 心跳工具不存在；心跳本身默认关闭：`tick.intervalMinutes: null`（`[APP]build\cortico\bots\cormini\index.ts:76`），`tickDelayMs` 返回 `null` 即不心跳（`persona.ts:241-244`、`heartbeat.ts:50-54`）。

---

## 2. 当前挂载的 World 与启停

框架规则：`worlds.<id>.enabled` 缺省值 = "bot 是否 declares 它"（`[APP]build\cortico\src\world.ts:99-111`、`:117-132`）；已声明的默认开，未声明的默认关、由部署配置打开。

| World id | 类型 | 启用依据 | 状态 |
|---|---|---|---|
| `desktop-pet` | 内建（npm 包，`[N]cortico-world-desktop-pet`） | 被 declares；`[DEP]config.json:10-58` 段内**没有** `enabled` 键 → 取默认 true | **开** |
| `console` | 内建（`[APP]build\cortico\src\worlds\console`） | 被 declares；config 里连段都没有 → 默认 true | **开** |
| `coopanion`（NOTICE） | 内建（`[APP]core\notice.ts:44`） | 被 declares；config 无段 → 默认 true | **开** |
| `selftalk` | 扩展 0.2.2 | `[DEP]config.json:76-82` `enabled: true` | **开**（quiet 30min / repeat 45min / maxRounds 3 / jitter 0.2） |
| `websearch` | 扩展 0.2.12 | `[DEP]config.json:59-62` `enabled: true` | **开** |
| `devtools` | 扩展 0.0.5 | `[DEP]config.json:66-68` `enabled: true` | **开** |
| `clawbridge` | 扩展 1.6.4 | `[DEP]config.json:83-86` `enabled: true`（`mediaAttach: true`） | **开** |
| — | `web` / `clawbot` / `localvision` | `[DEP]config.json:63-65`、`:69-71`、`:72-75` | **未确认**：本机安装目录内找不到这三个 id 的 World 定义（全仓 grep 无 `localvision`），疑似旧版/未安装扩展留下的配置键；其中 `web`、`clawbot` 显式 `enabled:false` |

脱敏备注：`[DEP]config.json` 里只有外观、称呼（`worlds.desktop-pet.user`）与开关，没有密钥；`activeProvider` 为 `deepseek`，`displayName` 为"Coo 的名字"（本机是"小肥鱼"）。

---

## 3. 每个 World 给模型提供的工具

**全部 6 个 World 的工具都没有 `barrierAfter` / `endsTurn`**（对 `[N]cortico-world-desktop-pet\src`、`[APP]build\cortico\src\worlds\console`、`[PNPM]` 下四个扩展源码逐一 grep，零命中）；唯一带屏障的是 Persona 的 `end_turn`（`[APP]build\cortico\bots\cormini\persona\persona.ts:75-85`）。标签语义见 `[APP]build\cortico\src\core\types.ts:189-199`。

### 3.1 desktop-pet（`[N]cortico-world-desktop-pet\src\tools.ts:15-104`）

| 工具 | 一句话用途 | tags | 屏障/结束 |
|---|---|---|---|
| `pet_say` | 在桌宠头顶气泡里说话，脚本可夹【表情,动作】与<表情>标记 | `speak` | 无 |
| `pet_ask` | 弹提问气泡（≤3 选项 + 自定义输入），答案稍后作为事件回来 | `speak` | 无 |
| `pet_move_to` | 沿屏幕底边走到/跑到某位置，或去形象包自带目标（`interruptible`，`world.ts:1756`） | `act` | 无 |
| `pet_set` | 改自己的外观与习惯（形象、配色、走动、音效、大小、气泡/字号、主题、称呼…） | `act` | 无 |
| `pet_quiet` | 临时安静（关音效、站着不动），到时自动恢复 | `act` | 无 |
| `pet_act` | 不说话，只播一串表情/动作 | `act` | 无 |
| `pet_cua_open_settings` | 电脑操作关着时，把设置窗打开到那个开关 | `act` | 无 |
| `pet_cua_screenshot` / `_zoom` | 截一块显示器 / 按原分辨率重截一块 | `read`,`snapshot` | 无 |
| `pet_cua_click` / `_move` / `_drag` / `_scroll` / `_type` / `_key` / `_focus` | 鼠标键盘与窗口前台化 | `act` | 无 |
| `pet_cua_windows` / `_wait` | 列可见顶层窗口 / 等几秒再截图 | `read` | 无 |

工具绑定与"没连上就失败"的判定：`[N]cortico-world-desktop-pet\src\world.ts:1746-1759`、`:1761-1765`、`:1767-1785`（`pet_say`）、`:1805-1820`（`pet_ask`）。

### 3.2 console（`[APP]build\cortico\src\worlds\console\world.ts:92-106`）

| 工具 | 用途 | tags |
|---|---|---|
| `console_send` | 把文本发到 WebUI「控制台」页，所有在线连接可见；回执报在线人数 | `speak` |

处理器 `world.ts:346-378`：广播 + 自己回录 `console.self`（`deliver:false`）+ 回执带"送给了几个在线连接 / 距上次发送多久 / 之后控制台有没有人说话"。

### 3.3 coopanion / NOTICE（`[APP]core\notice.ts:420`）

- 工具 = 闹钟三件套（`[APP]core\alarms.ts:148-172`）：`alarm_set`（`write`，到点用一条事件叫醒自己，`at`/`in_minutes`/`note`/`daily`）、`alarm_list`（`read`）、`alarm_cancel`（`write`）。
- 本机已有落盘闹钟：`[DEP]alarms.json`（历史上有每日 17:57 的下班提醒；详见第 7 节冲突）。

### 3.4 selftalk（`[PNPM]cortico-world-selftalk@0.2.2\...\src\world.ts:99-102`）

- **没有工具**（`tools(): []`）——它只负责"到点叫醒"，用什么工具开口是 Coo 自己和别的 World 的事。

### 3.5 websearch / devtools / clawbridge

| World | 工具（tags） |
|---|---|
| websearch（`[EXT]cortico-world-websearch\describe.json:2-58`） | `web_search`（`read`）：Brave / DeepSeek 搜索，返回带来源的结果 |
| devtools（`[EXT]cortico-world-devtools\describe.json:2-63`） | `sh`（`write`，本机 PowerShell，输出截头 120 + 尾 40 行）、`fs_read`（`read`）、`fs_write`（`write`）、`web_fetch`（`read`） |
| clawbridge（`[EXT]cortico-world-wechat-clawbridge\describe.json:2-82`） | `clawbridge_send`（`write`，只能用【】分条、<表情> 内联、可发图/表情包，**只回最近一条来消息的人**）、`clawbridge_status`（`read`）、`clawbridge_events`（`read`） |

---

## 4. 事件类型：谁会推什么

| World | 事件 type | 语义 | 默认 trigger | 人侧动作？ | selftalk 计入安静重置？ |
|---|---|---|---|---|---|
| desktop-pet | `desktop-pet.message` | 使用者在气泡/对话页打字（可带图） | `preempt` | 是 | 是 |
| desktop-pet | `desktop-pet.speech` | 使用者说的话的转写 | `interrupt` | 是 | 是 |
| desktop-pet | `desktop-pet.answer` | `pet_ask` 的回答，或问题被关掉未答 | 缺省 | 是 | 是 |
| desktop-pet | `desktop-pet.touch` | 戳/摸/甩出去/拎起放下 | `debounce` 或 `piggyback` | 是 | 是 |
| desktop-pet | `desktop-pet.figure` | 使用者换形象/装扮，或形象加载失败 | `flush`/`debounce` | 是 | 是 |
| desktop-pet | `desktop-pet.self` | **Coo 自己**说的话与做的事，只给对话页，永不投给模型 | —（`deliver:false`） | 否（Coo 自己） | 否 |
| console | `console.message` | 有人在控制台页发言（可带图），`origin:internal` | `flush` | 是 | 是 |
| console | `console.invite` | 有人按了控制台页"开始对话"按钮 | `flush` | 是 | 是 |
| console | `console.self` | **Coo 自己**在控制台发的消息回录 | —（`deliver:false`） | 否（Coo 自己） | 否 |
| coopanion | `coopanion.guide` | 使用向导结束 | `flush` | 应用侧 | 否 |
| coopanion | `coopanion.alarm` | **Coo 自己**定的唤醒到点 | `flush` | 否（Coo 自己/定时） | 否 |
| coopanion | `coopanion.alarm-cancelled` | 使用者在设置窗取消了闹钟 | `debounce` | 是 | 否 |
| coopanion | `coopanion.updated` | 应用升级，附更新说明 | `flush` | 应用侧 | 否 |
| coopanion | `coopanion.settings-changed` | 使用者改了桌宠外观/习惯 | `debounce` | 是 | 否 |
| selftalk | `selftalk.nudge` | 安静到时，**应用**叫醒 Coo 的一条自主发言提示（`origin:internal`） | `flush` | 否（应用侧） | 否 |
| clawbridge | `clawbridge.message` | 一条微信私聊消息（媒体另存） | `debounce` | 是 | **否** |

出处：
- desktop-pet 六个类型：`[N]cortico-world-desktop-pet\src\definition.ts:40-67`；推送点 `world.ts:601,629,825,1112,1250,1261,1306,1716`；`SELF_TYPE = 'desktop-pet.self'` 与对话页白名单 `[N]...\src\chat.ts:15,18`。
- console 三个类型：`[APP]build\cortico\src\worlds\console\definition.ts:21-36`；推送点 `world.ts:485-496`（message）、`:527-537`（invite）、`:361-370`（self）。
- coopanion 五个类型：`[APP]core\notice.ts:516-520`；`pushDeferred` 调用点 `:416,456,467,481,498`。
- selftalk：`[PNPM]cortico-world-selftalk@0.2.2\...\src\world.ts:23`（`NUDGE_TYPE`）、`:186-197`（`pushDeferred` + `flush`）、`describe.json:1-13`。
- clawbridge：`[EXT]cortico-world-wechat-clawbridge\describe.json:84-93`；源码 `dist\index.js:81113-81125`（`deliver: true, trigger: "debounce"`）。

### 4.1 「使用者动作」的权威清单（自主发言插件视角）

`[PNPM]cortico-world-selftalk@0.2.2\...\src\world.ts:35-43` 的 `ACTIVITY_TYPES` 恰好 7 个：

```
desktop-pet.message, desktop-pet.speech, desktop-pet.answer,
desktop-pet.touch,  desktop-pet.figure,
console.message,    console.invite
```

设计说明同文件 `:31-34`、`:5-9`：Coo 自己的自录事件不算（否则第二轮叫醒永远等不到）。**未列入的就是"不算使用者回来了"**：`clawbridge.message`（微信里聊得再热也算安静）、五个 `coopanion.*`、`selftalk.nudge` 本身。Coo 自己的工作区笔记也实测到这一点（`[DEP]workspace\partner\self-initiated-chat.md:34`）。

---

## 5. 「主动开口」现在能走的路

| 通道 | 工具 | 话最终出现在哪 | 能否带表情/动作 | 能否带语音 | "对方在不在"信号 |
|---|---|---|---|---|---|
| 桌宠气泡 | `pet_say` / `pet_ask` | 屏幕底边桌宠头顶气泡（图片只进对话页，不进气泡） | **能**：`【表情,动作】`先做再换气泡、`<表情>`边打字边做（`[N]...\src\tools.ts:19-27`；环境提示词 `[N]...\describe.json` 的 `prompts` 段有同一张标记表） | **不是 TTS**：气泡逐字显示时按音节播一个"动物森友会式"音库（`[N]cortico-world-desktop-pet\src\speech\index.ts:1-13`、`[N]...\web\speech.js:1-11`），音高/速度可配（`[N]cortico-world-desktop-pet\src\config.ts:276`，默认 `speech.enabled: false`；本机 `[DEP]config.json:50` 的 `sound` 也是 `false`） | 有软信号：桌宠窗口没连上时 `pet_say`/`pet_ask` 直接失败并返回原因（`world.ts:1761-1765,1774,1814`）；回执里带 `chatOpen`（对话页是否开着）与气泡占用时长（`world.ts:1784`） |
| 控制台页 | `console_send` | WebUI「控制台」对话页 | 不能（纯文本） | 不能 | 有：回执报当前在线连接数与名单（`world.ts:78-83,306-319,371-374`） |
| 微信 | `clawbridge_send` | 微信 1:1 私聊 | 能：`【害羞】`→表情、`<wink>` 内联、`sticker:<name>` 发表情包 | 不能（只有文字/图） | 有：`clawbridge_status`；且**通道本身是 reply-only**，对方 24h 内没先说就失败"他还没先说话"（`[EXT]...\describe.json:99`） |
| 到点自己醒 | `alarm_set` | 只是叫醒自己，话还得再由上面三条之一说出 | — | — | 无 |

要点：

1. **能让 Coo 在桌宠气泡里说话的只有 `pet_say`（和 `pet_ask`）**。这就是"主动发言"唯一的气泡出口；`console_send`/`clawbridge_send` 分别通向另外两块屏幕/设备。
2. `pet_say` 的脚本是"文本 + 标记"的混合串，标记词来自当前形象的词表（换形象时 `[figure]` 事件或 `pet_set` 回执会说明词表变化，`[N]...\describe.json` prompts 段）。空脚本只在随图时合法；没有可说内容时工具会拒绝（`world.ts:1772-1773`）。
3. **没有任何内建的"人在不在"信号**：核心没有 presence/idle 事件；环境提示词里也没给"对方在不在"。现有做法是 Coo 自己用 `sh` 跑工作区里的 `partner/idle.ps1` 看 `idle_seconds` / `locked`（`[DEP]workspace\partner\self-initiated-chat.md:14,22`）——即**靠 devtools + 自写脚本补这个缺口**。桌面端的 `pet_cua_*` 在被"人动了机器"打断时回执里会带活动/前台信息（`[N]...\src\cua\cua.ts:474-486`），但那要开电脑操作，且是副作用而非查询接口。
4. 叫醒文案只写"安静了约 N 分钟，没有人跟你说话…想说话就在气泡里跟对方说点什么"，**不含在不在的判断**（`[PNPM]...\src\model-text.ts:42-48`）。

---

## 6. 可复用能力与联动点

| 能力 | 现成工具 | 与"主动发言"的联动点 |
|---|---|---|
| devtools | `sh` / `fs_read` / `fs_write` / `web_fetch` | 目前唯一的"在不在"探测手段（跑 `partner/idle.ps1`）；也能读自己的 log/notes 来组织话题 |
| websearch | `web_search` | 给主动开口供料（"看到有趣的东西"）；本机 envPrompt 为空，模型只从工具描述知道它 |
| clawbridge | `clawbridge_send` / `_status` / `_events` | 桌宠不在时的第二出口，但 reply-only + 24h 窗口，**不能用来主动搭话** |
| coopanion | `alarm_set` / `_list` / `_cancel` | 定时开口（"到点提醒下班"），与 selftalk 的随机叫醒是两套机制 |
| desktop-pet | `pet_say` / `pet_act` / `pet_move_to` / `pet_quiet` / `pet_set` | 开口 + 表演 + 收声；`pet_quiet` 是"对方在忙"时自己闭嘴的正规手段 |

---

## 7. 现在已有的重复/冲突机制

1. **两套"叫醒"并存**：`selftalk`（安静→叫醒，配置 30/45/3）与 `coopanion` 的 `alarm_set`（定时叫醒）。代码层没有互斥，谁都能把 Coo 叫起来；本机靠 Coo 自己的笔记约定"不再给主动搭话上闹钟，只用插件"（`[DEP]workspace\partner\self-initiated-chat.md:8-10`）——是**自律，不是机制**。
2. **三个 `speak` 出口没有统一策略**：`pet_say`(speak)、`console_send`(speak)、`clawbridge_send`(write) 都能"说话"，标签还不一致（微信那个是 `write`），没有任何一处约束"同一句话只能走一个通道"。
3. **安静计时与真实互动范围不一致**：`clawbridge.message` 不计入 `ACTIVITY_TYPES`，微信里正在热聊时 selftalk 仍会按 30 分钟叫醒（源码见 §4.1，Coo 自己也实测到，`self-initiated-chat.md:34`）；`coopanion.settings-changed`（人真的动了设置）也不计入。
4. **配置里的幽灵键**：`worlds.web` / `worlds.clawbot` / `worlds.localvision` 有配置无实现（本机 grep 无定义），而真在跑的是 `worlds.clawbridge`——`clawbot` 与 `clawbridge` 的命名重复容易误导（Coo 的旧笔记里就写成 `clawbot_send`，实际工具名是 `clawbridge_send`）。
5. **心跳与 selftalk 功能重叠但当前不冲突**：Persona 自带 `Heartbeat`（`[APP]build\cortico\bots\cormini\persona\heartbeat.ts:1-11`），默认 `tick.intervalMinutes: null` 关闭（`[APP]build\cortico\bots\cormini\index.ts:76`）；一旦有人把它打开，就会和 selftalk 抢叫醒。
6. **`end_turn` 是唯一的结束语义**：所有 World 工具都没有 `endsTurn`，所以"说完话顺手结束这一轮"只能靠 Persona 的 `end_turn`；自主发言的"不想说就结束这一轮"依赖它。

---

## 8. 未确认 / 已知边界

- `worlds.web`、`worlds.clawbot`、`worlds.localvision` 三个配置段的归属：本机安装目录内未找到对应 World 定义，**未确认**它们是否由某个未安装扩展提供。
- `localvision`（`[DEP]config.json:72-75`，`localModelEnabled/localModelPriority`）未见任何代码读取点，**未确认**是否已废弃。
- 微信 ClawBridge 的本体是打包产物 `[EXT]...\clawbridge\dist\index.js`（世界 id 见 `:65188`，事件推送见 `:81113-81125`），其内部"正在输入"等界面行为按配置 `typingIndicator` 走，未逐条核对。
- 语音：桌宠的"说话声"是音节音库合成（非 TTS）；是否有真正的语音输出通道，**未确认**（本机未启用 `sound`）。
- 工作区内另有一份 selftalk `0.3.0` 源码副本（`<repo>\`），`describe.json` 与已装 0.2.2 相同；两者差异未逐行比对。
