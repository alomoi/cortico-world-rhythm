# 作息（Rhythm）— Coopanion 插件

> **本目录是 fork，不是上游原样。**
>
> - 上游：`cortico-world-selftalk@0.2.2`（npm 最新版）；源码取自已安装的扩展目录，上游 GitHub 本机连不上，无 git 历史。
> - 本 fork 改名：包名 `cortico-world-rhythm`、World id **`rhythm`**、显示名「作息」。
>   目标不再是"安静后叫醒一次"，而是**让桌宠有自己的生活节律**（作息），后续功能见计划文档。
> - 版本：`0.3.0`；`private: true`（不发布 npm；要发布先摘掉这个字段）。
> - 开发手册见 [`docs/dev-notes.md`](docs/dev-notes.md)，改进计划见 [`docs/fork-plan.md`](docs/fork-plan.md)，
>   交接记录见 [`docs/handoff.md`](docs/handoff.md)（这个项目由大肥鱼开始，也一直由大肥鱼维护）。
> - 本地验证（不需要启动 Coopanion）：
>
>   ```powershell
>   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run.ps1 check.mjs
>   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run.ps1 smoke.mjs
>   ```

让 Coo 自己过日子：安静一段时间后，插件会叫醒 Coo 一次，**开不开口、说什么、用哪些工具，全由 Coo 自己决定**。

- 平时没人聊天时，Coo 像突然想起什么，主动在气泡里和对方说两句；
- 也可以只是自己跟自己说几句，或者做点别的事（写写工作区、设个提醒……）；
- 不想说就什么都不做，安静等着。

叫醒只是一条提示，不是指令：Coo 收到后按自己的判断行事。

## 工作原理

插件是一个 Cortico **World** 扩展（`cortico-world-rhythm`，id `rhythm`），挂在 Coopanion 的 Coo 部署下：

1. 每个检查周期（5 秒）看一遍事件库，找最近一次**人侧事件**：任何 `external` 且不是 Coo 自录（`*.self`）的事件——桌宠、控制台、微信、QQ、B 站……哪个渠道都算。Coo 自己说的话不算（它们也是 `external`，但类型以 `.self` 结尾）。
2. 从最后一次人侧事件起，安静满「安静多少分钟后叫醒」设定的时间，就投递一条叫醒事件（`rhythm.nudge`，internal 投递）。
3. 叫醒后若还是没人说话，隔「再次叫醒间隔」再叫醒一次；「最多叫醒几次」缺省 **0 = 不限**，设成正数则一段安静里最多叫醒那么多次，人一说话就重新计数。
4. 叫醒事件在真正投递时才生成；如果排队期间人回来了，这一条作废，不会半路冒出来。
5. Coo 正在跑模型或工具时先不叫醒（`onlyWhenIdle`，缺省开），等这一轮结束再判断。
6. 睡眠时段与休息时段内不主动叫醒；离开时段时安静计时从那一刻重新开始。一天最多叫 `dailyCap` 次；
   它**主动开口却没人回应**时，再次叫醒的间隔按 `backoffAfter/backoffFactor` 逐渐拉长；它只是安静待着或去查资料不算；你一说话就恢复。
7. 睡眠时段开始时发一句「该睡了」、结束时发一句「该醒了」，让 Coo 自己决定用不用
   `pet_act` 的 `sleep` / `stand` 动作躺下或站起来（插件不能直接控制形象）。
8. 睡眠中有人来找 Coo（任何渠道）会按 `wakeGapMinutes` 合并计一次「被吵醒」，
   写进 `data/rhythm/status.json` 供其他插件读取；`wakeHint` 打开时还会搭着这一轮给它一句
   「你被吵醒了」，超过 90 秒没搭上车就作废。

提示文案（「该睡了/该醒了/你被吵醒了」三句）放在 `<部署数据目录>/rhythm/messages.json`，
首次运行自动生成、之后**不会被覆盖**，高阶玩家可以自己改语气。占位符：`{at}`、`{by}`、`{count}`。

> 渠道无关是 0.3.0 的修复：上游只认桌宠与控制台的白名单，微信里正聊着天它照样按 30 分钟插嘴
> （真机日志有记录）。要退回旧行为，把 `knownChannelsOnly` 打开。

