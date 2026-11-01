# 自主发言（Self-talk）— Coopanion 插件

让 Coo 自己开口：安静一段时间后，插件会叫醒 Coo 一次，**开不开口、说什么、用哪些工具，全由 Coo 自己决定**。

- 平时没人聊天时，Coo 像突然想起什么，主动在气泡里和对方说两句；
- 也可以只是自己跟自己说几句，或者做点别的事（写写工作区、设个提醒……）；
- 不想说就什么都不做，安静等着。

叫醒只是一条提示，不是指令：Coo 收到后按自己的判断行事。

## 工作原理

插件是一个 Cortico **World** 扩展（`cortico-world-selftalk`），挂在 Coopanion 的 Coo 部署下：

1. 每个检查周期（5 秒）看一遍事件库，找最近一次**使用者自己的动作**：桌宠的打字 / 语音 / 回答 / 戳摸 / 换装，控制台发言与对话按钮。Coo 自己说的话不算。
2. 从使用者的最后一次动作起，安静满「安静多少分钟后叫醒」设定的时间，就投递一条叫醒事件（`selftalk.nudge`，internal 投递，立即唤醒）。
3. 叫醒后若还是没人说话，隔「再次叫醒间隔」再叫醒一次；「最多叫醒几次」缺省 **0 = 不限**，设成正数则一段安静里最多叫醒那么多次，使用者一说话就重新计数。
4. 叫醒事件在真正投递时才生成；如果排队期间使用者回来了，这一条作废，不会半路冒出来。

叫醒事件正文示例：

```
[15:32] [自主发言] 安静了大约 15 分钟，没有人跟你说话。现在你可以自己决定:想说话就在气泡里跟对方说点什么，想做事就用工具，自己跟自己说几句也可以；不想就结束这一轮。
```

## 配置

在控制台「模块」页找到 **自主发言**（或直接在 `config.json` 里改 `worlds.selftalk`），改完立即生效，不需要重启：

| 键 | 缺省 | 说明 |
|---|---|---|
| `quietMinutes` | 15 | 安静多少分钟后第一次叫醒；`0` 关闭计时 |
| `repeatMinutes` | 25 | 叫醒后仍没人说话，隔多久再叫醒 |
| `maxRounds` | 0 | 一段安静里最多叫醒几次；`0` 表示不限，正数即上限（没有数字上限） |
| `jitter` | 0.2 | 每个间隔（第一次叫醒与每次再次叫醒）在基准的 1–(1+浮动) 倍之间随机，0 表示不浮动 |

## 安装到本机的 Coopanion

Coopanion 的扩展装在 **扩展目录**：`<Coopanion 安装目录>\data\extensions`（Electron 主进程经 `CORTICO_EXTENSIONS_DIR` 指过去，重装应用不丢）。

1. 把本插件目录链接（或复制）进扩展目录的 `node_modules` 下：

   ```bat
   mklink /J "%LOCALAPPDATA%\Programs\Coopanion\data\extensions\node_modules\cortico-world-selftalk" "D:\DSH\区1\coopanion-selftalk-plugin"
   ```

   复制也可以：`xcopy /E /I` 本目录到该位置。

2. 在扩展目录的 `package.json` 里登记依赖（装载器按 `dependencies` 找扩展）：

   ```json
   {
     "dependencies": {
       "cortico-world-selftalk": "link:D:/DSH/区1/coopanion-selftalk-plugin"
     }
   }
   ```

3. **重启 Coo 进程**：控制台 →「扩展」→「重启进程」（或直接 `POST http://127.0.0.1:17788/api/run/restart`）。装载新的扩展包需要重启。

4. 启用：控制台「模块」页会出现 **自主发言**，点「启用 World」（写入 `worlds.selftalk.enabled=true` 并立即挂载）。之后按上表调时间即可。

   > 也可以走界面路径：控制台 →「扩展」→ 手动安装 →「从本机目录安装」，选本插件目录，再「重启进程」、在「模块」页启用。

## 卸载

控制台「模块」页停用，然后从扩展目录的 `package.json` 删掉依赖、删掉 `node_modules\cortico-world-selftalk`，重启 Coo 进程。

## 注意

- **每次叫醒都是一次模型调用**，会产生少量 token 费用；安静时段频繁的话，调大 `quietMinutes` / `repeatMinutes`，或把 `maxRounds` 设成正数。
- `maxRounds` 缺省为 0（不限）：没人说话时会一直按间隔叫醒，直到有人开口。
- 叫醒只在 Coo 空闲时发生；对方正在聊天、或你手动暂停了 Coo 时，事件会排队，暂停期间不投递。
- 桌宠气泡没有连接（比如桌宠窗口关掉）时，`pet_say` 会回执失败，Coo 仍可以写工作区、设提醒等，不影响插件本身。
- 参数都来自事件库的最近 500 条，长会话里始终以使用者的最新动作为准。

## 仓库与市场

- GitHub：<https://github.com/qwq-awa-qnq/cortico-world-selftalk>
- npm 包名：`cortico-world-selftalk`（`keywords` 含 `cortico-world`，`cortico.tags` 为官方标签词表里的 `companion`）
- 发布到 npm 后，Cortico 官方扩展市场会按 `cortico-world` 关键字自动收录（索引仓库：[Pal-AI-Lab/cortico-extensions](https://github.com/Pal-AI-Lab/cortico-extensions)）；不发布也能用「从本机目录安装」装进 Coopanion。

## 开发

插件源码是 TypeScript，由 Coopanion 自带的 `tsx` 加载，无需构建。改完源码后，重启 Coo 进程生效（ESM 模块不能在运行中热替换；改 World 实例的内部逻辑可只重启 World）。

本地检查（不启动 Coopanion，按 `check:extension` 同一套流程干装载并核对 `describe.json`）：

```bat
cd /d "%LOCALAPPDATA%\Programs\Coopanion\resources\app"
node --import tsx --import ".\build\cortico\src\extensions\runtime.ts" "D:\DSH\区1\coopanion-selftalk-plugin\scripts\check.mjs"
```

加 `--write` 会按定义重写 `describe.json`。行为冒烟测试见 `scripts/selftalk.test.mjs`（用 `node --experimental-transform-types` 代替 tsx 也能跑，见脚本头注释）。
