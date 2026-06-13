import * as lark from "@larksuiteoapi/node-sdk";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { AppConfig } from "../config.js";
import type { MessageFlow } from "../flows/message-flow.js";
import type { FeishuMessageEvent } from "../types.js";

type FeishuEvent = NonNullable<FeishuMessageEvent["event"]>;

interface FeishuLongConnectionMessageEvent {
  token?: string;
  sender?: FeishuEvent["sender"];
  message?: FeishuEvent["message"];
}

export function startFeishuLongConnection(config: AppConfig, messageFlow: MessageFlow): lark.WSClient {
  const dispatcher = new lark.EventDispatcher({
    verificationToken: config.FEISHU_VERIFICATION_TOKEN,
    encryptKey: config.FEISHU_ENCRYPT_KEY
  });

  dispatcher.register({
    "im.message.receive_v1": async (data: FeishuLongConnectionMessageEvent) => {
      console.info("[feishu-shifu] received event via WebSocket", JSON.stringify({ token: data.token, messageId: data.message?.message_id, chatType: data.message?.chat_type, hasMentions: Array.isArray(data.message?.mentions) && data.message!.mentions!.length > 0 }));
      await messageFlow.handle({
        header: {
          event_type: "im.message.receive_v1",
          token: data.token
        },
        event: {
          sender: data.sender,
          message: data.message
        }
      });
    }
  });

  const proxyUrl = config.FEISHU_PROXY_URL;
  const wsClient = new lark.WSClient({
    appId: config.FEISHU_APP_ID,
    appSecret: config.FEISHU_APP_SECRET,
    domain: lark.Domain.Feishu,
    agent: proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined,
    loggerLevel: lark.LoggerLevel.info,
    handshakeTimeoutMs: 15_000,
    onReady: () => console.info("Feishu long connection is ready."),
    onError: (error) => console.error("Feishu long connection failed.", error),
    onReconnecting: () => console.warn("Feishu long connection reconnecting."),
    onReconnected: () => console.info("Feishu long connection reconnected.")
  });

  void wsClient.start({ eventDispatcher: dispatcher });
  return wsClient;
}