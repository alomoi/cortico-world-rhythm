# Changelog

## 0.3.0（本地 fork，未发布）

- 从已安装的 `cortico-world-selftalk@0.2.2` 取源码作为 fork 基线（上游 GitHub 不可达，无历史）。
- 新增本地开发脚手架，不需要启动 Coopanion：
  - `scripts/run.ps1`：用 Coopanion 自带 Node + `tsx` + 框架解析钩子跑脚本（GUI 子系统程序的输出重定向已封装）。
  - `scripts/check.mjs`：干装载检查（manifest / `defaults` / `create` / `tools` / `webUi` / 配置路径 / `describe.json` 一致性），`--write` 重新生成 `describe.json`。
  - `scripts/smoke.mjs`：假宿主 + 假时钟的行为冒烟测试。
- 新增 `docs/dev-notes.md`（环境与工作方式）与 `docs/fork-plan.md`（改进计划）。

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
