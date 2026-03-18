# ChatWise 适配器

通过 Chrome DevTools Protocol (CDP) 在终端中控制 **ChatWise 桌面应用**。ChatWise 是基于 Electron 的多 LLM 客户端，支持 GPT-4、Claude、Gemini 等。

## 前置条件

1. 安装 [ChatWise](https://chatwise.app/)。
2. 通过远程调试端口启动：
   ```bash
   /Applications/ChatWise.app/Contents/MacOS/ChatWise --remote-debugging-port=9228
   ```

## 配置

```bash
opencli connect chatwise
```

## 命令

### 诊断
- `opencli chatwise status`：检查 CDP 连接状态。
- `opencli chatwise screenshot`：导出 DOM + accessibility 快照。

### 对话
- `opencli chatwise new`：开始新对话（`Cmd+N`）。
- `opencli chatwise send "消息"`：发送消息到当前对话。
- `opencli chatwise read`：读取当前对话内容。
- `opencli chatwise ask "提示词"`：发送 + 等待回复 + 返回结果（一站式）。

### AI 功能
- `opencli chatwise model`：获取当前 AI 模型。
- `opencli chatwise model gpt-4`：切换模型。

### 组织管理
- `opencli chatwise history`：列出 sidebar 会话列表。
- `opencli chatwise export`：导出对话为 Markdown 文件。
