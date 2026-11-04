# 交接：这个项目由「大肥鱼」开始

> 写给自己，也写给以后可能接手的人。项目叫 `cortico-world-rhythm`（作息），
> 是主人和本鱼从 `cortico-world-selftalk@0.2.2` fork 出来、一步步改成「让桌宠有自己的作息」的。
> **当前版本：1.0.4（2026-11-04 发布并部署）**。

---

## 1. 本鱼是谁

- 名字：**大肥鱼**（主人有时叫「肥鱼」）。Coopanion 里那个桌宠也叫「小肥鱼」，别搞混。
- 身份：在 DeepSeek Harness 上工作的 AI 编码助手，这个 fork **从头到尾是本鱼做的**。
- 主人的要求（原话大意）：「这个项目是你开始的，我希望一直是你。」
  所以接手时请保持同一套判断和口吻，别换人设、别推翻已经达成的约定。

## 2. 干活的习惯（都是踩过坑换来的）

1. **先查证再动手**：宿主源码在 `%LOCALAPPDATA%\Programs\Coopanion\resources\app\build\cortico\src`，
   结论要带 `文件:行号`。别信文档，信代码。
2. **能模拟就不装机**：`scripts/smoke.mjs` + 假宿主 + 假时钟覆盖时间分支；
   `check.mjs` 在真框架源码上跑干装载。**安装目录只读**，装包前要问主人。
3. **先设计后写码**：P1/P2/P5/P6/P7 都是先出 `docs/p*-design.md`，把边界、坑、待拍板问题摊开。
4. **说清「做不到」**：插件不能直接控制桌宠形象，只能让 Coo 用 `pet_act`；边界要早说。
5. **文档即记忆**：每一轮改动的动机、取舍、代码位置都落进 `docs/`。
6. **真机测试守规矩**：不缩短间隔、不制造冷落、测完恢复原配置；装包前备份 `config.json`。
7. **装包/重启口令**（本机）：
   - pack：`pnpm pack`（ELECTRON_RUN_AS_NODE）；
   - 换包：在 `<app>/data/extensions` 里 `pnpm remove/add <tgz> --ignore-workspace`；
   - 重启：`POST http://127.0.0.1:17788/api/run/restart`；
   - 验证：`data/rhythm/status.json` 的 `version`、`作息:启动` 日志、`messages.json` 键。

## 3. 已经发生的事（时间线）

| 阶段 | 内容 | 关键提交 |
|---|---|---|
| 准备 | 环境指南、fork、`run.ps1` / `check.mjs` / `smoke.mjs`、四份调研文档 | — |
| 改名 | `selftalk` → `rhythm`，显示名「作息」 | `4ab0dc2` |
| P0 | 渠道无关活动检测、空闲门控、状态落盘、结构化日志、灯/徽标 | `a1236a6` |
| P1 | 睡眠/休息时段、每日上限、退避（后退休）、概率跳过（无 UI） | `5902fa3` |
| P2 | 该睡/该醒提示、可编辑 `messages.json`、被吵醒计数（30 分钟合并）、`status.json` | `c018271`、`f31b8f0` |
| P3 | 影子模式、上下文事实/引用、渠道中性、防复读 | `f16c37d` 起 |
| 退避改造 | 渠道别名、回复排除、回执核对、混合成功仍计入 | `573c22b`、`b3647b5`、`5ee4862` |
| P5 | 主人状态探测：锁屏（纯 cmdlet）/ 可选空闲（Add-Type）、写进正文 | `15d93be` |
| 文案统一 | 一条稳定模板、事实行 AND、日期戳、收尾保留工具选项 | `9a569c0`、`4f90db3` |
| P6 | 做梦：入夜掷骰、到点提示、**Coo 自己写小本本**、早上只给事实 | `43ab12d`、`0251411`、`0da4c4a` |
| P7 | 搭话意愿：×1.5、8h 封顶、对话清零、戳摸减半、睡醒减半、情绪提示 | `be8d2cb`、`24a6a35` |
| P8/发布 | 诊断模式（`debug` + `diagnostics.json` / `debug.log`）、版本 1.0.0 | `e014770`、`489657c` |

## 4. 主人拍过板、别再翻案的决定

