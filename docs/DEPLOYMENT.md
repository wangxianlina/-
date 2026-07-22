# 部署说明

> DGX Spark本地模型部署请直接阅读[`DGX_SPARK_STEP37_GGUF_DEPLOYMENT.md`](DGX_SPARK_STEP37_GGUF_DEPLOYMENT.md)。该文档包含Step-3.7-Flash-GGUF下载、GB10 CUDA编译、OpenClaw接入、四Agent共享模型和内存优化的完整命令。

## 当前部署方式

本地 Windows 计算机运行 OpenClaw Gateway、飞书长连接、Agent 工作区、技能脚本、记忆服务和桌面通知插件。StepFun Step 3.7 Flash通过远程API提供主要模型推理。

## 部署步骤

1. 安装符合OpenClaw要求的Node.js和Python 3.10以上版本。
2. 安装OpenClaw以及StepFun、飞书插件。
3. 使用`openclaw agents add`创建`health`、`study`和`study-critic`。
4. 把仓库`agents`目录中的角色文件放入对应工作区。
5. 参考`config/openclaw.example.json`配置Agent、飞书账号和路由。
6. 在飞书开放平台创建企业自建应用，启用机器人与长连接事件。
7. 在本地填写App ID与App Secret，不要把密钥写入仓库。
8. 构建并链接桌面通知插件。
9. 重启Gateway并使用`openclaw status`和`openclaw doctor`检查状态。

## 自定义插件

```powershell
Set-Location plugins\desktop-notify-tools
npm install
npm run build
openclaw plugins install --link .
openclaw gateway restart
```

## 论文检索测试

```powershell
python scripts\search_semantic_scholar.py "vision language action world model" --year 2024-2026 --limit 5
```

## 本地算力优化

- 将论文下载、文本抽取、分段和去重放在本地执行。
- 先使用关键词或向量检索筛选候选段落，再调用大模型。
- 两个研究员并行工作，但限制本地高显存任务并发量。
- 对长会话生成阶段摘要，避免反复传递全部历史内容。
- 对论文元数据和已验证引用进行缓存。

## NVIDIA后续集成路线

1. 安装与显卡驱动匹配的CUDA Toolkit。
2. 选择能在约8GB显存中运行的4B级模型。
3. 使用INT4、FP8或W4A16量化降低显存需求。
4. 使用TensorRT-LLM或NVIDIA NIM暴露本地推理接口。
5. 将摘要、分类和重排序任务路由到本地模型。
6. 保留StepFun Step 3.7 Flash处理复杂推理与多模态任务。
7. 记录吞吐量、首Token延迟、显存和任务质量，与未优化版本比较。
