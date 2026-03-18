# Discord Desktop Adapter

Control the **Discord Desktop App** from the terminal via Chrome DevTools Protocol (CDP).

## Prerequisites

Launch with remote debugging port:
```bash
/Applications/Discord.app/Contents/MacOS/Discord --remote-debugging-port=9232
```

## Setup

```bash
opencli connect discord-app
```

## Commands

| Command | Description |
|---------|-------------|
| `discord status` | Check CDP connection |
| `discord send "message"` | Send a message in the active channel |
| `discord read` | Read recent messages |
| `discord channels` | List channels in the current server |
| `discord servers` | List all joined servers |
| `discord search "query"` | Search messages (Cmd+F) |
| `discord members` | List online members |