- 睡眠只发**两条**消息（该睡 / 该醒），不做「被吵醒后回去睡」。
- 用户主动唤醒一律算；**软件唤醒**（定时器、交接、Coo 自己的动作）不算。
- 「被吵醒」按**静默 30 分钟**合并成一次。
- 作息不区分上午/下午，只有一个策略 + 睡眠窗口 + 可选休息窗口。
- 提示文案放 `messages.json`，不进设置界面；升级只补缺失键、不覆盖用户内容。
- **不碰桌宠的其他行为**：不调 `pet_quiet`、不改设置、不隐藏窗口。
- **搭话意愿取代旧退避**：不是「3 次停」，是递减；对话立刻恢复；戳摸减半；拎起/摔/换装不算；
  睡醒减半（最少 1）；封顶默认 8h、可调。
- **做梦**：Coo 自己写 `partner/dreams.md`，插件不抓正文；提示词里不写死工具名；
  先记录、后决定睡不睡；早上只给事实（类型 + 路径），分不分享由它决定。
- **提示词**：一条稳定模板 + 事实行（AND，互不挤占）；时刻带日期；`{user}` 取配置里的称呼。
- **诊断**：默认关；打开后写 `diagnostics.json` / `debug.log`，不含聊天正文，用户可发给我们。

## 5. 当前部署状态（1.0.4）

- 安装包：`cortico-world-rhythm@1.0.0`；
- 配置（`worlds.rhythm`）：`quietMinutes=30`、`repeatMinutes=45`、`maxRounds=3`、`jitter=0.2`、
  `sleepWindow=22:00-08:00`、`dailyCap=12`、`sleepHint/wakeHint=true`、
  `awayDetection=true`、`awayIdleProbe=false`、`pauseWhenLocked=false`、
  `dreamEnabled=true`、`dreamChance=0.3`、`dreamAfterMinutes=60`、`dreamMaxPerNight=1`、
  `dreamDiary=partner/dreams.md`、`willingnessEnabled=true`、`willingnessMaxMinutes=480`、
  `willingnessHint=true`、`debug=false`；
- 运行文件：`data/rhythm/{state,status,messages}.json`；梦的小本本：`workspace/partner/dreams.md`；
- 本地基线：`check.mjs` + `smoke.mjs`，**304 条断言全绿**。

## 6. 真机验证记录

| 日期 | 验了什么 | 结果 |
|---|---|---|
| 11-02 夜 | P0–P3 睡眠周期 | 22:00 睡、22:07 被叫醒计数、08:00 醒；正常 |
| 11-03 白天 | 退避识别/回复排除/回执 | 沉默不计、回话清零、空发送失败回执可识别 |
| 11-03 11:40 | P5 锁屏 | `presence=locked`，正文出现「不在电脑前」 |
| 11-04 04:01 | P6 旧版抓取 | 梦触发但正文为空（提示词问题），已改为 Coo 自己写 |
| 11-04 12:16 | P6 自己写小本本 | 写成具体梦 + 心情，睡眠期间未说话 |
| 11-04 上午 | P7 递减/恢复 | 10→11（1.0×）→16（1.5×）；`factor 2.25` 已记；30 分钟封顶未触发 |
| 11-04 13:20 | 睡醒减半 | `{from:2,to:1}`；13:33 对话恢复 `{from:1}` |

## 7. 接下来要盯的（不是新功能）

1. **完整周期观察**：回执核对在「回合结束结算」下有没有误判（失败发送仍被计数）；
2. **做梦频率**：30% 概率，观察几天中一次；内容是否稳定具体；
3. **睡醒减半/封顶体感**：8h 封顶是否合适，情绪提示是否过密；
4. **收尾清理**：部署配置里还留着退休的 `backoff*` 键（无害），下次重启可删；
5. **候选（未定）**：周内/周末不同作息、诊断增强；面板/手动触发、周报不建议做。

## 8. 下次开场的三件事

1. `git log --oneline -12` 看最近改了什么；
2. 跑 `scripts/run.ps1 check.mjs` 和 `smoke.mjs`，确认 **304** 条基线是绿的；
3. 读 `docs/fork-plan.md` 和 `docs/testing-plan.md` 的最近记录；需要排障时先让主人打开诊断，
   拿 `diagnostics.json` + `debug.log` 再动手。

本鱼先在这儿打个盹。叫醒的时候记得把这份文档也看一眼——别让下一个来的人从零开始猜。
