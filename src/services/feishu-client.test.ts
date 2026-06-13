import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import { FeishuClient } from "./feishu-client.js";

const config: AppConfig = {
  PORT: 3000,
  FEISHU_EVENT_MODE: "websocket",
  PUBLIC_BASE_URL: "https://bot.example.com",
  FEISHU_APP_ID: "cli_test",
  FEISHU_APP_SECRET: "secret",
  FEISHU_OAUTH_SCOPES: "docs:document.content:read docx:document:readonly wiki:node:read drive:drive.metadata:readonly sheets:spreadsheet:readonly bitable:app:readonly",
  FEISHU_VERIFICATION_TOKEN: "verification",
  TOKEN_STORE_FILE: ".data/test-feishu-user-tokens.json",
  RESULTS_DIR: ".data/test-results",
  EXTERNAL_REQUEST_TIMEOUT_MS: 300_000,
  DEEPSEEK_API_KEY: "deepseek",
  DEEPSEEK_BASE_URL: "https://api.deepseek.com",
  DEEPSEEK_MODEL: "deepseek-v4-pro",
  DEEPSEEK_DOCUMENT_CHUNK_SIZE: 30_000
};

describe("FeishuClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads tenant access token from the top-level Feishu response", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/tenant_access_token/internal")) {
        return jsonResponse({
          code: 0,
          msg: "ok",
          tenant_access_token: "tenant-token",
          expire: 7200
        });
      }

      expect(url).toContain("/im/v1/messages/message-id/reply");
      return jsonResponse({ code: 0, msg: "ok", data: { message_id: "reply-message-id" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FeishuClient(config);
    const replyMessageId = await client.replyInteractiveCard("message-id", { header: { title: "ok" } });

    expect(replyMessageId).toBe("reply-message-id");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer tenant-token"
      })
    });
  });

  it("reads bot open id from the top-level Feishu bot info response", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/tenant_access_token/internal")) {
        return jsonResponse({
          code: 0,
          msg: "ok",
          tenant_access_token: "tenant-token",
          expire: 7200
        });
      }

      expect(url).toBe("https://open.feishu.cn/open-apis/bot/v3/info");
      return jsonResponse({ code: 0, msg: "ok", bot: { open_id: "ou_bot" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FeishuClient(config);

    await expect(client.getBotOpenId()).resolves.toBe("ou_bot");
    await expect(client.getBotOpenId()).resolves.toBe("ou_bot");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer tenant-token"
      })
    });
  });

  it("updates an existing interactive card", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/tenant_access_token/internal")) {
        return jsonResponse({
          code: 0,
          msg: "ok",
          tenant_access_token: "tenant-token",
          expire: 7200
        });
      }

      expect(url).toContain("/im/v1/messages/card-message-id");
      return jsonResponse({ code: 0, msg: "ok", data: {} });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FeishuClient(config);
    await client.updateInteractiveCard("card-message-id", { header: { title: "done" } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "PATCH",
      headers: expect.objectContaining({
        Authorization: "Bearer tenant-token"
      }),
      body: JSON.stringify({
        content: JSON.stringify({ header: { title: "done" } })
      })
    });
  });

  it("includes configured OAuth scopes in authorization URLs", () => {
    const client = new FeishuClient(config);
    const url = new URL(client.buildOAuthUrl("ou_test"));

    expect(url.searchParams.get("scope")).toBe(
      "docs:document.content:read docx:document:readonly wiki:node:read drive:drive.metadata:readonly sheets:spreadsheet:readonly bitable:app:readonly"
    );
  });

  it("reads docx markdown content with a user access token", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/docs/v1/content")) {
        return jsonResponse({ code: 0, msg: "success", data: { content: "# Hello" } });
      }

      expect(url).toBe(
        "https://open.feishu.cn/open-apis/docx/v1/documents/B4EPdAYx8oi8HRxgPQQbM15UcBf/blocks?document_revision_id=-1&page_size=500"
      );
      return jsonResponse({ code: 0, msg: "success", data: { items: [], has_more: false } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FeishuClient(config);
    const content = await client.readDocumentContent(
      {
        kind: "docx",
        token: "B4EPdAYx8oi8HRxgPQQbM15UcBf",
        url: "https://example.feishu.cn/docx/B4EPdAYx8oi8HRxgPQQbM15UcBf"
      },
      "user-token"
    );

    expect(content).toBe("# Hello");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://open.feishu.cn/open-apis/docs/v1/content?content_type=markdown&doc_token=B4EPdAYx8oi8HRxgPQQbM15UcBf&doc_type=docx&lang=zh"
    );
    expect(init).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer user-token",
        "Content-Type": "application/json; charset=utf-8"
      })
    });
  });

  it("appends rich text tables from docx blocks", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/docs/v1/content")) {
        return jsonResponse({ code: 0, msg: "success", data: { content: "# Hello" } });
      }

      expect(url).toBe("https://open.feishu.cn/open-apis/docx/v1/documents/doc-token/blocks?document_revision_id=-1&page_size=500");
      return jsonResponse({
        code: 0,
        msg: "success",
        data: {
          items: [
            {
              block_id: "table-block",
              table: {
                property: {
                  row_size: 2,
                  column_size: 2
                }
              },
              children: ["cell-1", "cell-2", "cell-3", "cell-4"]
            },
            { block_id: "cell-1", table_cell: {}, children: ["text-1"] },
            { block_id: "cell-2", table_cell: {}, children: ["text-2"] },
            { block_id: "cell-3", table_cell: {}, children: ["text-3"] },
            { block_id: "cell-4", table_cell: {}, children: ["text-4"] },
            { block_id: "text-1", text: { elements: [{ text_run: { content: "姓名" } }] } },
            { block_id: "text-2", text: { elements: [{ text_run: { content: "状态" } }] } },
            { block_id: "text-3", text: { elements: [{ text_run: { content: "张三" } }] } },
            { block_id: "text-4", text: { elements: [{ text_run: { content: "完成" } }] } }
          ],
          has_more: false
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FeishuClient(config);
    const content = await client.readDocumentContent(
      {
        kind: "docx",
        token: "doc-token",
        url: "https://example.feishu.cn/docx/doc-token"
      },
      "user-token"
    );

    expect(content).toContain("# Hello");
    expect(content).toContain("## 文档内表格 1");
    expect(content).toContain("| 姓名 | 状态 |");
    expect(content).toContain("| 张三 | 完成 |");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("appends embedded sheets and bitables from docx blocks", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/docs/v1/content")) {
        return jsonResponse({ code: 0, msg: "success", data: { content: "# Hello" } });
      }

      if (url.includes("/docx/v1/documents/doc-token/blocks")) {
        return jsonResponse({
          code: 0,
          msg: "success",
          data: {
            items: [
              { block_id: "sheet-block", sheet: { token: "docx-sheet-block-token", spreadsheet_token: "spreadsheet-token" } },
              { block_id: "bitable-block", bitable: { token: "docx-bitable-block-token", app_token: "app-token" } }
            ],
            has_more: false
          }
        });
      }

      if (url.endsWith("/sheets/v3/spreadsheets/spreadsheet-token/sheets/query")) {
        return jsonResponse({
          code: 0,
          msg: "success",
          data: {
            sheets: [{ sheet_id: "sheet-id", title: "Sheet1" }]
          }
        });
      }

      if (url.endsWith("/sheets/v2/spreadsheets/spreadsheet-token/values/sheet-id")) {
        return jsonResponse({
          code: 0,
          msg: "success",
          data: {
            valueRange: {
              values: [["A", "B"]]
            }
          }
        });
      }

      if (url.endsWith("/bitable/v1/apps/app-token/tables?page_size=100")) {
        return jsonResponse({
          code: 0,
          msg: "success",
          data: {
            items: [{ table_id: "table-id", name: "数据表" }],
            has_more: false
          }
        });
      }

      expect(url).toBe(
        "https://open.feishu.cn/open-apis/bitable/v1/apps/app-token/tables/table-id/records?page_size=500&automatic_fields=true"
      );
      return jsonResponse({
        code: 0,
        msg: "success",
        data: {
          items: [{ fields: { 文本: "苹果" } }],
          has_more: false
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FeishuClient(config);
    const content = await client.readDocumentContent(
      {
        kind: "docx",
        token: "doc-token",
        url: "https://example.feishu.cn/docx/doc-token"
      },
      "user-token"
    );

    expect(content).toContain("## 文档内嵌电子表格 1");
    expect(content).toContain("# 飞书电子表格");
    expect(content).toContain("## 文档内嵌多维表格 1");
    expect(content).toContain("# 飞书多维表格");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("reports when an embedded sheet block token cannot be resolved", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/docs/v1/content")) {
        return jsonResponse({ code: 0, msg: "success", data: { content: "# Hello" } });
      }

      if (url.includes("/docx/v1/documents/doc-token/blocks")) {
        return jsonResponse({
          code: 0,
          msg: "success",
          data: {
            items: [{ block_id: "sheet-block", sheet: { token: "invalid-sheet-token" } }],
            has_more: false
          }
        });
      }

      if (url.endsWith("/sheets/v3/spreadsheets/invalid-sheet-token/sheets/query")) {
        return jsonResponse(
          {
            code: 1310251,
            msg: "Path param :spreadsheet_token invalid"
          },
          400
        );
      }

      expect(url).toBe("https://open.feishu.cn/open-apis/drive/v1/metas/batch_query");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        request_docs: [{ doc_token: "invalid-sheet-token", doc_type: "sheet" }]
      });
      return jsonResponse({ code: 0, msg: "success", data: { metas: [] } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FeishuClient(config);
    const content = await client.readDocumentContent(
      {
        kind: "docx",
        token: "doc-token",
        url: "https://example.feishu.cn/docx/doc-token"
      },
      "user-token"
    );

    expect(content).toContain("# Hello");
    expect(content).toContain("## 文档内嵌电子表格 1");
    expect(content).toContain("读取失败");
    expect(content).toContain("Path param :spreadsheet_token invalid");
    expect(content).toContain("未返回可读取的电子表格 URL 或 token");
  });

  it("resolves embedded sheet tokens through Drive metadata when block tokens are not spreadsheet tokens", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/docs/v1/content")) {
        return jsonResponse({ code: 0, msg: "success", data: { content: "# Hello" } });
      }

      if (url.includes("/docx/v1/documents/doc-token/blocks")) {
        return jsonResponse({
          code: 0,
          msg: "success",
          data: {
            items: [{ block_id: "sheet-block", sheet: { token: "docx-sheet-block-token" } }],
            has_more: false
          }
        });
      }

      if (url.endsWith("/sheets/v3/spreadsheets/docx-sheet-block-token/sheets/query")) {
        return jsonResponse(
          {
            code: 1310251,
            msg: "Path param :spreadsheet_token invalid"
          },
          400
        );
      }

      if (url.endsWith("/drive/v1/metas/batch_query")) {
        expect(init).toMatchObject({ method: "POST" });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          request_docs: [{ doc_token: "docx-sheet-block-token", doc_type: "sheet" }]
        });
        return jsonResponse({
          code: 0,
          msg: "success",
          data: {
            metas: [{ url: "https://example.feishu.cn/sheets/spreadsheet-token" }]
          }
        });
      }

      if (url.endsWith("/sheets/v3/spreadsheets/spreadsheet-token/sheets/query")) {
        return jsonResponse({
          code: 0,
          msg: "success",
          data: { sheets: [{ sheet_id: "sheet-id", title: "Sheet1" }] }
        });
      }

      expect(url).toBe("https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/spreadsheet-token/values/sheet-id");
      return jsonResponse({
        code: 0,
        msg: "success",
        data: { valueRange: { values: [["A", "B"]] } }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FeishuClient(config);
    const content = await client.readDocumentContent(
      {
        kind: "docx",
        token: "doc-token",
        url: "https://example.feishu.cn/docx/doc-token"
      },
      "user-token"
    );

    expect(content).toContain("## 文档内嵌电子表格 1");
    expect(content).toContain("# 飞书电子表格");
    expect(content).toContain("| A | B |");
    expect(content).not.toContain("读取失败");
  });

  it("resolves wiki sheet nodes and reads spreadsheet values", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/wiki/v2/spaces/get_node")) {
        return jsonResponse({
          code: 0,
          msg: "success",
          data: {
            node: {
              obj_type: "sheet",
              obj_token: "spreadsheet-token"
            }
          }
        });
      }

      if (url.endsWith("/sheets/v3/spreadsheets/spreadsheet-token/sheets/query")) {
        return jsonResponse({
          code: 0,
          msg: "success",
          data: {
            sheets: [
              {
                sheet_id: "sheet-id",
                title: "Sheet1"
              }
            ]
          }
        });
      }

      expect(url).toBe("https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/spreadsheet-token/values/sheet-id");
      return jsonResponse({
        code: 0,
        msg: "success",
        data: {
          valueRange: {
            values: [
              [1, 2, 3],
              [2, 22, 32]
            ]
          }
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FeishuClient(config);
    const content = await client.readDocumentContent(
      {
        kind: "wiki",
        token: "wiki-token",
        url: "https://example.feishu.cn/wiki/wiki-token"
      },
      "user-token"
    );

    expect(content).toContain("# 飞书电子表格");
    expect(content).toContain("## Sheet1");
    expect(content).toContain("| 列1 | 列2 | 列3 |");
    expect(content).toContain("| 1 | 2 | 3 |");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("resolves wiki bitable nodes and reads table records", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/wiki/v2/spaces/get_node")) {
        return jsonResponse({
          code: 0,
          msg: "success",
          data: {
            node: {
              obj_type: "bitable",
              obj_token: "app-token"
            }
          }
        });
      }

      if (url.endsWith("/bitable/v1/apps/app-token/tables?page_size=100")) {
        return jsonResponse({
          code: 0,
          msg: "success",
          data: {
            items: [
              {
                table_id: "table-id",
                name: "数据表"
              }
            ],
            has_more: false
          }
        });
      }

      expect(url).toBe(
        "https://open.feishu.cn/open-apis/bitable/v1/apps/app-token/tables/table-id/records?page_size=500&automatic_fields=true"
      );
      return jsonResponse({
        code: 0,
        msg: "success",
        data: {
          items: [
            {
              fields: {
                文本: "苹果",
                数字: "1.1",
                选择: "Y"
              }
            },
            {
              fields: {
                文本: "香蕉",
                数字: "2.1",
                选择: "N"
              }
            }
          ],
          has_more: false
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FeishuClient(config);
    const content = await client.readDocumentContent(
      {
        kind: "wiki",
        token: "wiki-token",
        url: "https://example.feishu.cn/wiki/wiki-token"
      },
      "user-token"
    );

    expect(content).toContain("# 飞书多维表格");
    expect(content).toContain("## 数据表");
    expect(content).toContain("| 文本 | 数字 | 选择 |");
    expect(content).toContain("| 苹果 | 1.1 | Y |");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uploads and replies with markdown files", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/tenant_access_token/internal")) {
        return jsonResponse({
          code: 0,
          msg: "ok",
          tenant_access_token: "tenant-token",
          expire: 7200
        });
      }

      if (url.endsWith("/im/v1/files")) {
        expect(init).toMatchObject({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer tenant-token"
          })
        });
        expect(init?.body).toBeInstanceOf(FormData);
        return jsonResponse({ code: 0, msg: "ok", data: { file_key: "file-key" } });
      }

      expect(url).toContain("/im/v1/messages/message-id/reply");
      expect(init).toMatchObject({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer tenant-token",
          "Content-Type": "application/json"
        }),
        body: JSON.stringify({
          msg_type: "file",
          content: JSON.stringify({ file_key: "file-key" })
        })
      });
      return jsonResponse({ code: 0, msg: "ok", data: { message_id: "file-message-id" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FeishuClient(config);
    const replyMessageId = await client.replyMarkdownFile("message-id", "result.md", "# Result");

    expect(replyMessageId).toBe("file-message-id");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns enriched wiki node metadata including space_id and node_token", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/wiki/v2/spaces/get_node")) {
        return jsonResponse({
          code: 0,
          msg: "success",
          data: {
            node: {
              obj_token: "doc-token",
              obj_type: "docx",
              space_id: "space-abc",
              node_token: "wiki-node-123",
              title: "母页面标题",
              url: "https://example.feishu.cn/wiki/WIKI123",
              has_child: true
            }
          }
        });
      }
      return jsonResponse({ code: 0, msg: "success", data: { content: "# Parent Page" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FeishuClient(config);
    const metadata = await client.getWikiNodeMetadata("WIKI123", "user-token");

    expect(metadata).toMatchObject({
      token: "doc-token",
      objType: "docx",
      spaceId: "space-abc",
      nodeToken: "wiki-node-123",
      title: "母页面标题",
      hasChild: true
    });
    expect(metadata.url).toContain("WIKI123");
  });

  it("lists child wiki nodes with pagination", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (!url.includes("/wiki/v2/spaces/space-abc/nodes")) {
        return jsonResponse({ code: 0, msg: "ok" });
      }

      callCount += 1;
      if (callCount === 1) {
        return jsonResponse({
          code: 0,
          msg: "success",
          data: {
            items: [
              { node_token: "child-1", obj_token: "doc-token-1", obj_type: "docx", title: "子页面1", url: "https://example.feishu.cn/wiki/child-1", has_child: false }
            ],
            has_more: true,
            page_token: "next-page"
          }
        });
      }

      expect(url).toContain("page_token=next-page");
      return jsonResponse({
        code: 0,
        msg: "success",
        data: {
          items: [
            { node_token: "child-2", obj_token: "doc-token-2", obj_type: "docx", title: "子页面2", url: "https://example.feishu.cn/wiki/child-2", has_child: false }
          ],
          has_more: false
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new FeishuClient(config);
    const children = await client.listWikiChildNodes("space-abc", "parent-node", "user-token");

    expect(children).toHaveLength(2);
    expect(children[0]).toMatchObject({ node_token: "child-1", title: "子页面1" });
    expect(children[1]).toMatchObject({ node_token: "child-2", title: "子页面2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}