叫醒事件正文示例：

```
[15:32] [作息] 安静了大约 15 分钟，没有人跟你说话。现在你可以自己决定:想说话就在气泡里跟对方说点什么，想做事就用工具，自己跟自己说几句也可以；不想就结束这一轮。
```

## 配置

在控制台「模块」页找到 **作息**（或直接在 `config.json` 里改 `worlds.rhythm`），改完立即生效，不需要重启：

| 键 | 缺省 | 说明 |
|---|---|---|
| `quietMinutes` | 15 | 安静多少分钟后第一次叫醒；`0` 关闭计时 |
| `repeatMinutes` | 25 | 叫醒后仍没人说话，隔多久再叫醒 |
| `maxRounds` | 0 | 一段安静里最多叫醒几次；`0` 表示不限，正数即上限（没有数字上限） |
| `jitter` | 0.2 | 每个间隔在基准的 1–(1+浮动) 倍之间随机，只往后偏；0 表示不浮动 |
| `sleepWindow` | `22:00-08:00` | 睡眠时段，格式 `HH:MM-HH:MM`，跨午夜可写 `23:00-08:00`；留空 = 不启用 |
| `restWindows` | 空 | 休息时段，可写多个：`12:30-14:00, 18:00-18:30`；留空 = 没有 |
| `sleepHint` | true | 睡眠时段开始/结束时给 Coo 各一条「该睡了 / 该醒了」的提示 |
| `wakeHint` | true | 睡眠中被吵醒时，搭着这一轮给它一句「你被吵醒了」（超过 90 秒作废） |
| `wakeGapMinutes` | 30 | 同一场打扰的合并间隔；超过它再来人才算「又被吵醒一次」 |
| `wakeHintSeconds` | 90 | 「被吵醒」提示的保鲜期（10–300 秒）；超过就作废，不事后补发 |
| `speakTools` | 四个内置说话工具 | 额外认定为「搭话」的工具名；一般不用填，插件推过用户消息后它的说话工具会被自动认出来 |
| `speakIgnore` | 空 | 不算搭话的工具名，优先于自动识别（例如 `minecraft_say`） |
| `speakMatchAnywhere` | false | 宽松匹配：名字里出现说话动词就算，兜 `sendMsgToWechat` 这种乱名 |
| `dailyCap` | 12 | 一天（部署时区）最多主动叫醒几次；0 = 不限 |
| `backoffAfter` | 0 | 连续几次「主动搭话没人回应」后开始拉长间隔；0 = 关闭退避 |
| `backoffFactor` | 1.5 | 每多一次被无视的搭话，间隔乘多少（1.0–3.0） |
| `backoffMaxFactor` | 4 | 间隔最多拉到基准的多少倍（1–10） |
| `knownChannelsOnly` | false | 打开后退回旧行为：只把桌宠与控制台的事件当成「有人回来了」 |
| `activityIgnore` | 空 | 不算「有人回来了」的事件类型，逗号分隔，`qq.system*` 做前缀匹配 |
| `onlyWhenIdle` | true | Coo 正在跑模型或工具时先不叫醒，等这一轮结束 |

「有人回来了」的判定是**渠道无关**的：事件库里任何 `external` 且不是 Coo 自录（`*.self`）的事件都算，
所以微信、QQ、B 站、Discord 等通讯扩展装上就自动生效，不需要登记类型。确有周期性系统事件时用
`activityIgnore` 排除。

运行时状态落在 `<部署数据目录>/rhythm/state.json`（今日叫醒次数、本轮轮次、上次叫醒与投递结果），
重启后接着算，不会把「今天叫了几次」丢掉。

> 换 id 的代价：上游那份的配置段 `worlds.selftalk`（本机是 30/45/3/0.2）不会自动搬过来。
> 启用本插件后请照着自己调一遍，并在控制台把上游「自主发言」停用，否则两套会各叫各的。

## 安装到本机的 Coopanion

Coopanion 的扩展装在 **扩展目录**：`<Coopanion 安装目录>\data\extensions`（Electron 主进程经 `CORTICO_EXTENSIONS_DIR` 指过去，重装应用不丢）。

