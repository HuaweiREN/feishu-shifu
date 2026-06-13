import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeepSeekClient } from "../services/deepseek-client.js";
import type { FeishuClient } from "../services/feishu-client.js";
import type { TokenStore } from "../stores/token-store.js";
import type { DocumentReference, FeishuMessageEvent } from "../types.js";
import { MessageFlow } from "./message-flow.js";

const tempRoots: string[] = [];
const standardRequestText = "上工了，师傅\n链接：\nhttps://example.feishu.cn/docx/ABC123\n需求：\n请总结文档重点";

describe("MessageFlow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const tempRoot of tempRoots.splice(0)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("ignores repeated deliveries for the same Feishu message", async () => {
    const replyInteractiveCard = vi.fn(async () => "processing-message-id");
    const updateInteractiveCard = vi.fn(async () => undefined);
    const replyMarkdownFile = vi.fn(async () => "file-message-id");
    const readDocumentContent = vi.fn(async () => "# Document");
    const answerFromDocument = vi.fn(async () => "answer");

    const feishu = {
      replyInteractiveCard,
      updateInteractiveCard,
      replyMarkdownFile,
      readDocumentContent,
      buildOAuthUrl: vi.fn(() => "https://auth.example.com")
    } as unknown as FeishuClient;
    const deepseek = { answerFromDocument, answerFromDocuments: vi.fn() } as unknown as DeepSeekClient;
    const tokenStore = {
      get: vi.fn(() => ({ accessToken: "user-token" })),
      getRaw: vi.fn(() => undefined),
      delete: vi.fn()
    } as unknown as TokenStore;
    const flow = new MessageFlow(feishu, deepseek, tokenStore, createResultsDir());

    const event = buildMessageEvent("message-id", standardRequestText, { chatType: "p2p" });

    await flow.handle(event);
    await flow.handle(event);

    expect(replyInteractiveCard).toHaveBeenCalledTimes(1);
    expect(readDocumentContent).toHaveBeenCalledTimes(1);
    expect(answerFromDocument).toHaveBeenCalledTimes(1);
    expect(updateInteractiveCard).toHaveBeenCalledTimes(3);
    expect(replyMarkdownFile).not.toHaveBeenCalled();
  });

  it("ignores group messages that do not mention the bot", async () => {
    const replyInteractiveCard = vi.fn(async () => "processing-message-id");
    const readDocumentContent = vi.fn(async () => "# Document");
    const getBotOpenId = vi.fn(async () => "ou_bot");

    const feishu = {
      getBotOpenId,
      replyInteractiveCard,
      updateInteractiveCard: vi.fn(async () => undefined),
      replyMarkdownFile: vi.fn(async () => "file-message-id"),
      readDocumentContent,
      buildOAuthUrl: vi.fn(() => "https://auth.example.com")
    } as unknown as FeishuClient;
    const deepseek = { answerFromDocument: vi.fn(async () => "answer"), answerFromDocuments: vi.fn() } as unknown as DeepSeekClient;
    const tokenStore = {
      get: vi.fn(() => ({ accessToken: "user-token" })),
      getRaw: vi.fn(() => undefined),
      delete: vi.fn()
    } as unknown as TokenStore;
    const flow = new MessageFlow(feishu, deepseek, tokenStore, createResultsDir());

    await flow.handle(buildMessageEvent("message-id", standardRequestText, { chatType: "group" }));

    expect(getBotOpenId).not.toHaveBeenCalled();
    expect(tokenStore.get).not.toHaveBeenCalled();
    expect(replyInteractiveCard).not.toHaveBeenCalled();
    expect(readDocumentContent).not.toHaveBeenCalled();
  });

  it("ignores group messages that mention someone else", async () => {
    const replyInteractiveCard = vi.fn(async () => "processing-message-id");
    const readDocumentContent = vi.fn(async () => "# Document");
    const getBotOpenId = vi.fn(async () => "ou_bot");

    const feishu = {
      getBotOpenId,
      replyInteractiveCard,
      updateInteractiveCard: vi.fn(async () => undefined),
      replyMarkdownFile: vi.fn(async () => "file-message-id"),
      readDocumentContent,
      buildOAuthUrl: vi.fn(() => "https://auth.example.com")
    } as unknown as FeishuClient;
    const deepseek = { answerFromDocument: vi.fn(async () => "answer"), answerFromDocuments: vi.fn() } as unknown as DeepSeekClient;
    const tokenStore = {
      get: vi.fn(() => ({ accessToken: "user-token" })),
      getRaw: vi.fn(() => undefined),
      delete: vi.fn()
    } as unknown as TokenStore;
    const flow = new MessageFlow(feishu, deepseek, tokenStore, createResultsDir());

    await flow.handle(
      buildMessageEvent("message-id", "@_user_1 " + standardRequestText, {
        chatType: "group",
        mentions: [
          {
            key: "@_user_1",
            name: "Other User",
            id: { open_id: "ou_other" }
          }
        ]
      })
    );

    expect(getBotOpenId).toHaveBeenCalledTimes(1);
    expect(tokenStore.get).not.toHaveBeenCalled();
    expect(replyInteractiveCard).not.toHaveBeenCalled();
    expect(readDocumentContent).not.toHaveBeenCalled();
  });

  it("handles group messages that mention the bot", async () => {
    const replyInteractiveCard = vi.fn(async () => "processing-message-id");
    const updateInteractiveCard = vi.fn(async () => undefined);
    const replyMarkdownFile = vi.fn(async () => "file-message-id");
    const readDocumentContent = vi.fn(async () => "# Document");
    const answerFromDocument = vi.fn(async () => "answer");
    const getBotOpenId = vi.fn(async () => "ou_bot");

    const feishu = {
      getBotOpenId,
      replyInteractiveCard,
      updateInteractiveCard,
      replyMarkdownFile,
      readDocumentContent,
      buildOAuthUrl: vi.fn(() => "https://auth.example.com")
    } as unknown as FeishuClient;
    const deepseek = { answerFromDocument, answerFromDocuments: vi.fn() } as unknown as DeepSeekClient;
    const tokenStore = {
      get: vi.fn(() => ({ accessToken: "user-token" })),
      getRaw: vi.fn(() => undefined),
      delete: vi.fn()
    } as unknown as TokenStore;
    const flow = new MessageFlow(feishu, deepseek, tokenStore, createResultsDir());

    await flow.handle(
      buildMessageEvent("message-id", "@_user_1 " + standardRequestText, {
        chatType: "group",
        mentions: [
          {
            key: "@_user_1",
            name: "Bot",
            id: { open_id: "ou_bot" }
          }
        ]
      })
    );

    expect(getBotOpenId).toHaveBeenCalledTimes(1);
    expect(replyInteractiveCard).toHaveBeenCalledTimes(1);
    expect(readDocumentContent).toHaveBeenCalledTimes(1);
    expect(answerFromDocument).toHaveBeenCalledTimes(1);
    expect(updateInteractiveCard).toHaveBeenCalledTimes(3);
    expect(replyMarkdownFile).not.toHaveBeenCalled();
  });

  it("packs all documents into one DeepSeek request for association tasks", async () => {
    const replyInteractiveCard = vi.fn(async () => "processing-message-id");
    const updateInteractiveCard = vi.fn(async () => undefined);
    const replyMarkdownFile = vi.fn(async () => "file-message-id");
    const readDocumentContent = vi.fn(async (reference: { token: string }) => `content-${reference.token}`);
    const answerFromDocument = vi.fn(async () => "single answer");
    const answerFromDocuments = vi.fn(async () => "combined answer");

    const feishu = {
      replyInteractiveCard,
      updateInteractiveCard,
      replyMarkdownFile,
      readDocumentContent,
      buildOAuthUrl: vi.fn(() => "https://auth.example.com")
    } as unknown as FeishuClient;
    const deepseek = { answerFromDocument, answerFromDocuments } as unknown as DeepSeekClient;
    const tokenStore = {
      get: vi.fn(() => ({ accessToken: "user-token" })),
      getRaw: vi.fn(() => undefined),
      delete: vi.fn()
    } as unknown as TokenStore;
    const flow = new MessageFlow(feishu, deepseek, tokenStore, createResultsDir());

    await flow.handle(
      buildMessageEvent(
        "message-id",
        "上工了，师傅\n任务种类：关联\n链接：\nhttps://example.feishu.cn/docx/AAA111\nhttps://example.feishu.cn/docx/BBB222\n需求：\n请找出两个文档之间的关联风险"
      )
    );

    expect(readDocumentContent).toHaveBeenCalledTimes(2);
    expect(answerFromDocument).not.toHaveBeenCalled();
    expect(answerFromDocuments).toHaveBeenCalledTimes(1);
    const associationCall = answerFromDocuments.mock.calls[0] as unknown as [{ userRequest: string; documents: unknown[] }] | undefined;
    expect(associationCall?.[0]).toMatchObject({
      userRequest: "请找出两个文档之间的关联风险",
      documents: [
        {
          reference: {
            token: "AAA111"
          },
          content: "content-AAA111"
        },
        {
          reference: {
            token: "BBB222"
          },
          content: "content-BBB222"
        }
      ]
    });
    expect(replyMarkdownFile).not.toHaveBeenCalled();
  });

  it("sends markdown as a file when the result contains a table", async () => {
    const replyInteractiveCard = vi.fn(async () => "processing-message-id");
    const updateInteractiveCard = vi.fn(async () => undefined);
    const replyMarkdownFile = vi.fn(async () => "file-message-id");
    const readDocumentContent = vi.fn(async () => "# Document");
    const answerFromDocument = vi.fn(async () => "| A | B |\n|---|---|\n| 1 | 2 |");

    const feishu = {
      replyInteractiveCard,
      updateInteractiveCard,
      replyMarkdownFile,
      readDocumentContent,
      buildOAuthUrl: vi.fn(() => "https://auth.example.com")
    } as unknown as FeishuClient;
    const deepseek = { answerFromDocument, answerFromDocuments: vi.fn() } as unknown as DeepSeekClient;
    const tokenStore = {
      get: vi.fn(() => ({ accessToken: "user-token" })),
      getRaw: vi.fn(() => undefined),
      delete: vi.fn()
    } as unknown as TokenStore;
    const flow = new MessageFlow(feishu, deepseek, tokenStore, createResultsDir());

    await flow.handle(
      buildMessageEvent(
        "message-id",
        "上工了，师傅\n链接：\nhttps://example.feishu.cn/docx/ABC123\n需求：\n请输出表格"
      )
    );

    expect(replyMarkdownFile).toHaveBeenCalledTimes(1);
    const fileReplyCall = replyMarkdownFile.mock.calls[0] as unknown as [string, string, string] | undefined;
    expect(fileReplyCall?.[0]).toBe("message-id");
    expect(fileReplyCall?.[1]).toMatch(/\.md$/);
    expect(fileReplyCall?.[2]).toContain("| A | B |");
    const updateCall = updateInteractiveCard.mock.calls.at(-1) as unknown as [string, unknown] | undefined;
    expect(JSON.stringify(updateCall?.[1])).toContain("Markdown 文件发送");
  });

  it("updates the processing card when markdown file delivery fails", async () => {
    const replyInteractiveCard = vi.fn(async () => "processing-message-id");
    const updateInteractiveCard = vi.fn(async () => undefined);
    const replyMarkdownFile = vi.fn(async () => {
      throw new Error("Feishu upload markdown file failed: 400 99991672 Access denied. im:resource:upload required");
    });
    const readDocumentContent = vi.fn(async () => "# Document");
    const answerFromDocument = vi.fn(async () => "| A | B |\n|---|---|\n| 1 | 2 |");

    const feishu = {
      replyInteractiveCard,
      updateInteractiveCard,
      replyMarkdownFile,
      readDocumentContent,
      buildOAuthUrl: vi.fn(() => "https://auth.example.com")
    } as unknown as FeishuClient;
    const deepseek = { answerFromDocument, answerFromDocuments: vi.fn() } as unknown as DeepSeekClient;
    const tokenStore = {
      get: vi.fn(() => ({ accessToken: "user-token" })),
      getRaw: vi.fn(() => undefined),
      delete: vi.fn()
    } as unknown as TokenStore;
    const flow = new MessageFlow(feishu, deepseek, tokenStore, createResultsDir());

    await flow.handle(
      buildMessageEvent(
        "message-id",
        "上工了，师傅\n链接：\nhttps://example.feishu.cn/docx/ABC123\n需求：\n请输出表格"
      )
    );

    expect(replyMarkdownFile).toHaveBeenCalledTimes(1);
    const updateCall = updateInteractiveCard.mock.calls.at(-1) as unknown as [string, unknown] | undefined;
    expect(JSON.stringify(updateCall?.[1])).toContain("Markdown 文件发送失败");
    expect(JSON.stringify(updateCall?.[1])).toContain("im:resource:upload");
  });

  it("processes kb_search by resolving wiki, listing children, and calling DeepSeek per page", async () => {
    const replyInteractiveCard = vi.fn(async () => "processing-message-id");
    const updateInteractiveCard = vi.fn(async () => undefined);
    const replyMarkdownFile = vi.fn(async () => "file-message-id");
    const getWikiNodeMetadata = vi.fn(async () => ({
      token: "parent-doc-token",
      objType: "docx",
      spaceId: "space-abc",
      nodeToken: "parent-node-token",
      title: "母页面",
      url: "https://example.feishu.cn/wiki/WIKI123"
    }));
    const listWikiChildNodes = vi.fn(async () => [
      { obj_token: "child-doc-1", obj_type: "docx", title: "子页面1", url: "https://example.feishu.cn/wiki/child-1" },
      { obj_token: "child-doc-2", obj_type: "docx", title: "子页面2", url: "https://example.feishu.cn/wiki/child-2" }
    ]);
    const readDocumentContent = vi.fn(async (reference: DocumentReference) =>
      reference.token === "parent-doc-token" ? "# Parent Content"
        : reference.token === "child-doc-1" ? "# Child 1 Content"
          : "# Child 2 Content"
    );
    const answerFromDocument = vi.fn(async (params: { documentContent: string }) =>
      params.documentContent === "# Parent Content" ? "parent answer"
        : params.documentContent === "# Child 1 Content" ? "child 1 answer"
          : "child 2 answer"
    );

    const feishu = {
      replyInteractiveCard,
      updateInteractiveCard,
      replyMarkdownFile,
      readDocumentContent,
      getWikiNodeMetadata,
      listWikiChildNodes,
      buildOAuthUrl: vi.fn(() => "https://auth.example.com")
    } as unknown as FeishuClient;
    const deepseek = { answerFromDocument, answerFromDocuments: vi.fn() } as unknown as DeepSeekClient;
    const tokenStore = {
      get: vi.fn(() => ({ accessToken: "user-token" })),
      getRaw: vi.fn(() => undefined),
      delete: vi.fn()
    } as unknown as TokenStore;
    const flow = new MessageFlow(feishu, deepseek, tokenStore, createResultsDir());

    await flow.handle(
      buildMessageEvent(
        "message-id",
        "上工了，师傅\n任务种类：知识库检索\n链接：\nhttps://example.feishu.cn/wiki/WIKI123\n需求：\n请总结每个子页面的重点"
      )
    );

    expect(getWikiNodeMetadata).toHaveBeenCalledWith("WIKI123", "user-token");
    expect(listWikiChildNodes).toHaveBeenCalledWith("space-abc", "parent-node-token", "user-token");
    expect(readDocumentContent).toHaveBeenCalledTimes(3);
    expect(answerFromDocument).toHaveBeenCalledTimes(3);
    expect(answerFromDocument.mock.calls[0]?.[0]).toMatchObject({
      userRequest: "请总结每个子页面的重点"
    });
    expect(replyMarkdownFile).not.toHaveBeenCalled();
  });
});

function createResultsDir(): string {
  mkdirSync(".data", { recursive: true });
  const tempRoot = mkdtempSync(join(process.cwd(), ".data", "message-flow-test-"));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function buildMessageEvent(
  messageId: string,
  text: string,
  options: {
    chatType?: string;
    mentions?: NonNullable<NonNullable<FeishuMessageEvent["event"]>["message"]>["mentions"];
  } = {}
): FeishuMessageEvent {
  return {
    header: {
      event_type: "im.message.receive_v1"
    },
    event: {
      sender: {
        sender_id: {
          open_id: "ou_test"
        }
      },
      message: {
        message_id: messageId,
        chat_type: options.chatType,
        mentions: options.mentions,
        content: JSON.stringify({ text })
      }
    }
  };
}