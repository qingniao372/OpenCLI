# Discord 桌面端适配器

通过 Chrome DevTools Protocol (CDP) 在终端中控制 **Discord 桌面应用**。

## 前置条件

通过远程调试端口启动：
```bash
/Applications/Discord.app/Contents/MacOS/Discord --remote-debugging-port=9232
```

## 配置

```bash
opencli connect discord-app
```

## 命令

| 命令 | 说明 |
|------|------|
| `discord status` | 检查 CDP 连接 |
| `discord send "消息"` | 在当前频道发送消息 |
| `discord read` | 读取最近消息 |
| `discord channels` | 列出当前服务器的频道 |
| `discord servers` | 列出已加入的服务器 |
| `discord search "关键词"` | 搜索消息（Cmd+F） |
| `discord members` | 列出在线成员 |
