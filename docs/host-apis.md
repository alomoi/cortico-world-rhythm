# Coopanion/Cortico：一个 World 能用的运行时能力

面向下一个接手「作息」（rhythm）插件的开发者。结论全部来自真实源码；引用路径相对源码根
`C:\Users\Administrator\AppData\Local\Programs\Coopanion\resources\app\build\cortico\src\`，格式 `文件:行号`。

先记住一句话：**World 只拿得到 `WorldHost`（`core/types.ts:679-741`）和 `WorldContext`
（`world.ts:31-50`）。`CoreApi`（`core/types.ts:514-546`）是 Persona 的，World 拿不到。**

## 0. 两个对象，别搞混

`WorldHost` 的成员穷举（`core/types.ts:679-741`）：`pushEvent` / `pushDeferred` / `pushCandidate?`
（684-703）、`store`（704）、`drainPendingEvents` / `withdrawPending?` / `promotePending?`（709-720）、
`modelFacts` / `blob` / `reportUsage` / `llmStalls?`（722-737）、`cognition?`（739）、`log`（740）。

**不在 `WorldHost` 里的**：`timers`、`deliveryGate`、`injectInternal/injectDeferred/injectExternal`、
`spawnFork`、`llm`、`personaState`、`toolsTagged`——全在 `CoreApi`（Persona 专用，`core/core.ts:227-249`）。
这是本框架最容易误判的一点，见 §3 与 §13 坑 2。

`WorldContext`（`world.ts:31-50`）：`id` / `cfg` / `timezone` / `botName` / `botDir` / `packageDir` /
`dataDir` / `repoRoot` / `secret()` / `storeSecret()` / `persist()` / `restart()`。

- `cfg` 是 `worlds.<id>` 段的**活引用**（`world.ts:33`）：每次现读 `ctx.cfg.xxx` 才热生效，别在构造函数里解构。
- `persist(patch)` 深合并进 `worlds.<id>`，活对象与 config.json 同步，数组整体替换（`world.ts:46-47`）。
- `restart()` 按 `cfg.enabled` 同步：启用中则重启，禁用则停止（`world.ts:49`、`world.ts:483-493`）。
- `storeSecret(name, value)` 写部署 `.env` 并刷新 `process.env`；name 须是环境变量名，值不能为空或含空白
  （`world.ts:44-45`、`world.ts:194-204`）。
- 实例 id 必须等于定义 id，否则整条定义进 missing（`world.ts:244-253`）。
- `defaults()` 必须返回对象且 `enabled: false`（`extensions/dry-mount.ts:137-143`）；`create()` 必须在
  **默认配置、无密钥**下就能构造成功，因为装配层会构造每个可用定义（`extensions/dry-mount.ts:150`）。

## 1. 推事件（三种）

### 1.1 `pushEvent` —— 立即落库

```ts
pushEvent(
  e: Omit<EventEnvelope,'cursor'|'origin'|'contextDelivery'|'blobs'> & { origin?: EventOrigin; blobs?: BlobInput[] },
  opts?: PushOptions,
): Promise<EventEnvelope>            // core/types.ts:684-687
```

- `origin` 缺省 `external`（`core/core.ts:517`）。
- `opts.deliver === false` → 只落库，`contextDelivery` 记 `archive-only`，不进总线（`core/core.ts:511-527`）。
- `opts.trigger` 缺省：external = `debounce`，internal = `flush`（`core/bus.ts:65-66`）。
- **隐藏的 World**：事件仍归档但不投递，并限频 warn（`core/core.ts:511`、`core/core.ts:434-445`）。
- 宿主租约失效（World 被卸载）后再推抛 `HOST_LIFECYCLE_ENDED`（`core/core.ts:509`）。

```ts
// 自录一条已发出的发言：只留档，不把自己吵醒
await host.pushEvent({
  type: 'rhythm.spoke', ts: nowIso(ctx.timezone), source: this.id,
  text: `[${shortTime(ctx.timezone)}] 我说：${body}`,
  senderKey: 'self',          // 稳定过滤键，store.range/grep 可按它筛
  meta: { body },             // 私有数据，不进上下文
}, { deliver: false });
```

### 1.2 `pushDeferred` —— 投递时才渲染

```ts
pushDeferred(
  e: Pick<DeferredEventSpec,'type'|'senderKey'|'meta'|'tags'|'render'> & { origin?: EventOrigin },
  opts?: { trigger?: TriggerMode },
): void                              // core/types.ts:692-695
```

- `render()` 在投递时调用，**读现有状态，不做长时间采样**（`core/types.ts:70-73`）。
- **返回 `null` ⇒ 不落库、不投递、不占游标**（`core/types.ts:71`、`core/loop.ts:671`）。
  这是「到点看一眼，没话可说就闭嘴」的正规写法。
- 抛错同样丢弃并 warn（`core/loop.ts:856-858`）；**渲染期限 3 秒**，超时也丢弃
  （`core/loop.ts:243`、`core/loop.ts:846-855`）——渲染里别做 IO。
- 排队项不持久化、不参与重启补投（`core/types.ts:72`）；隐藏 World 的延迟项直接丢弃
  （`core/core.ts:533-534`）；不参与关键词匹配、不计入外部事件条数（`core/bus.ts:5-6`、`core/bus.ts:74-75`）。

### 1.3 `pushCandidate` —— 原始归档 + 投影

`pushCandidate?(spec, opts?)`（`core/types.ts:700-703`）。每条 `sourceEvents` 单独以 `archive-only` 归档，
至少一条否则抛错（`core/core.ts:542-550`）。`project` 在**投递时**按「同 source + 同 origin + 同函数」
分组整批调一次（`core/types.ts:113-116`、`core/loop.ts:750-762`），生成的正文排在当前批即时事件**之后**
（`core/loop.ts:653-666`）；`candidateIndexes` 越界/重复 ⇒ 整条投影跳过并 warn（`core/loop.ts:770-777`）。
用途是把一堆平台消息合成一句「他们在聊 X」；作息插件通常用不到。

### 1.4 `TriggerMode` 的真实差别

定义 `core/types.ts:604-620`，行为在 `core/bus.ts:63-121` 与 `core/loop.ts`。

| trigger | 做什么 | 打断在跑的回合？ |
|---|---|---|
| `preempt` | 立即投递；取消**尚未外化**（没产生正文/拒答/函数调用）的在途模型轮，丢弃该轮输出，同批重新请求 | 只打断未外化的轮（`core/loop.ts:431-441`） |
| `interrupt` | 立即投递；取消当前模型轮（**已外化输出保留**）；`interruptible` 工具收 signal；本轮尚未开始的调用不执行 | 会（`core/loop.ts:447-470`、`core/loop.ts:1266-1312`） |
| `flush` | 立即投递整批积压 | **不会**：只 `deliver()`，不通知主循环（`core/bus.ts:107-110` vs `core/bus.ts:141-146`） |
| `debounce` | `min(首件+maxBatchAge, max(首件+minBatchAge, 末件+quietGap))`（`core/bus.ts:124-133`） | 不会 |
| `piggyback` | 只入队，不启动/延后计时器，不算唤醒项，不单独获得投递许可（`core/bus.ts:7`、`core/bus.ts:111-112`、`309-311`） | 不会 |

- 外部事件达 `maxBatchSize` 立即投递（`core/bus.ts:116-119`，只计非 piggyback 的 external）。
- `flush` 命中时若无消费者在等（正跑模型/工具），只把 `ready` 置真，事件在**轮边界**被取走：
  工具全返回后（`core/loop.ts:1466-1469`）或下一次请求前（`core/loop.ts:1158-1165`）。
  所以长模型调用中 `flush` 可能沉默十几秒；要立刻打断只能用 `preempt`/`interrupt`。
- 被 `preempt`/`interrupt` 取消的轮**计入轮数**（`core/loop.ts:1208-1210`），狂发会烧光 `rounds().hard`。
- 人工暂停优先级最高，暂停时事件照常落库排队（`core/bus.ts:135-138`、`core/bus.ts:163-170`）。

### 1.5 队列上的三个可选手术

- `drainPendingEvents(filter)`：按原序取走**尚未投递的外部即时事件**，取走后不再重复投递，并标记已处理
  以免水位卡住（`core/core.ts:569-577`）。
- `withdrawPending(cursor)`：撤回本 World 一条未投递事件，追加 `core.withdrawal` 记录，重启不再补投
  （`core/core.ts:578-584`、`core/loop.ts:1542-1553`）。
- `promotePending(cursor, 'flush'|'preempt'|'interrupt')`：让一条排队项立即触发；暂停或闸门未放行时只取消
  它的 piggyback（`core/core.ts:585-586`、`core/bus.ts:148-161`）。

## 2. 读事件

`host.store` 是 `EventStoreReader`（`core/types.ts:167-174`）：`get` / `latestCursor` / `range` / `around` / `grep`。

- 落库 `data/runs/<run>/events.jsonl`，一行一个；`cursor` 跨 run 全局单调，开机从已有分片末行续号
  （`core/event-store.ts:1-6`、`core/event-store.ts:203-216`）。
- 分片按需装载，只缓存**最近一次查询**读到的历史分片（`core/event-store.ts:110-115`、`188-201`）；
  历史查询整文件 `readFileSync`（`core/event-store.ts:180`）——跑得越久，跨分片 `grep` 越贵。
  **定期扫描务必带 `fromCursor`/`fromTs`。**
- `range` 的 `limit` 是「从区间**末尾**取至多 limit 条」，返回仍按游标升序（`core/types.ts:143`、
  `core/event-store.ts:295-299`）。无 `fromCursor`/`fromTs` 且给 `limit` 时从尾部分片倒着凑，不触碰更早历史
  （`core/event-store.ts:261-280`）——这是唯一便宜的查法。**未在源码中确认 `limit` 有硬上限**：
  `limit >= 0` 即生效、无 clamp（`core/event-store.ts:259`），安全上限取决于你的调用方式。
- `around(cursor, before, after)` 夹到 `[1, latestCursor]`（`core/event-store.ts:302-307`）；
  `grep` 是不区分大小写的**纯文本包含**，每命中附前后 `context` 条，邻近记录不经过筛选
  （`core/event-store.ts:313-331`、`core/types.ts:147-159`）。
- 时间区间可与 cursor 区间并用，`ts` 只按时刻比较；不带偏移的 `fromTs/toTs` 按配置时区读
  （`core/event-store.ts:76-88`、`core/util.ts:89-98`）。
- `EventEnvelope`（`core/types.ts:30-67`）：`cursor` / `run?` / `type` / `ts`（ISO 带偏移）/ `source` / `origin` /
  `tags?` / `contextDelivery?` / `text` / `senderKey?` / `meta?` / `blobs?` / `ephemeral?`。

事件如何进入上下文（`core/loop.ts:638-737`）：

- **internal** 正文拼进**同一条 user 消息**的正文行（`core/loop.ts:706-712`、`719-720`）：
  **不进 system 前缀**，也不单独成消息。
- **external** 按 `SessionDecl.eventDelivery`（缺省 `'tool'`，`core/loop.ts:626-629`）：
  `tool` 模式合成一对 `external_event_frame` 调用/回执承载，**不新增模型请求**
  （`core/loop.ts:197`、`868-878`），模型仿造该名字的调用写库前丢弃（`core/loop.ts:884-891`）；
  `user` 模式接在那条 user 消息内部行**之后**（`core/loop.ts:713-731`）。
- 两种模式下 Core **都不改写正文**（`core/types.ts:48-52`）：谁是使用者、谁在说话，全靠你在 `text`/
  `senderKey` 里写清楚，没有框架级「这条是用户动作」的标注。
- 多模态：`blobs` 随事件保存，`modelFacts.accepts(mime)` 决定是否附二进制，否则只发 `fallbackText`
  （`core/types.ts:57-61`、`590-597`）。

## 3. 定时器（World 拿不到，必须自己排）

`TimersApi`（`core/types.ts:557-566`）**只挂在 `CoreApi`**（`core/types.ts:532`、`core/core.ts:236`），
`WorldHost` 没有它（`core/types.ts:679-741` 穷举）。所以：

- 本进程内可用普通 `setTimeout` 排期，但进程重启即丢。
- 要跨重启，只能把「下次该醒的时刻」写进自己的持久状态（`ctx.persist()` / `ctx.dataDir` 文件 / `ctx.cfg`），
  在 `start()` 里按存档重排 `setTimeout`。
- `TimersApi` 语义仍值得知道（Persona 侧在用）：到期回调**在 `set` 返回之后**才发生，包括 `atIso` 已过去
  的条目（`core/types.ts:558`）；超 `2**31-1` ms 分段重新 arm（`core/timers.ts:11`、`90-95`）；
  `fire` 先删条目、`save()`、再回调（`core/timers.ts:98-110`）；**重启后 `start()` 会把已过期条目立刻 fire**
  （`core/timers.ts:32-36`、`82-86`）；`payload` 对 Core 完全不透明（`core/types.ts:548-554`）；
  落盘 `data/timers.json`，tmp + rename 原子覆盖（`core/timers.ts:124-129`）。
- 结论：插件的「定时叫醒」= 自管 `setTimeout` + 存档，**并且**在 `start()` 与 `onHandoffEnded()` 里
  对账一次「错过的时刻」。

## 4. 注入上下文（Persona 专用，World 绕着走）

`CoreApi`（`core/types.ts:514-546`）：`injectInternal`（`core/loop.ts:1989-1997`）、
`injectDeferred`（`2015-2018`）、`injectExternal`（`1999-2012`）。`source` 被硬编码为 `persona`
（`core/loop.ts:1991`、`2006`、`2017`），World 调用不到也不该调用。

World 的等价物是 `pushEvent(..., { trigger: 'flush' })`（internal）。两者走同一总线、同一套投递闸门与
同一批成文逻辑（`core/types.ts:12-15`），差别只在 `source` 字段与默认 trigger（internal 默认 `flush`，
`core/bus.ts:66`）。

## 5. 工具

`ToolDef`（`core/types.ts:261-280`）= `ToolSchema` + `tags`（必填）+ `barrierAfter?` + `endsTurn?` +
`interruptible?` + `handler`。`handler` 返回 `string` 或 `{ text, blobs?, failed? }`（`core/types.ts:253-258`）；
抛错或返回形状不对一律转失败回执（`core/types.ts:260`）。四个开关的真实语义：

- `barrierAfter`：模型读到本结果后才能继续；同一条 assistant 输出里排在它后面的调用被跳过
  （`core/types.ts:264-268`、`core/loop.ts:1410-1413`）。
- `endsTurn`：完成后**结束本次唤醒**，不再调下一轮模型，期间到达的事件退回总线
  （`core/types.ts:269-273`、`core/loop.ts:1446`、`1471-1485`）；通常与 `barrierAfter` 同用。
- `interruptible`：`interrupt` 到达时 `ctx.signal` 触发，Core 等 handler 返回已完成部分并在回执末尾注明
  （`core/types.ts:274-279`、`core/loop.ts:2135`、`2155`）；缺省则执行到底。
- `tags`：`read|write|speak|act|flow|snapshot`（`core/types.ts:189-199`），**不发给模型**，
  供装配与 `toolsTagged()` 用；空数组会有告警（`core/types.ts:262`、`extensions/dry-mount.ts:184-185`）。

`ToolCallContext`（`core/types.ts:226-247`）里两条对插件关键：

- `queueExternalEvents(events)`：工具执行期间拿到的事件交给主循环，**在本轮工具结果之后投递**
  （`core/types.ts:230-234`、`core/loop.ts:1192-1194`、`1464-1478`）。平台轮询类工具走这条，别自己 push。
- `signal`：关机、换代、跨进程超时，`interruptible` 工具还会因 interrupt 触发；**提交外部副作用前必须检查**
  （`core/types.ts:239-247`）。

工具名必须全局唯一且不能是 Core 保留帧名，否则装配层拒绝挂载（`extensions/dry-mount.ts:177-181`、
`core/loop.ts:204-205`）；缺 `tags` 是失败，名字不带 `<短名>_` 前缀只是告警（`extensions/dry-mount.ts:184-186`）。

## 6. WebUI

`World.webUi?(language?)` 每次请求现算、不缓存（`core/types.ts:913-917`）；`WorldWebUiDecl`
（`core/types.ts:840-870`）：

```ts
label?; lamps?; badges?; panels?; invoke?; stream?; promptDocs?; storage?; links?; config?
```

- `panels`：本页内唯一 id，只允许 `[a-z0-9-]`，不带 World 前缀（`core/types.ts:773-780`、
  `extensions/dry-mount.ts:66`、`204-208`）；`getMethods` 声明允许 GET 的方法，省略则只接受 POST
  （`core/types.ts:778-779`）。
- `invoke(panel, method, args)`：默认返回 JSON；返回 `{ $binary: { mime, base64 } }` 时响应为二进制；
  未实现时 503（`core/types.ts:850-854`）。路由 `/api/webui/providers/<page>/panels/<panel>/<method>`
  （`web/server.ts:2340-2341`），页面 id 为 `world:<id>`（`web/shared/webui-protocol.ts:73-75`、`bot.ts:624`）。
- `stream(panel, socket)`：**每条连接调一次**，多连接广播自己做；未实现时拒绝握手（`core/types.ts:855-859`）。
  WS 路径 `/ws/providers/<page>/panels/<panel>`（`web/server.ts:866`）；`WorldStreamSocket`
  见 `core/types.ts:1071-1079`（连接已关时 `send` 静默忽略）。
- `lamps`：`online|loading|error|offline`，最多 `MODULE_LAMP_MAX = 7`（`core/types.ts:820-837`）；
  `badges`、`links`（`inheritTheme` 附带当前主题快照）、`storage`（列在本 World 页的数据页签，
  `core/types.ts:743-760`）、`config`（§7）、`promptDocs`（§8）。
- 面板离不开浏览器 bundle：声明了 `panels` 但 manifest 无 `cortico.webUiClient`，`check:extension` 给 warning
  （`extensions/dry-mount.ts:209-211`）；bundle 在 `cortico.webUiClient` / `webUiStyle` 声明
  （`extensions/README.md:25-26`），浏览器侧对 `cortico/*` 只允许 `import type`（`extensions/README.md:78`）。
- 现成范例：`worlds/console/world.ts:249-288`（只声明 `stream` 与 `config`）。

## 7. 配置（`ConfigGroup`）

形状 `{ id, owner: 'world:<id>', schema: { type:'object', title, properties } }`（`core/config-schema.ts:58-64`）。
`ConfigProperty`（`16-48`）支持 `integer|number|boolean|string|array|object`，实际可写只有前五类
（`196-197`）。扩展属性 `x-scale` / `x-suffix` / `x-hot=false`（改后需重启）/ `x-options`（动态下拉，
`WorldDefinition.configOptions(kind, language)` 供值，`world.ts:60-64`）/ `x-path` / `x-download` / `x-warning`
（`core/config-schema.ts:5-11`、`30-47`）。

**两条硬约束**（`extensions/dry-mount.ts:47-62`）：每个键必须以 `worlds.<id>.` 开头（否则写入跟着路径走，
值会落到别人的段里）；该路径必须在 `defaults()` 里有对应项（否则「旋钮能转、值也写了、代码读的还是兜底值」）。

`getByPath` 按 `.` 分段只读取（`78-85`）；`setByPath` 只替换叶子以保住父对象引用（`87-98`）；WebUI 提交时
**未声明的键整体拒绝**并列出可写键（`134-153`）；`null` 必须在数值转换前处理，`Number(null)` 会把「清空」
变成 0（`184-190`）。

```ts
const GROUP: ConfigGroup = {
  id: 'rhythm', owner: `world:${ID}`,
  schema: { type: 'object', title: '作息', properties: {
    [`worlds.${ID}.quietGapMs`]: { type: 'integer', title: '安静多久后开口', minimum: 1000, 'x-hot': true },
    [`worlds.${ID}.wakeAt`]:    { type: 'string',  title: '下次叫醒时刻(ISO)', 'x-hot': true },
  } },
};
// defaults() 必须同时给出 quietGapMs 与 wakeAt，否则 check:extension 报错
```

## 8. 提示词模板（`promptDocs`）

`PromptDocDecl`（`core/types.ts:799-818`）：`key`（全局唯一，惯例 `worlds.<World>.<名>`）、`title`、
`description`、`path`、`deploymentPath?`、`role?: 'envPrompt'|'prefix'`、`vars?`。文件不存在时读作空、首次保存
时创建；绝对路径不下发浏览器（`795-798`、`804-805`）。

`role: 'envPrompt'` 的模板用 `World.envPromptVars()` 渲染（`860-861`、`905-910`、`962-968`）：返回 `null`
⇒ **省略该 World 的环境段**，返回空对象 ⇒ 保留无变量的模板全文（`906-908`）；每次前缀重建（含交接）都重调。
模板内容只应按自己的输入变化，每次都变就打穿前缀缓存（`core/types.ts:1033-1038` 对 `sessionHead` 的同类告诫）。

## 9. 存储

- `ctx.cfg` + `ctx.persist(patch)`：进 config.json 的 `worlds.<id>`，可被 WebUI 编辑（`world.ts:46-47`）。
- `ctx.dataDir` 下自建文件：最自由，原子写自己保证（可仿 `core/timers.ts:124-129` 的 tmp+rename）。
- `webUi().storage: StoragePart[]`：只声明「可清除的单元」供 WebUI 显示与清空（`core/types.ts:743-760`），
  不提供读写 API。
- `host.blob(handle)`：只读解析 `log:` / `mem:` 句柄（`723-727`、`core/core.ts:255-260`）。
  **保存新附件必须走事件或工具回执的 `blobs` 字段**，没有 World 侧的写入口。

## 10. 生命周期

| 成员 | 时机 | 备注 |
|---|---|---|
| `start(host)` | 挂载时 | 抛错 ⇒ 移出挂载表、记 `start-failed`（`core/core.ts:619-643`） |
| `stop()` | 停用/重启/关机 | 受 `MODULE_STOP_MS = 20_000` 期限约束（`core/core.ts:49`、`688`、`748`） |
| `onHandoffEnded()` | 新前缀与保留上下文已装入、总线**尚未**恢复投递 | 此时推的事件进新 session 的第一批（`core/types.ts:926-930`、`core/loop.ts:1719-1723`） |
| `onTurnEnded()` | assistant 自然结束 / LLM 失败 / 轮数到硬上限 | Persona 先于 World 调用（`core/loop.ts:609-624`） |
| `onEventsSettled(events, outcome)` | 本 World 事件离开队列：`delivered` 已写入 session，`discarded` 被操作者清空 | `withdrawPending` 撤回的不通知；`drainPendingEvents` 取走的只在之后经 `queueExternalEvents` 写入时通知（`core/types.ts:936-941`、`core/loop.ts:1556-1568`） |
| `onRunPhase(phase)` | RunPhase 变化，**同步**调用 | 只记录状态，别做耗时操作；隐藏 World 不收（`core/types.ts:942-946`、`core/loop.ts:402-420`） |
| `shutdownVerification(language)` | `stop()` 之后 | 只返回缓存的检查结果，别现发网络请求（`core/types.ts:947-951`） |

`RunPhase`（`core/types.ts:884-900`）：`state: idle|delivering|model|tools|backoff|handoff`，外加 `round?` /
`running: string[]` / `retryAt?` / `enteredAt`；三个判别字段都没变时不重复发射（`core/loop.ts:376-387`）。

`WorldLifecycleEvent`（`core/types.ts:986-993`）：`mounted|unmounted|restarted` / `visibility` /
`start-failed|failed`。注意它是 **Persona 的**钩子（`core/types.ts:1026-1027`，由 `bot.ts:909` 转交），
World 收不到自己或别人的生命周期事件。

## 11. 认知请求

`host.cognition?.request(req)`（`core/types.ts:653-656`）：

- `CognitionRequest`（`634-647`）：`brief` 必填（空 ⇒ `error`，`core/core.ts:386`）；`tools` 只能引用**本 World
  自己的工具**，越界以 `error` 返回（`637-641`、`core/core.ts:390-397`）；`hint.rounds` 只是参考。
- 所有失败都通过 `{ error }` 返回，包括校验失败与 Persona 抛错（`652-656`）。
- `Persona.cognition.enabled?.()` 每次读 `host.cognition` 时现查，false 时返回 `undefined`
  （`668-676`、`core/core.ts:593-596`）——**必须判空**。
- Core 统计该 World 在途并发数（`CognitionContext.running`），限流由 Persona 决定（`658-665`、
  `core/core.ts:399-409`）。
- World 自带模型的调用不经过此接口，用量用 `host.reportUsage()` 自报（`728-732`、`core/core.ts:605-617`）。

## 12. 输出流监听

`World.outputTap?(): OutputTap | undefined`（`core/types.ts:918-922`）：装配层合并所有已挂载 World 的接收器，
随挂载变化更新；这一刻没有接收器时返回 `undefined`，合并侧跳过。

`OutputTap`（`446-456`）：`onEvent(StreamEvent)` / `externalizes?(event)` / `onRoundEnd?()` / `onAbort?(reason)`。
未声明 `externalizes` 时按 `defaultExternalizes` 判定（正文或拒答增量、或出现函数调用，`458-462`）；返回 true
表示已产生外部输出，此后 `preempt` 不再取消该轮（`449-453`、`core/loop.ts:1240-1241`）；tap 抛错只记 warn，
不中断模型调用（`core/loop.ts:1243`、`1131-1137`）。这是「边生成边知道说了什么」的唯一入口。

## 13. 容易踩的坑

1. **internal/external 的界限**：`internal` 只用于内部机制或已认证操作员通道，「不得用于来源未经认证的外部
   内容」（`core/types.ts:680-683`）。平台上的陌生人发言必须 `external`。
2. **`WorldHost` 没有 `timers`/`deliveryGate`/`inject*`**，跨重启定时只能自管存档 + `setTimeout`（§3）。
3. **`pushDeferred` 的 `render` 返回 `null` = 这条不存在**（`core/types.ts:71`、`core/loop.ts:671`）；
   超过 3 秒也算没说（`core/loop.ts:243`、`846-855`）。
4. **事件不会被自动标成「使用者动作」**：Core 不改写正文（`core/types.ts:48-52`），缺省配置下 `external` 只是
   一条合成**工具回执**（`core/loop.ts:868-878`）。谁是用户、谁是别的 bot，全靠 `text`/`senderKey`。
5. **`flush` 不打断正在跑的回合**，只把 `ready` 置真等轮边界（`core/loop.ts:1466-1469`）；要抢话必须
   `preempt`（只打断未外化的轮）或 `interrupt`（会丢未完成的工具调用），且二者**消耗轮数**
   （`core/loop.ts:1208-1210`）。
6. **`panels` 需要浏览器 bundle**（`cortico.webUiClient`），否则 check 报警、页面拿不到脚本
   （`extensions/dry-mount.ts:209-211`、`extensions/README.md:25-26`）。纯 `stream` 面板不需要。
7. **config 路径必须以 `worlds.<id>.` 开头且 defaults 里必须有**（`extensions/dry-mount.ts:53-60`）。
8. **定时器重启后**：`TimersApi` 一重启就把过期项立刻 fire（`core/timers.ts:32-36`、`82-86`）；而
   `pushDeferred` 排队项**根本不持久化、不补投**（`core/types.ts:72`）。两者都不适合「关机一夜后补说一句」。
9. **重启补投上限 200 条**（`core/loop.ts:227`、`974-987`），更早的按上一世代结清、不进上下文；
   内部事件**不跨重启投递**（`core/loop.ts:933`）。
10. **`store.range` 的 `limit` 从区间尾部取、无源码级硬上限**；无起点的 limit 查询才便宜
    （`core/event-store.ts:259-280`、`295-299`）。长期运行后裸 `grep` 会整读历史分片。
11. **隐藏的 World**：`pushEvent` 只归档（`archive-only`）、`pushDeferred` 直接丢、`pushCandidate` 只归档
    （`core/core.ts:511-527`、`533-534`、`551-565`）。可见性一变行为立刻不同，代码要容错。
12. **`onRunPhase` 在主循环调用栈上**，只许记状态（`core/types.ts:942-946`）；**`cfg.enabled` 不是你
    的开关**，`persist({enabled:...})` 等于请求重启自己（`world.ts:48-49`）。

## 14. 对作息（rhythm）插件的可用扩展点

| 能力 | 用途 | 引用 |
|---|---|---|
| `pushEvent({origin:'external'},{trigger:'flush'})` | 把「我现在想主动说一句」当外部事件投递，让模型下一轮看见并出声 | `core/types.ts:684-687`、`core/bus.ts:107-110` |
| `pushEvent({origin:'internal'},{trigger:'flush'})` | 把插件自己的状态/提醒注入为内部正文（进 user 消息，不伪造用户发言） | `core/types.ts:679-683`、`core/loop.ts:706-712` |
| `pushDeferred({render})` + 返 `null` | 「到点先看看有没有话说，没有就闭嘴」，不留垃圾事件 | `core/types.ts:74-84`、`core/loop.ts:671` |
| `pushEvent({...},{deliver:false})` | 自录已发出的发言，只留档不把自己吵醒 | `core/types.ts:622-627`、`worlds/console/world.ts:361-370` |
| `setTimeout` + `ctx.persist({wakeAt})` | 精确调度下次叫醒；重启后在 `start()` 里对账补算 | `world.ts:46-47`、`core/timers.ts:32-36`（对照） |
| `store.range({fromCursor, limit})` / `grep` | 读最近发生了什么，判断「现在插话合不合适」 | `core/types.ts:167-174`、`core/event-store.ts:254-300` |
| `store.latestCursor()` + 自记游标 | 只增量扫描新事件，避免长期运行后越查越慢 | `core/event-store.ts:239-241`、`261-280` |
| `promotePending(cursor,'preempt')` | 已入队但想立刻说时提权（会打断未外化的轮） | `core/types.ts:715-720`、`core/bus.ts:148-161` |
| `withdrawPending(cursor)` | 反悔：把刚排上队的那句撤回 | `core/types.ts:710-714`、`core/core.ts:578-584` |
| `drainPendingEvents(filter)` | 抢在投递前把某些外部事件取走自己处理 | `core/types.ts:705-709`、`core/core.ts:569-577` |
| `onRunPhase(phase)` | 知道模型此刻 idle/model/tools，决定何时插话不打断 | `core/types.ts:942-946`、`core/loop.ts:402-420` |
| `outputTap()` | 边生成边拿增量，做「说到一半被抢话」的记录或 TTS | `core/types.ts:918-922`、`446-456` |
| `onTurnEnded()` | 一轮说完后立刻算「下次该什么时候开口」 | `core/types.ts:931-935`、`core/loop.ts:609-624` |
| `onEventsSettled(events,'delivered')` | 确认自己那句真的进了上下文（而不是被丢掉） | `core/types.ts:936-941`、`core/loop.ts:1556-1568` |
| `onHandoffEnded()` | 上下文交接后重新对账定时计划 | `core/types.ts:926-930`、`core/loop.ts:1719-1723` |
| 工具 + `endsTurn` | 给模型一个「说完就睡到 T 点」的显式出口 | `core/types.ts:269-273`、`core/loop.ts:1481-1485` |
| 工具 + `queueExternalEvents` | 工具里顺手采集的外部事件随本轮回执一起投递 | `core/types.ts:230-234`、`core/loop.ts:1192-1194` |
| `webUi().panels/invoke/stream` | 自己的控制台：开关、静默时长、下次叫醒时刻、最近发言记录 | `core/types.ts:840-870`、`web/server.ts:2340-2341` |
| `webUi().config` + `x-hot` | 热调参数，不用重启 | `core/config-schema.ts:16-48`、`extensions/dry-mount.ts:47-62` |
| `webUi().storage` | 让「自动发言记录」可被一键清除 | `core/types.ts:743-760`、`bot.ts:624-635` |
| `promptDocs(role:'envPrompt')` + `envPromptVars()` | 把「什么时候适合说话」的规则写进 system 前缀且用户可编辑 | `core/types.ts:799-818`、`905-910` |
| `host.cognition?.request()` | 想「先想清楚再决定说不说」时借主模型跑一次短任务（需 Persona 开启） | `core/types.ts:652-665`、`core/core.ts:378-410` |
| `host.reportUsage()` | 插件自带小模型时把用量记进统计 | `core/types.ts:728-732`、`core/core.ts:605-617` |

## 15. 发布前置（摘要）

manifest（`extensions/README.md:16-33`）：`kind: "world"`、`api` 必须等于 `EXTENSION_API_VERSIONS.world`
（不等则不加载，`40-46`）、`webUiClient` / `webUiStyle` / `describe` / `tags` / `keywords: ["cortico-world"]`。
扩展用 `import { nowIso } from 'cortico/core/util.ts'` 拿到**同一份模块实例**（`72-78`）。

`check:extension` 末尾两段（`extensions/author-guide.ts:216-219`）：按索引仓 `index.json` 词表核对
`cortico.tags`（不认识的被忽略，`style: 'official'` 作者声明无效，`67-75`），以及发布清单（`CHANGELOG.md`
要有 `## <version>` 段、`os` 字段、`cortico.describe` 指向包内文件，`171-213`）。这两段只提示、不计入失败
（`3-5`）。

常用工具函数：`nowIso`（`core/util.ts:57-71`）、`shortTime` 渲染 `HH:MM`（`101-105`）、`parseTimeIn`
（`89-98`）、`nullLogger()`（`388-395`）、`shortId`（`397-400`）、`readTextFile`（BOM 兼容，`402-417`）。
