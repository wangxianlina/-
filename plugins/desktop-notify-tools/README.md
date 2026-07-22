# Desktop Notify Tools

OpenClaw 的 Windows 桌面通知插件。插件向 `main` 和 `router` Agent 注册 `butler_desktop_notify` 工具，并使用 PowerShell 显示系统通知。

## 构建与安装

```powershell
npm install
npm run build
openclaw plugins install --link .
openclaw gateway restart
```

插件具有冷却时间和 `dedupeKey` 去重能力，避免同一任务完成事件重复弹窗。