1. 把本插件目录链接（或复制）进扩展目录的 `node_modules` 下：

   ```bat
   mklink /J "%LOCALAPPDATA%\Programs\Coopanion\data\extensions\node_modules\cortico-world-rhythm" "D:\文档\deepseek-harness\default-workspace\selftalk"
   ```

   复制也可以：`xcopy /E /I` 本目录到该位置。

2. 在扩展目录的 `package.json` 里登记依赖（装载器按 `dependencies` 找扩展）：

   ```json
   {
     "dependencies": {
       "cortico-world-rhythm": "link:D:/文档/deepseek-harness/default-workspace/selftalk"
     }
   }
   ```

3. **重启 Coo 进程**：控制台 →「扩展」→「重启进程」（或直接 `POST http://127.0.0.1:17788/api/run/restart`）。装载新的扩展包需要重启。

4. 启用：控制台「模块」页会出现 **作息**，点「启用 World」（写入 `worlds.rhythm.enabled=true` 并立即挂载）。之后按上表调时间即可。

   > 也可以走界面路径：控制台 →「扩展」→ 手动安装 →「从本机目录安装」，选本插件目录，再「重启进程」、在「模块」页启用。

## 卸载

控制台「模块」页停用，然后从扩展目录的 `package.json` 删掉依赖、删掉 `node_modules\cortico-world-rhythm`，重启 Coo 进程。

## 注意

- **每次叫醒都是一次模型调用**，会产生少量 token 费用；安静时段频繁的话，调大 `quietMinutes` / `repeatMinutes`，或把 `maxRounds` 设成正数。
- `maxRounds` 缺省为 0（不限）：没人说话时会一直按间隔叫醒，直到有人开口。
- 叫醒的 `flush` 投递**不会打断正在跑的回合**，只会等轮边界；模型正在跑长工具时会迟到。所以缺省还会检查 `onRunPhase`，只在 Coo 空闲时叫醒。
- 控制台把本 World 隐藏（静音）时，叫醒事件会被直接丢弃；投递被丢弃（`onEventsSettled` 报 `discarded`）时「今日叫醒」计数会回退，日志里有一条 `作息:叫醒结果`。
- 状态文件是 `<部署数据目录>/rhythm/state.json`；删掉它只会丢「今日次数/本轮轮次」，不影响安静计时（后者每次从事件库重算）。
- 对外状态是 `rhythm/status.json`（`sleep.active/endsAt/wokeCount/lastWokeBy`、`speak.channels`、`today.nudges/cap` 等，只含非敏感事实），其他插件直接读。
- 提示文案是 `rhythm/messages.json`，首次运行生成，不会被插件覆盖；改完下一条提示就生效（不发提示时不读）。
- 睡眠时段的两条提示各算一次模型调用（每夜最多两次）；不想花就关 `sleepHint`。
- 桌宠气泡没有连接（比如桌宠窗口关掉）时，`pet_say` 会回执失败，Coo 仍可以写工作区、设提醒等，不影响插件本身。
- 参数都来自事件库最近 500 条**外部**事件，长会话里始终以人侧的最新动作为准。

## 仓库与市场

- 上游：<https://github.com/qwq-awa-qnq/cortico-world-selftalk>（npm 包名 `cortico-world-selftalk`）
- 本 fork 不发布：`private: true`，只通过「从本机目录安装」或本地打包进本机 Coopanion。

## 开发

插件源码是 TypeScript，由 Coopanion 自带的 `tsx` 加载，无需构建。改完源码后，重启 Coo 进程生效（ESM 模块不能在运行中热替换；改 World 实例的内部逻辑可只重启 World）。

本地检查（不启动 Coopanion，按 `check:extension` 同一套流程干装载并核对 `describe.json`）：

```powershell
cd /d "D:\文档\deepseek-harness\default-workspace\selftalk"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run.ps1 check.mjs
```

加 `--write` 会按定义重写 `describe.json`。行为冒烟测试是 `scripts/smoke.mjs`（假宿主 + 假时钟）。两者都不启动 Coopanion，也不碰安装目录。
