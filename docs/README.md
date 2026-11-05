# 文档索引

| 文件 | 内容 | 读者 |
|---|---|---|
| [`dev-notes.md`](dev-notes.md) | 本地环境地图、日常命令、`run.ps1` 的两个坑、基线 0.2.2 的行为拆解、安装步骤、调试流程、编码约定 | 接手开发者 |
| [`fork-plan.md`](fork-plan.md) | 改进目标、待拍板问题、A/B/C/D 四组改进候选、里程碑（P0 已完成）、验证策略、风险 | 主人 + 开发者 |
| [`p1-design.md`](p1-design.md) | P1 设计稿：时段表语法与匹配规则、每日上限、退避、新增配置键、测试计划、待拍板问题 | 主人 + 开发者 |
| [`p2-sleep-design.md`](p2-sleep-design.md) | P2 设计：让形象真的睡（模型中介 `pet_act`）、被吵醒计数、`status.json` 共享通道 | 主人 + 开发者 |
| [`host-apis.md`](host-apis.md) | 框架给扩展 World 的全部运行时能力（推/读事件、定时器、注入、工具、WebUI、提示词、存储、钩子）+ 源码行号 + 坑 | 写代码时查 |

其他：

- `..\README.md`：上游原文档（安装/配置方式仍适用），顶部加了 fork 说明。
- `..\CHANGELOG.md`：0.3.0 起是本 fork 的变更线。
- `..\scripts\check.mjs` / `..\scripts\smoke.mjs`：本地自检入口，用法见 `dev-notes.md`。
