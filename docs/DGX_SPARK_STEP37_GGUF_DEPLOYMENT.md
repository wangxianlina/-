# 在 NVIDIA DGX Spark 上部署 Step-3.7-Flash-GGUF 与 OpenClaw 多智能体

## 1. 部署目标

本方案将 StepFun 官方开源的 `Step-3.7-Flash-GGUF` 模型部署到 NVIDIA DGX Spark，并在同一台设备上运行 OpenClaw Gateway、飞书连接、四个 Agent、论文检索技能和长期记忆。

部署完成后的数据流如下：

```text
飞书用户
   │ WebSocket
   ▼
OpenClaw Gateway（DGX Spark 本地）
   ├─ main：任务拆分、辩论主持、结果汇总
   ├─ study：独立论文研究员 A
   ├─ study-critic：独立论文研究员 B
   └─ health：健康与饮食记录
           │ OpenAI兼容HTTP，127.0.0.1:8080
           ▼
llama.cpp / llama-server（DGX Spark 本地）
           │ CUDA / GB10 / 128GB统一内存
           ▼
Step-3.7-Flash-GGUF
```

四个 Agent 是四套独立的角色提示词、工作区、技能权限和会话状态，并不是四份模型进程。它们共同调用一个常驻内存的 Step-3.7-Flash 服务。因此，模型权重只加载一次，OpenClaw负责智能体隔离和任务调度，DGX Spark负责本地推理。

完成部署后，模型推理、提示词、Agent中间结果和本地文档均在DGX Spark上处理，不再调用StepFun云端推理API。仍可能产生的外部网络访问包括飞书消息、论文搜索、网页访问以及首次从Hugging Face下载模型。

## 2. 硬件与模型选择

DGX Spark使用Grace Blackwell架构，提供128GB统一内存。Step-3.7-Flash是总参数约198B、每Token激活约11B的稀疏MoE视觉语言模型，官方提供多种GGUF量化版本。

| 量化版本 | 权重大小 | DGX Spark建议 |
|---|---:|---|
| BF16 | 394GB | 单台无法部署 |
| Q8_0 | 209GB | 单台无法部署 |
| Q4_K_S | 112GB | 质量优先；单并发、文本模式，内存余量较小 |
| IQ4_XS | 105GB | 推荐；质量和内存余量较平衡 |
| Q3_K_L | 103GB | 可用；质量略低 |
| Q3_K_M | 94GB | 多Agent稳定性优先，内存余量更充足 |
| IQ3_XXS | 76GB | 内存优先的降级方案 |

视觉输入还需要约4GB的`mmproj-Step-3.7-flash-f16.gguf`。对于论文检索和多Agent辩论，建议先部署文本模式，不加载`mmproj`；需要分析论文图片时再启用视觉服务。

本项目推荐：

- 比赛演示、质量优先：`IQ4_XS`，32K上下文，单并发。
- 严格对齐官方示例：`Q4_K_S`，32K上下文，单并发，并关闭其他大内存任务。
- 多Agent连续运行、稳定优先：`Q3_K_M`，32K上下文，单并发或经测试后双并发。

不要一开始就为四个Agent设置四路并发。四个Agent可以并行进行文件处理和论文搜索，但模型生成请求应先由OpenClaw排队、串行进入同一个本地模型服务。

## 3. 检查DGX Spark环境

连接DGX Spark：

```bash
ssh YOUR_USER@DGX_SPARK_IP
```

检查系统、CUDA、GPU和内存：

```bash
uname -m
nvidia-smi
nvcc --version
free -h
df -h
```

预期架构为ARM64，系统应能识别GB10 GPU、CUDA和约128GB统一内存。建议至少预留200GB磁盘空间；如果同时保留多个量化版本，建议预留300GB以上。

部署前关闭其他占用统一内存的大模型、容器和推理服务：

```bash
nvidia-smi
ps aux --sort=-%mem | head -20
docker ps
```

## 4. 编译支持GB10 CUDA的llama.cpp

安装依赖：

```bash
sudo apt update
sudo apt install -y git clang cmake build-essential libcurl4-openssl-dev libssl-dev
```

StepFun官方模型卡推荐使用其`step3.7`分支。这里同时加入NVIDIA针对DGX Spark GB10给出的CUDA架构参数：

