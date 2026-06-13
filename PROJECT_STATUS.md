# feishu-shifu 状态归档

归档日期：2026-06-13（最终归档，准备发布 GitHub）

## 当前定位

`feishu-shifu` 是一个 TypeScript Node.js/Fastify 后端服务，通过飞书长连接接收机器人消息，使用用户授权读取飞书文档，调用 DeepSeek 处理需求，并用飞书卡片或 Markdown 文件返回结果。

## 运行状态

- 飞书长连接模式：`FEISHU_EVENT_MODE=websocket`
- 服务端口：`3000`，健康检查 `GET /health` 返回 `{"ok":true,"ws":"connected"}`
- 进程守护：`scripts/start-daemon.bat` 自动重启，日志写入 `.data/server.log` + `.data/daemon.log`
- 用户 OAuth token 持久化到 `.data/feishu-user-tokens.json`，过期自动刷新

## 关键配置

| 配置项 | 值 |
|--------|-----|
| `DEEPSEEK_MODEL` | `deepseek-v4-pro` |
| `DEEPSEEK_DOCUMENT_CHUNK_SIZE` | `30000` |
| `EXTERNAL_REQUEST_TIMEOUT_MS` | `300000` |
| `FEISHU_OAUTH_SCOPES` | `docs:document.content:read docx:document:readonly wiki:node:read wiki:node:retrieve drive:drive.metadata:readonly sheets:spreadsheet:readonly bitable:app:readonly` |

## 已实现功能

### 三种任务种类

| 任务 | 输入 | 行为 |
|------|------|------|
| `遍历` | 多个文档链接 | 逐个读取 → 逐个 DeepSeek → 汇总 |
| `关联` | 多个文档链接 | 全部读取 → 一次 DeepSeek 关联分析 |
| `知识库检索` | 一个 wiki 母页面链接 | 解析母页面 → 列出子页面 → 串行读取（1s 间隔）→ 串行 DeepSeek → 汇总 |

### 知识库检索 (kb_search)

- 输入一个 wiki 母页面，自动发现并遍历所有直接子页面（不递归）
- 母页面也参与分析，子页面按原顺序排列
- 无效节点（文件夹、快捷方式）自动跳过并标注
- 单页失败不中断整体处理

### 文档读取

- 支持 docx / wiki / sheet / bitable
- Wiki 解析：`get_node` → 按 obj_type 分流
- Docx 读取：Markdown content API + blocks API（表格、内嵌资源）
- 内嵌资源优先使用明确 token，失败时尝试 Drive metadata 解析

### 结果输出

- 结果 < 5000 字节且无表格 → 卡片直接显示
- 结果超限或含表格 → 发送 .md 文件
- 每次处理落盘 `.data/results/feishu-shifu-<timestamp>.md`

### 鲁棒性

| 机制 | 说明 |
|------|------|
| 进程守护 | `start-daemon.bat` 崩溃后 3 秒自动重启 |
| Crash 日志 | uncaughtException / unhandledRejection 记录到 `.data/server.log` |
| 忙锁 | 处理中拒绝新请求，回复"师傅正在忙"，finally 释放 |
| Token 刷新 | 过期 token 有 refreshToken 时自动续期，不立即要求重新授权 |
| Token 容错 | 损坏的文件自动备份，从空状态启动；刷新失败时清理旧 token |
| 飞书限流 | 串行读取 + 每页间隔 1s |
| DeepSeek 重试 | fetch failed 等 2s 重试一次 |
| 单页容错 | 子页面失败标注原因，不影响其他页面 |
| 空键防冲突 | 无效节点用 `__skipped_<index>` 唯一索引 |
| 错误不泄露 | HTTP 意外错误返回通用消息；卡片更新失败不中断批处理 |
| 优雅关闭 | SIGINT/SIGTERM → close WS → close HTTP |

### 诊断

- `[feishu-shifu]` 前缀日志记录每步耗时和内容大小
- DeepSeek 请求：开始/完成/失败（含内容大小和耗时）
- 子页面处理：读取/AI 各阶段的标题、编号、耗时
- 健康检查返回 WebSocket 连接状态

## 文件结构

```
src/
  server.ts                    # 服务入口、OAuth、WS 启动、优雅关闭
  config.ts                    # Zod 环境变量校验
  types.ts                     # 共享类型定义
  flows/
    message-flow.ts            # 消息处理主流程、去重、忙锁、三任务调度
  services/
    feishu-client.ts           # 飞书 API 封装（1100+ 行）
    deepseek-client.ts         # DeepSeek API 封装、分块、重试
    document-reference.ts      # 输入格式解析
    feishu-card.ts             # 飞书卡片 JSON 构建
    feishu-long-connection.ts  # 飞书 WS 长连接
    markdown-result.ts         # Markdown 结果生成
    fetch-timeout.ts           # fetch 超时包装
  stores/
    token-store.ts             # Token 本地持久化
scripts/
  start-daemon.bat             # 进程守护脚本（崩溃自动重启）
```

## 验证结果

- `npm run typecheck` — 通过
- `npm run test` — 7 个测试文件，56 个测试通过
- `npm run build` — 通过
- 服务运行中 — `{"ok":true,"ws":"connected"}`

## 已知局限

- kb_search 仅遍历直接子页面，不递归
- 遍历/关联模式为串行处理
- Token 存储为本地文件，适合单机开发
- 结果文件 `.data/results` 无自动清理
- Windows 下 `taskkill //F //IM "node.exe"` 会误杀所有 node 进程（已改为按 PID 杀）

## Git 历史（21 个 commit）

```
1916f9c Fix: retry fetch failures + reduce AI concurrency to 1
3361252 Fix: add busy lock to prevent concurrent message processing
26afd22 Fix: add 1s throttle between Feishu reads + readable content-safety error
c96af0d Fix: add crash handlers and daemon script to prevent service downtime
f158472 Fix: revert child page reading to serial to avoid Feishu rate limit
119420b Fix: prevent premature token deletion before refresh attempt
15b4750 docs: add 10-round iteration summary to PROJECT_STATUS
ce0b384 Fix: enable automatic_fields in bitable record API call
8a85bf9 docs: comprehensive README update for current project state
a4cc92d docs: note card-progress resilience improvement in PROJECT_STATUS
18359df Fix: make card progress updates non-fatal during batch processing
f024fac Fix: update STANDARD_REQUEST_FORMAT to mention all task kinds
66eeeaf Fix: include wiki:node:retrieve in wiki resolution error hint
38eeb57 Fix: prevent key collision for skipped wiki nodes in kb_search
96f1a2f docs: update verification results and recent commits in PROJECT_STATUS
1045ac8 test: add fetch-timeout test + splitDocumentContent edge cases
103e78f Fix: prevent internal error leakage, louder bot-id failure
8a0c60c docs: update PROJECT_STATUS with kb_search and recent improvements
9cd0f57 feat: kb_search, parallel processing, graceful shutdown, full logging
ac88cf0 Fix: robustness and UX improvements for feishu-shifu
210522d Add feishu-shifu: Feishu bot backend for document reading + DeepSeek Q&A
```
