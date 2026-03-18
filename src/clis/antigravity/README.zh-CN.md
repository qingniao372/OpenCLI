# Antigravity CLI Adapter (探针插件)

🔥 **opencli 支持 CLI 化所有 electron 应用！最强大更新来袭！** 🔥

CLI all electron！现在支持把所有 electron 应用 CLI 化，从而组合出各种神奇的能力。
如果你在使用诸如 Antigravity Ultra 等工具时觉得不够灵活或难以扩展，现在通过 OpenCLI 把他 CLI 化，轻松打破界限。

现在，**AI 可以自己控制自己**！结合 cc/openclaw 就可以远程控制任何 electron 应用！无限玩法！！

通过 Chrome DevTools Protocol (CDP)，将你本地运行的 Antigravity 桌面客户端转变为一个完全可编程的 AI 节点。这让你可以在命令行终端中直接操控它的 UI 界面，实现真正的“零 API 限制”本地自动化大模型工作流调度。

## 开发准备

首先，**请在终端启动 Antigravity 桌面版**，并附加上允许远程调试（CDP）的内核启动参数：

\`\`\`bash
# 在后台启动并驻留
/Applications/Antigravity.app/Contents/MacOS/Electron \
  --remote-debugging-port=9224
\`\`\`

*(注意：如果你打包的应用重命名过主构建，可能需要把 `Electron` 换成实际的可执行文件名，如 `Antigravity`)*

接下来，在你想执行 CLI 命令的另一个新终端板块里，让 OpenCLI 连接到这个桌面应用：

\`\`\`bash
opencli connect antigravity
\`\`\`

## 全部指令一览

### \`opencli antigravity status\`
快速检查当前探针与内核 CDP 的连接状态。会返回底层的当前 URL 和网页 Title。

### \`opencli antigravity send <message>\`
给 Agent 发送消息。它会自动定位到底部的 Lexical 输入框，安全地注入你的指定文本然后模拟回车发送。

### \`opencli antigravity read\`
全量抓取当前的对话面板，将所有历史聊天记录作为一整块纯文本取回。

### \`opencli antigravity new\`
模拟点击侧边栏顶部的“开启新对话”按钮，瞬间清空并重置 Agent 的上下文状态。

### \`opencli antigravity extract-code\`
从当前的 Agent 聊天记录中单独提取所有的多行代码块。非常适合自动化脚手架开发（例如直接重定向输出写入本地文件：\`opencli antigravity extract-code > script.sh\`）。

### \`opencli antigravity model <name>\`
切换大模型引擎。只需传入关键词（比如：\`opencli antigravity model claude\` 或 \`model gemini\`），它会自动帮你点开模型选择菜单并模拟点击。

### \`opencli antigravity watch\`
开启一个长连接流式监听。通过持续轮询 DOM 的变化量，它能像流式 API 一样，在终端实时向你推送 Agent 刚刚打出的那一行最新回复，直到你按 Ctrl+C 中止。
