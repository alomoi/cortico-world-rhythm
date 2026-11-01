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
  - `scripts/smoke.mjs`：假宿主 + 假时钟的行为冒烟测试（P0 后 67 条断言）。
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
