# Changelog

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
- **兜底提示**（`wakeHint`，缺省开）：`piggyback` 只搭着正在进行的那一轮，90 秒内没搭上车就作废，
  不会在对话结束后突然冒出「你被吵醒了」。
- **公开状态**：`<dataDir>/rhythm/status.json`（`sleep.active/endsAt/wokeCount/lastWokeAt/lastWokeBy`、
  `today.nudges/cap`），原子写，供其他插件读取；不含敏感字段。
- `describe.json` 新增 `rhythm.hint` 与 `rhythm.woke` 两个事件声明。

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
