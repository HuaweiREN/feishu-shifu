import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { getMarkdownFileDeliveryReasons, MAX_CARD_MARKDOWN_BYTES } from "./markdown-result.js";

describe("getMarkdownFileDeliveryReasons", () => {
  it("requires file delivery when markdown is over the card byte limit", () => {
    expect(getMarkdownFileDeliveryReasons("x".repeat(MAX_CARD_MARKDOWN_BYTES + 1))).toContain(
      `结果超过 ${MAX_CARD_MARKDOWN_BYTES} 字节`
    );
  });

  it("uses UTF-8 bytes instead of JS string length for the card limit", () => {
    const markdown = "师".repeat(Math.floor(MAX_CARD_MARKDOWN_BYTES / Buffer.byteLength("师", "utf8")) + 1);

    expect(markdown.length).toBeLessThan(MAX_CARD_MARKDOWN_BYTES);
    expect(getMarkdownFileDeliveryReasons(markdown)).toContain(`结果超过 ${MAX_CARD_MARKDOWN_BYTES} 字节`);
  });

  it("requires file delivery when markdown contains a table", () => {
    expect(getMarkdownFileDeliveryReasons("| A | B |\n|---|---|\n| 1 | 2 |")).toContain("结果包含 Markdown 表格");
  });

  it("allows short markdown without tables in cards", () => {
    expect(getMarkdownFileDeliveryReasons("# Result\n\nNo table here.")).toEqual([]);
  });
});

describe("buildKbSearchMarkdown", () => {
  it("builds kb_search markdown with parent and child sections", async () => {
    const { buildKbSearchMarkdown } = await import("./markdown-result.js");
    const result = buildKbSearchMarkdown({
      userRequest: "请总结每个子页面的重点",
      items: [
        { title: "母页面", url: "https://example.feishu.cn/wiki/WIKI123", answer: "母页面总结", isParent: true },
        { title: "子页面1", url: "https://example.feishu.cn/wiki/child-1", answer: "子页面1总结" }
      ]
    });

    expect(result).toContain("任务种类：知识库检索");
    expect(result).toContain("母页面 1：母页面");
    expect(result).toContain("子页面 2：子页面1");
    expect(result).toContain("DeepSeek 回复");
    expect(result).toContain("母页面总结");
    expect(result).toContain("子页面1总结");
  });
});