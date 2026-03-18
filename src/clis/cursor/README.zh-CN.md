# Cursor 适配器

通过 Chrome DevTools Protocol (CDP) 在终端中控制 **Cursor IDE**。由于 Cursor 基于 Electron（VS Code 分支），OpenCLI 可以驱动其内部 UI，自动化 Composer 交互，操控聊天会话。

## 前置条件

1. 安装 [Cursor](https://cursor.sh/)。
2. 通过远程调试端口启动：
   ```bash
   /Applications/Cursor.app/Contents/MacOS/Cursor --remote-debugging-port=9226
   ```

## 配置

```bash
opencli connect cursor
```

## 命令

### 诊断
- `opencli cursor status`：检查 CDP 连接状态。
- `opencli cursor dump`：导出完整 DOM 和 Accessibility 快照到 `/tmp/cursor-dom.html` 和 `/tmp/cursor-snapshot.json`。

### 对话操作
- `opencli cursor new`：按 `Cmd+N` 创建新文件/标签。
- `opencli cursor send "消息"`：将文本注入活跃的 Composer/Chat 输入框并提交。
- `opencli cursor read`：提取当前聊天面板的完整对话历史。

### AI 功能
- `opencli cursor composer "提示词"`：打开 Composer 面板（`Cmd+I`）并发送提示词进行内联 AI 编辑。
- `opencli cursor model`：获取当前活跃的 AI 模型（如 `claude-4.5-sonnet`）。
- `opencli cursor extract-code`：从当前对话中提取所有代码块。