```bash
git clone https://github.com/stepfun-ai/llama.cpp.git ~/step37-llama.cpp
cd ~/step37-llama.cpp
git fetch origin
git checkout -b step3.7 origin/step3.7

cmake -B build \
  -DGGML_NATIVE=ON \
  -DGGML_CUDA=ON \
  -DGGML_CURL=ON \
  -DGGML_RPC=ON \
  -DLLAMA_BUILD_TOOLS=ON \
  -DLLAMA_BUILD_SERVER=ON \
  -DCMAKE_CUDA_ARCHITECTURES=121a-real

cmake --build build --config Release -j$(nproc)
```

检查程序：

```bash
~/step37-llama.cpp/build/bin/llama-server --version
~/step37-llama.cpp/build/bin/llama-server --help | head
```

如果`121a-real`不被本机CMake/CUDA识别，先更新DGX OS与CUDA，再重新配置构建目录，不要直接改成不匹配的GPU架构。

## 5. 下载并启动Step-3.7-Flash-GGUF

为模型缓存创建独立目录：

```bash
mkdir -p ~/models/huggingface
export HF_HOME="$HOME/models/huggingface"
```

### 5.1 推荐的IQ4_XS文本服务

首次启动会自动从Hugging Face下载模型分片：

```bash
cd ~/step37-llama.cpp

HF_HOME="$HOME/models/huggingface" \
./build/bin/llama-server \
  -hf stepfun-ai/Step-3.7-Flash-GGUF:IQ4_XS \
  --host 127.0.0.1 \
  --port 8080 \
  -c 32768 \
  -ngl 99 \
  -fa on \
  --parallel 1
```

### 5.2 官方Q4_K_S版本

```bash
HF_HOME="$HOME/models/huggingface" \
./build/bin/llama-server \
  -hf stepfun-ai/Step-3.7-Flash-GGUF:Q4_K_S \
  --host 127.0.0.1 \
  --port 8080 \
  -c 32768 \
  -ngl 99 \
  -fa on \
  --parallel 1
```

参数说明：

- `-hf`：从Hugging Face下载并加载指定量化版本。
- `--host 127.0.0.1`：只允许DGX Spark本机访问，避免无认证API暴露到局域网。
- `-c 32768`：先使用32K上下文，稳定后再逐步增加。
- `-ngl 99`：尽可能将模型层交给GPU后端。
- `-fa on`：启用Flash Attention。
- `--parallel 1`：限制为单生成槽，控制KV Cache和统一内存占用。

当日志出现`server is listening`后，再进行API测试。112GB模型的首次下载与加载可能需要较长时间。

## 6. 健康检查与推理测试

新开一个SSH终端：

```bash
timeout 1800 bash -c \
  'until curl -sf http://127.0.0.1:8080/health >/dev/null; do sleep 5; done'
```

查看模型列表：

```bash
curl http://127.0.0.1:8080/v1/models
```

测试聊天接口：

```bash
curl http://127.0.0.1:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "stepfun-ai/Step-3.7-Flash-GGUF:IQ4_XS",
    "messages": [
      {"role": "user", "content": "用三点说明VLA与世界模型的区别。"}
    ],
    "temperature": 0.2,
    "max_tokens": 512
  }'
```

同时检查内存：

```bash
watch -n 2 'free -h; nvidia-smi'
```

## 7. 将本地模型注册到OpenClaw

### 7.1 安装Node.js与OpenClaw

在DGX Spark上安装OpenClaw支持的Node.js版本。以下示例使用Node.js 24：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 24
nvm use 24

npm install -g openclaw@latest
openclaw --version
```

### 7.2 注册本地OpenAI兼容接口

在`llama-server`保持运行的情况下执行：

```bash
openclaw onboard --non-interactive --mode local \
  --auth-choice custom-api-key \
  --custom-base-url http://127.0.0.1:8080/v1 \
  --custom-model-id "stepfun-ai/Step-3.7-Flash-GGUF:IQ4_XS" \
  --custom-provider-id llama-cpp \
  --custom-compatibility openai \
  --custom-text-input \
  --accept-risk \
  --skip-health
