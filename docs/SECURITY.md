# 安全与脱敏说明

`.openclaw`是运行目录，不是适合整体公开的源码目录。它可能包含飞书密钥、模型凭据、聊天内容、个人记忆、设备身份和群聊ID。

## 禁止提交

- 实际使用的`openclaw.json`及其备份。
- `credentials`、`identity`、`devices`与认证配置。
- 飞书App Secret、模型API Key、Gateway Token和配对码。
- `agents/*/sessions`、日志、媒体、截图和长期记忆。
- 向量数据库、Nowledge Mem数据和用户健康记录。
- 本机生成的`node_modules`、缓存和构建输出。

## 推荐做法

- 只提交`openclaw.example.json`，所有敏感值使用占位符。
- 在每次提交前运行`scripts/security-scan.ps1`。
- 如果密钥曾经进入Git历史，应立即撤销并重新生成，而不是只删除当前文件。
- 公开仓库只保存可复现代码、角色提示词、安装步骤和脱敏示例。
