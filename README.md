# feishu-shifu

Feishu bot backend that reads user-authorized Feishu documents and analyzes them with DeepSeek AI.

## How It Works

```
@Kakashi 上工了，师傅
任务种类：知识库检索
链接：
https://example.feishu.cn/wiki/ABC123
需求：
检查工单，按格式反馈结果
```

↓ The bot resolves the wiki page, lists all child pages, reads each one, calls DeepSeek, and returns a structured Markdown result.

## Features

- **Three task modes**: per-document traversal, cross-document association, and automatic wiki child-page discovery (kb_search)
- **Feishu Long Connection**: no public callback URL required for receiving messages
- **User OAuth**: reads documents with the user's own permissions
- **Automatic token refresh**: expired tokens are refreshed silently, re-auth only when necessary
- **Crash resilience**: daemon script with auto-restart and crash logging
- **Graceful shutdown**: SIGINT/SIGTERM cleanly closes WebSocket and HTTP server

## Quick Start

### Prerequisites

- Node.js 20+
- A Feishu app with bot capability, long connection mode, and OAuth configured
- DeepSeek API key

### Setup

```bash
git clone <repo-url> feishu-shifu
cd feishu-shifu
npm install
cp .env.example .env
```

Edit `.env` with your credentials:

```env
PORT=3000
PUBLIC_BASE_URL=http://127.0.0.1:3000
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_MODEL=deepseek-v4-pro
```

### Run

```bash
# Development
npm run dev

# Production (Linux, via systemd)
sudo systemctl start feishu-shifu
```

## Task Modes

| Mode | Command | Behavior |
|------|---------|----------|
| `遍历` (traverse) | Paste multiple doc links | Reads each doc → calls DeepSeek per doc → aggregates |
| `关联` (associate) | Paste multiple doc links | Reads all docs → single DeepSeek cross-doc analysis |
| `知识库检索` (kb_search) | Paste one wiki link | Resolves parent → lists child pages → analyzes all |

### kb_search Example

```
上工了，师傅
任务种类：知识库检索
链接：
https://xxx.feishu.cn/wiki/TOKEN
需求：
请总结每个子页面的重点
```

## Feishu App Configuration

1. Enable bot capability
2. Subscribe to `im.message.receive_v1` event
3. Set subscription mode to **long connection**
4. Configure OAuth redirect URL: `{PUBLIC_BASE_URL}/feishu/oauth/callback`
5. Grant user OAuth scopes: `docs:document.content:read`, `docx:document:readonly`, `wiki:node:read`, `wiki:node:retrieve`, `drive:drive.metadata:readonly`, `sheets:spreadsheet:readonly`, `bitable:app:readonly`

## Development

```bash
npm run dev        # Start with hot reload
npm run typecheck  # TypeScript check
npm run test       # Run 56 tests across 7 test files
npm run build      # Compile to dist/
```

## Project Structure

```
src/
  server.ts                     # Entry point, OAuth, graceful shutdown
  config.ts                     # Zod env validation
  types.ts                      # Shared types
  flows/
    message-flow.ts             # Message routing, dedup, busy lock
  services/
    feishu-client.ts            # Feishu API (docs, wiki, sheets, bitable)
    deepseek-client.ts          # DeepSeek API with chunking & retry
    document-reference.ts       # Input format parsing
    feishu-card.ts              # Feishu interactive card builder
    feishu-long-connection.ts   # WebSocket event dispatch
    markdown-result.ts          # Markdown generation
    fetch-timeout.ts            # AbortController timeout wrapper
  stores/
    token-store.ts              # File-based token persistence
scripts/
  start-daemon.bat              # Windows crash-restart daemon
docs/
  linux-migration.md            # Linux deployment guide
```

## Deployment

- **Windows**: `scripts/start-daemon.bat` (auto-restart on crash, logs to `.data/`)
- **Linux**: see `docs/linux-migration.md` for systemd setup

## License

MIT
