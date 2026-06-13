import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import { DeepSeekClient, splitDocumentContent } from "./deepseek-client.js";

const config: AppConfig = {
  PORT: 3000,
  FEISHU_EVENT_MODE: "websocket",
  PUBLIC_BASE_URL: "https://bot.example.com",
  FEISHU_APP_ID: "cli_test",
  FEISHU_APP_SECRET: "secret",
  FEISHU_OAUTH_SCOPES: "docs:document.content:read wiki:node:read",
  FEISHU_VERIFICATION_TOKEN: "verification",
  TOKEN_STORE_FILE: ".data/test-feishu-user-tokens.json",
  RESULTS_DIR: ".data/test-results",
  EXTERNAL_REQUEST_TIMEOUT_MS: 300_000,
  DEEPSEEK_API_KEY: "deepseek",
  DEEPSEEK_BASE_URL: "https://api.deepseek.com",
  DEEPSEEK_MODEL: "deepseek-v4-pro",
  DEEPSEEK_DOCUMENT_CHUNK_SIZE: 12
};

describe("splitDocumentContent", () => {
  it("splits long documents by paragraph boundaries when possible", () => {
    expect(splitDocumentContent("aaa\n\nbbb\n\ncccccccccccc", 10)).toEqual(["aaa\n\nbbb", "cccccccccc", "cc"]);
  });

  it("returns single chunk when content fits within chunk size", () => {
    expect(splitDocumentContent("short", 100)).toEqual(["short"]);
  });

  it("handles empty content", () => {
    expect(splitDocumentContent("", 100)).toEqual([""]);
  });

  it("handles whitespace-only content", () => {
    expect(splitDocumentContent("   \n\n  \n\n   ", 100)[0]).toBeDefined();
  });

  it("splits a single huge paragraph by character count", () => {
    const result = splitDocumentContent("abcdefghij", 3);
    expect(result).toEqual(["abc", "def", "ghi", "j"]);
  });

  it("clamps chunk size to 1 minimum", () => {
    const result = splitDocumentContent("hello", 0);
    expect(result[0]).toBeDefined();
    expect(result.every((chunk) => chunk.length > 0)).toBe(true);
  });
});

describe("DeepSeekClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls DeepSeek once per document chunk and concatenates chunk answers", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const userContent = body.messages[1]?.content ?? "";
      return jsonResponse({
        choices: [
          {
            message: {
              content: userContent.includes("chunk 1/2") ? "answer one" : "answer two"
            }
          }
        ]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new DeepSeekClient(config);
    const answer = await client.answerFromDocument({
      userRequest: "总结",
      documentContent: "第一段内容很长\n\n第二段内容也很长"
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(answer).toContain("已分 2 块调用 DeepSeek");
    expect(answer).toContain("## 分块 1/2");
    expect(answer).toContain("answer one");
    expect(answer).toContain("## 分块 2/2");
    expect(answer).toContain("answer two");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}