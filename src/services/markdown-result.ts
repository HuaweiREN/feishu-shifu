import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentReference, TaskKind } from "../types.js";
import { getTaskKindLabel } from "./document-reference.js";

export const MAX_CARD_MARKDOWN_BYTES = 5000;

export interface TraversalMarkdownItem {
  reference: DocumentReference;
  answer: string;
}

export interface KbSearchItem {
  title: string;
  url: string;
  answer: string;
  isParent?: boolean;
}

export interface MarkdownResultFile {
  fileName: string;
  filePath: string;
}

export function buildTraversalMarkdown(params: { userRequest: string; items: TraversalMarkdownItem[] }): string {
  return [
    buildHeader("traverse", params.items.length, params.userRequest),
    ...params.items.map((item, index) => buildTraversalItem(index + 1, item))
  ].join("\n\n");
}

export function buildAssociationMarkdown(params: { userRequest: string; references: DocumentReference[]; answer: string }): string {
  return [
    buildHeader("associate", params.references.length, params.userRequest),
    "## 关联文档",
    params.references.map((reference, index) => `${index + 1}. ${reference.url}`).join("\n"),
    "## 综合回复",
    params.answer
  ].join("\n\n");
}

export function buildKbSearchMarkdown(params: { userRequest: string; items: KbSearchItem[] }): string {
  return [
    buildHeader("kb_search", params.items.length, params.userRequest),
    ...params.items.map((item, index) => buildKbSearchItem(index + 1, item))
  ].join("\n\n");
}

function buildKbSearchItem(index: number, item: KbSearchItem): string {
  const label = item.isParent ? "母页面" : "子页面";
  return [
    `## ${label} ${index}：${item.title}`,
    "",
    `- 原文链接：${item.url}`,
    "",
    "### DeepSeek 回复",
    "",
    item.answer
  ].join("\n");
}

export function getMarkdownFileDeliveryReasons(markdown: string): string[] {
  const reasons: string[] = [];
  if (Buffer.byteLength(markdown, "utf8") > MAX_CARD_MARKDOWN_BYTES) {
    reasons.push(`结果超过 ${MAX_CARD_MARKDOWN_BYTES} 字节`);
  }

  if (containsMarkdownTable(markdown)) {
    reasons.push("结果包含 Markdown 表格");
  }

  return reasons;
}

export function writeMarkdownResult(outputDir: string, markdown: string): MarkdownResultFile {
  mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `feishu-shifu-${timestamp}.md`;
  const filePath = join(outputDir, fileName);
  writeFileSync(filePath, markdown, "utf8");
  return { fileName, filePath };
}

function buildHeader(taskKind: TaskKind, documentCount: number, userRequest: string): string {
  return [
    "# 飞书师傅处理结果",
    "",
    `- 任务种类：${getTaskKindLabel(taskKind)}`,
    `- 文档数量：${documentCount}`,
    `- 生成时间：${new Date().toISOString()}`,
    "",
    "## 用户需求",
    "",
    userRequest
  ].join("\n");
}

function buildTraversalItem(index: number, item: TraversalMarkdownItem): string {
  return [
    `## 文档 ${index}`,
    "",
    `- 原文链接：${item.reference.url}`,
    "",
    "### DeepSeek 回复",
    "",
    item.answer
  ].join("\n");
}

function containsMarkdownTable(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index]?.trim() ?? "";
    const separator = lines[index + 1]?.trim() ?? "";
    if (header.includes("|") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator)) {
      return true;
    }
  }

  return false;
}