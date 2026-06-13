import "dotenv/config";

process.on("uncaughtException", (error) => {
  console.error(new Date().toISOString(), "UNCAUGHT EXCEPTION", error);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error(new Date().toISOString(), "UNHANDLED REJECTION", reason);
  process.exit(1);
});

import Fastify from "fastify";
import formBody from "@fastify/formbody";
import { loadConfig } from "./config.js";
import { MessageFlow } from "./flows/message-flow.js";
import { DeepSeekClient } from "./services/deepseek-client.js";
import { FeishuClient } from "./services/feishu-client.js";
import { startFeishuLongConnection } from "./services/feishu-long-connection.js";
import { FileTokenStore } from "./stores/token-store.js";
import type { FeishuMessageEvent } from "./types.js";

const config = loadConfig();
const app = Fastify({ logger: true });

await app.register(formBody);

const tokenStore = new FileTokenStore(config.TOKEN_STORE_FILE);
const feishu = new FeishuClient(config);
const deepseek = new DeepSeekClient(config);
const messageFlow = new MessageFlow(feishu, deepseek, tokenStore);
const feishuWsClient = config.FEISHU_EVENT_MODE === "websocket" ? startFeishuLongConnection(config, messageFlow) : null;

app.get("/health", async () => {
  const wsState = feishuWsClient ? feishuWsClient.getConnectionStatus().state : "disabled";
  return { ok: true, ws: wsState };
});

app.get("/feishu/oauth/callback", async (request, reply) => {
  const query = request.query as { code?: string; state?: string };
  if (!query.code || !query.state) {
    return reply.status(400).send("Missing code or state.");
  }

  const token = await feishu.exchangeOAuthCode(query.code);
  tokenStore.set(query.state, token);
  return reply
    .header("Content-Type", "text/html; charset=utf-8")
    .send("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>授权完成</title></head><body>授权完成。请回到飞书聊天窗口，重新发送文档链接和需求。</body></html>");
});

app.post("/feishu/events", async (request, reply) => {
  const body = request.body as Record<string, unknown>;

  if (config.FEISHU_EVENT_MODE === "websocket") {
    return reply.status(409).send({ error: "Feishu event receiving is running in websocket mode." });
  }

  if (body.type === "url_verification") {
    if (body.token !== config.FEISHU_VERIFICATION_TOKEN) {
      return reply.status(401).send({ error: "Invalid verification token." });
    }

    return { challenge: body.challenge };
  }

  if (typeof body.encrypt === "string") {
    return reply.status(400).send({ error: "Encrypted Feishu callbacks are not implemented yet. Disable Encrypt Key for phase one." });
  }

  const event = body as FeishuMessageEvent;
  if (event.header?.token !== config.FEISHU_VERIFICATION_TOKEN) {
    return reply.status(401).send({ error: "Invalid event token." });
  }

  await messageFlow.handle(event);
  return { ok: true };
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);

  if (error instanceof Error && error.message.includes("Missing code or state")) {
    return reply.status(400).send({ error: error.message });
  }

  return reply.status(500).send({ error: "Internal server error." });
});

const shutdown = async () => {
  app.log.info("Shutting down...");
  if (feishuWsClient) {
    feishuWsClient.close();
    app.log.info("Feishu WS client closed.");
  }
  await app.close();
  app.log.info("Server closed.");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: "0.0.0.0", port: config.PORT });