```

如果使用`Q4_K_S`，把模型ID中的`IQ4_XS`替换为`Q4_K_S`。完成后验证：

```bash
openclaw models list
openclaw agent --local --agent main --message "你好，请介绍当前本地模型。"
```

此时OpenClaw调用的是`127.0.0.1:8080`，而不是StepFun云端API。可以在断开外网但保留本机会话时再次测试，确认模型推理仍能完成。

## 8. 部署四个Agent工作区

克隆项目：

```bash
git clone https://github.com/wangxianlina/-.git ~/zhiyan-arena
cd ~/zhiyan-arena
```

创建Agent：

```bash
openclaw agents add health
openclaw agents add study
openclaw agents add study-critic
```

建立工作区并安装角色说明：

```bash
mkdir -p ~/.openclaw/workspace
mkdir -p ~/.openclaw/workspace-health
mkdir -p ~/.openclaw/workspace-study
mkdir -p ~/.openclaw/workspace-study-critic

cp agents/main/AGENTS.md ~/.openclaw/workspace/AGENTS.md
cp agents/health/AGENTS.md ~/.openclaw/workspace-health/AGENTS.md
cp agents/study/AGENTS.md ~/.openclaw/workspace-study/AGENTS.md
cp agents/study-critic/AGENTS.md ~/.openclaw/workspace-study-critic/AGENTS.md

mkdir -p ~/.openclaw/workspace/skills/paper-debate-review
cp skills/paper-debate-review/SKILL.md \
  ~/.openclaw/workspace/skills/paper-debate-review/SKILL.md
```

通过`openclaw models list`确认本地模型的完整名称，并确保`main`、`health`、`study`和`study-critic`都选择同一个`llama-cpp`本地模型。不要为每个Agent启动一个独立`llama-server`。

Agent的本地算力分工如下：

| 本地组件 | DGX Spark承担的工作 |
|---|---|
| OpenClaw Gateway | 飞书消息接收、会话管理、任务路由 |
| main Agent | 任务拆分、调用研究员、组织辩论、汇总 |
| study / study-critic | 独立提示词、论文检索、方案生成和反驳 |
| Skills | 论文搜索、网页访问、文档解析、桌面或通知工具 |
| 本地存储 | Agent工作区、研究结果、记忆和日志 |
| llama-server | 统一加载Step-3.7-Flash并处理四个Agent的生成请求 |
| GB10 GPU与统一内存 | GGUF权重、KV Cache、CUDA算子和推理计算 |

## 9. 配置飞书并启动Gateway

飞书App ID和App Secret只能写入DGX Spark本地的`~/.openclaw/openclaw.json`或凭据存储，禁止提交到GitHub。参考仓库中的`config/openclaw.example.json`创建四个飞书账号和路由，但应保留`llama-cpp`本地模型配置，不要重新切换到`stepfun-plan`云端Provider。

启动并检查：

```bash
openclaw gateway install
openclaw gateway restart
openclaw status
openclaw doctor
```

## 10. 将llama-server配置为开机服务

创建用户级systemd服务：

```bash
mkdir -p ~/.config/systemd/user
nano ~/.config/systemd/user/step37-llama.service
```

写入以下内容，并将`YOUR_USER`替换为DGX Spark用户名：

```ini
[Unit]
Description=Step-3.7-Flash GGUF llama.cpp server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=HF_HOME=/home/YOUR_USER/models/huggingface
WorkingDirectory=/home/YOUR_USER/step37-llama.cpp
ExecStart=/home/YOUR_USER/step37-llama.cpp/build/bin/llama-server -hf stepfun-ai/Step-3.7-Flash-GGUF:IQ4_XS --host 127.0.0.1 --port 8080 -c 32768 -ngl 99 -fa on --parallel 1
Restart=on-failure
RestartSec=10
TimeoutStartSec=1800
LimitNOFILE=1048576

