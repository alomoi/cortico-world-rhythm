# 作息（Rhythm）离线安装包

适合不能联网的机器。不需要 npm、不需要下载依赖。

## 包里有什么

```
cortico-world-rhythm-1.0.8-offline.tgz   插件本体
install.bat                              Windows 双击安装
install.ps1                              PowerShell 安装（可选）
```

## 安装

1. 把整个文件夹拷到目标机器；
2. 双击 `install.bat`（或右键 `install.ps1` →「使用 PowerShell 运行」）；
3. 看到 `[OK] 安装完成` 后，打开 Coopanion 控制台 →「模块」；
4. 找到「作息」，打开开关；
5. 如果「作息」已经在运行，重启该模块（或整个应用）。

## 卸载

在控制台「模块」里关掉「作息」；如果要彻底删掉：

```powershell
# 在 Coopanion 的 data\extensions 目录里执行
# 用 Coopanion 自带的 pnpm 移除
```

或者直接把 `data\extensions\node_modules\cortico-world-rhythm` 删掉。

## 说明

- 插件没有运行时依赖，tgz 里就是完整代码；
- 所有数据都在本地 `data\rhythm\`，做梦写在自己工作区的 `partner\dreams.md`；
- 作者：大肥鱼；fork 自 `cortico-world-selftalk@0.2.2`（MIT）。
