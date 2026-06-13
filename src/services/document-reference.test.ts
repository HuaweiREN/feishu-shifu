import { describe, expect, it } from "vitest";
import { extractDocumentReference, extractDocumentReferences, parseStandardDocumentRequest } from "./document-reference.js";

describe("extractDocumentReference", () => {
  it("extracts docx links", () => {
    expect(extractDocumentReference("请总结 https://example.feishu.cn/docx/ABC123?from=chat 并列出风险")).toMatchObject({
      kind: "docx",
      token: "ABC123",
      url: "https://example.feishu.cn/docx/ABC123?from=chat"
    });
  });

  it("extracts legacy docs links", () => {
    expect(extractDocumentReference("https://example.feishu.cn/docs/DOCS123#heading=h1")).toMatchObject({
      kind: "docs",
      token: "DOCS123",
      url: "https://example.feishu.cn/docs/DOCS123#heading=h1"
    });
  });

  it("extracts wiki links", () => {
    expect(extractDocumentReference("请看 https://example.feishu.cn/wiki/WIKI123")).toMatchObject({
      kind: "wiki",
      token: "WIKI123"
    });
  });

  it("extracts sheet links", () => {
    expect(extractDocumentReference("https://example.feishu.cn/sheets/SHEET123?sheet=abc")).toMatchObject({
      kind: "sheet",
      token: "SHEET123"
    });
  });

  it("extracts bitable base links", () => {
    expect(extractDocumentReference("https://example.feishu.cn/base/BASE123?table=tbl123")).toMatchObject({
      kind: "bitable",
      token: "BASE123"
    });
  });

  it("returns undefined when no document link exists", () => {
    expect(extractDocumentReference("hello")).toBeUndefined();
  });

  it("extracts multiple document links in input order", () => {
    expect(
      extractDocumentReferences("https://example.feishu.cn/docx/ABC123\nhttps://example.feishu.cn/wiki/WIKI123")
    ).toMatchObject([
      {
        kind: "docx",
        token: "ABC123"
      },
      {
        kind: "wiki",
        token: "WIKI123"
      }
    ]);
  });
});

describe("parseStandardDocumentRequest", () => {
  it("parses standard requests with one link and a user request", () => {
    expect(
      parseStandardDocumentRequest("上工了，师傅\n链接：\nhttps://example.feishu.cn/docx/ABC123\n需求：\n请总结文档重点")
    ).toMatchObject({
      taskKind: "traverse",
      documentReferences: [
        {
          kind: "docx",
          token: "ABC123",
          url: "https://example.feishu.cn/docx/ABC123"
        }
      ],
      userRequest: "请总结文档重点"
    });
  });

  it("parses one-line task kind fields", () => {
    expect(
      parseStandardDocumentRequest("上工了，师傅\n任务种类：关联\n链接：\nhttps://example.feishu.cn/docx/ABC123\n需求：\n请找出关联风险")
    ).toMatchObject({
      taskKind: "associate",
      documentReferences: [
        {
          kind: "docx",
          token: "ABC123"
        }
      ],
      userRequest: "请找出关联风险"
    });
  });

  it("parses multi-line task kind fields", () => {
    expect(
      parseStandardDocumentRequest("上工了，师傅\n任务种类：\n遍历\n链接：\nhttps://example.feishu.cn/docx/ABC123\n需求：\n请总结文档重点")
    ).toMatchObject({
      taskKind: "traverse"
    });
  });

  it("parses standard requests with multiple link lines", () => {
    expect(
      parseStandardDocumentRequest("上工了，师傅\n链接：\n备注\nhttps://example.feishu.cn/wiki/WIKI123\nhttps://example.feishu.cn/docx/ABC123\n需求：\n请列出风险")
    ).toMatchObject({
      documentReferences: [
        {
          kind: "wiki",
          token: "WIKI123"
        },
        {
          kind: "docx",
          token: "ABC123"
        }
      ],
      userRequest: "请列出风险"
    });
  });

  it("rejects messages without the standard headings", () => {
    expect(parseStandardDocumentRequest("请总结 https://example.feishu.cn/docx/ABC123")).toBeUndefined();
  });

  it("rejects standard headings without the required opening phrase", () => {
    expect(parseStandardDocumentRequest("链接：\nhttps://example.feishu.cn/docx/ABC123\n需求：\n请总结文档重点")).toBeUndefined();
  });

  it("rejects unsupported task kinds", () => {
    expect(parseStandardDocumentRequest("上工了，师傅\n任务种类：其他\n链接：\nhttps://example.feishu.cn/docx/ABC123\n需求：\n请总结文档重点")).toBeUndefined();
  });

  it("rejects standard messages without a request", () => {
    expect(parseStandardDocumentRequest("上工了，师傅\n链接：\nhttps://example.feishu.cn/docx/ABC123\n需求：\n   ")).toBeUndefined();
  });

  it("parses kb_search task kind (same line)", () => {
    expect(
      parseStandardDocumentRequest("上工了，师傅\n任务种类：知识库检索\n链接：\nhttps://example.feishu.cn/wiki/WIKI123\n需求：\n请总结每个子页面的重点")
    ).toMatchObject({
      taskKind: "kb_search",
      documentReferences: [{ kind: "wiki", token: "WIKI123" }],
      userRequest: "请总结每个子页面的重点"
    });
  });

  it("parses kb_search task kind (next line)", () => {
    expect(
      parseStandardDocumentRequest("上工了，师傅\n任务种类：\n知识库检索\n链接：\nhttps://example.feishu.cn/wiki/WIKI123\n需求：\n请总结每个子页面的重点")
    ).toMatchObject({
      taskKind: "kb_search"
    });
  });
});
