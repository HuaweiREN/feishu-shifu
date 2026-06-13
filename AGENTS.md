# AGENTS.md

## Scope
- Project root: the `feishu-shifu/` directory within the cc-switch workspace.
- Follow the parent workspace rules in `../AGENTS.md`.
- Keep all project files under this project root unless the user explicitly asks otherwise.

## Project Shape
- TypeScript Node.js backend using Fastify.
- Entry point: `src/server.ts`.
- Feishu API wrapper: `src/services/feishu-client.ts`.
- DeepSeek API wrapper: `src/services/deepseek-client.ts`.
- Message orchestration: `src/flows/message-flow.ts`.

## Development Rules
- Keep phase-one changes focused on Feishu message handling, user-authorized document reading, DeepSeek calls, and card replies.
- Prefer small service functions over new abstractions until real reuse appears.
- Do not add persistence, queues, frontend UI, or deployment infrastructure unless requested.

## Validation
- After dependency installation, use `npm run typecheck`, `npm run test`, and `npm run build`.
- If Node/npm is unavailable, report that validation is blocked by the local environment.