[Install]
WantedBy=default.target
```

启用服务：

```bash
systemctl --user daemon-reload
systemctl --user enable --now step37-llama.service
sudo loginctl enable-linger "$USER"
```

查看状态和日志：

```bash
systemctl --user status step37-llama.service
journalctl --user -u step37-llama.service -f
```

OpenClaw应在本地模型健康检查通过后再接收飞书任务。机器重启后可依次检查：

```bash
curl http://127.0.0.1:8080/health
openclaw status
```

## 11. 上下文、并发与内存优化

虽然Step-3.7-Flash支持最高256K上下文，但“模型支持”不等于所有并发配置都能稳定运行。上下文越长、并发槽越多，KV Cache越大。

建议按以下顺序调优：

1. 从`-c 32768 --parallel 1`开始。
2. 先完成一次完整的双研究员辩论任务。
3. 观察`free -h`、`nvidia-smi`和服务日志。
4. 内存充足时尝试64K上下文。
5. 确认稳定后再测试双并发，不建议直接设置四并发。
6. 出现OOM时优先降低上下文和并发，再考虑从Q4切换到Q3。
7. 论文原文先在本地切分、检索和摘要，只把相关段落送进模型。
8. 两名研究员可以并行搜索论文，但模型生成阶段由OpenClaw排队。

推荐的稳定配置：

```text
量化：IQ4_XS 或 Q3_K_M
上下文：32768
模型并发：1
OpenClaw Agent数量：4（共享模型服务）
视觉：默认关闭，需要时单独启用
```

## 12. 多模态可选配置

需要处理论文图片时，下载并加载约4GB的视觉投影文件：

```bash
./build/bin/llama-server \
  -m /path/to/Step-3.7-flash-IQ4_XS.gguf \
  --mmproj /path/to/mmproj-Step-3.7-flash-f16.gguf \
  --host 127.0.0.1 \
  --port 8080 \
  -c 16384 \
  -ngl 99 \
  -fa on \
  --parallel 1
```

启用视觉后先把上下文降至16K，并重新观察统一内存。多分片GGUF应把`-m`指向第一份分片；也可以继续使用`-hf`让llama.cpp自动管理模型与`mmproj`。

## 13. 常见故障

### `curl: (7) Failed to connect`

模型仍在下载或加载、服务已退出，或者端口不正确。检查：

```bash
journalctl --user -u step37-llama.service -n 200 --no-pager
ss -lntp | grep 8080
```

### 加载模型时OOM

关闭其他模型和容器，将上下文降到16K，保持`--parallel 1`；仍然失败时使用`Q3_K_M`或`IQ3_XXS`。

### 生成很慢

确认构建日志中启用了CUDA，启动参数包含`-ngl 99`，并检查是否错误使用了纯CPU构建：

```bash
nvidia-smi
ldd ~/step37-llama.cpp/build/bin/llama-server | grep -i cuda
```

### OpenClaw仍然调用StepFun云端

运行`openclaw models list`检查默认模型。Agent配置中如果仍固定为`stepfun-plan/step-3.7-flash`，需要将其改为onboard后生成的`llama-cpp`本地模型名称并重启Gateway。

### 飞书消息无回复

按顺序检查本地模型、OpenClaw和飞书渠道：

```bash
curl http://127.0.0.1:8080/health
openclaw agent --local --agent main --message "health check"
openclaw status
openclaw doctor
```

## 14. 验收标准

部署只有同时满足以下条件，才能在项目报告中写成“已在DGX Spark本地部署Step-3.7-Flash-GGUF”：

- `nvidia-smi`显示GB10在推理期间有计算和内存活动。
- `curl /health`返回成功。
- `curl /v1/chat/completions`能生成有效回答。
- OpenClaw默认模型显示为`llama-cpp`本地模型，而非`stepfun-plan`。
- `main`能够调用`study`和`study-critic`完成一次完整辩论。
- 飞书能够收到最终报告。
- 断开外部模型API后，本地推理仍可完成。
- 保存启动日志、内存占用、首Token延迟和生成速度作为比赛证据。

## 15. 官方资料

- [StepFun官方Step-3.7-Flash-GGUF模型卡](https://huggingface.co/stepfun-ai/Step-3.7-Flash-GGUF)
- [NVIDIA：在DGX Spark上使用llama.cpp](https://build.nvidia.com/spark/llama-cpp/instructions)
- [NVIDIA DGX Spark系统说明](https://docs.nvidia.com/dgx/dgx-spark/system-overview.html)
- [项目OpenClaw配置示例](../config/openclaw.example.json)

