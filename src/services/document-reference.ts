import type { DocumentReference, TaskKind } from "../types.js";

export const STANDARD_REQUEST_FORMAT = "上工了，师傅\n任务种类：遍历（或 关联、知识库检索）\n链接：\nhttps://example.feishu.cn/docx/xxxx（知识库检索请用 wiki 链接）\n需求：\n请总结文档重点，并列出行动项。";

const OPENING_PHRASE = "上工了，师傅";
const TASK_KIND_HEADING = "任务种类：";
const DOCUMENT_REGEX = /https?:\/\/[^\s]+\/(docx|docs|wiki|sheets|base)\/([A-Za-z0-9_-]+)[^\s]*/g;

export function extractDocumentReference(input: string): DocumentReference | undefined {
  return extractDocumentReferences(input)[0];
}

export function extractDocumentReferences(input: string): DocumentReference[] {
  const references: DocumentReference[] = [];
  const seen = new Set<string>();

  for (const match of input.matchAll(DOCUMENT_REGEX)) {
    const kind = normalizeDocumentKind(match[1]);
    const token = match[2];
    const url = match[0];
    if (!kind || !token) {
      continue;
    }

    const key = `${kind}:${token}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    references.push({ kind, token, url });
  }

  return references;
}

function normalizeDocumentKind(rawKind: string | undefined): DocumentReference["kind"] | undefined {
  if (rawKind === "sheets") {
    return "sheet";
  }

  if (rawKind === "base") {
    return "bitable";
  }

  return rawKind as DocumentReference["kind"] | undefined;
}

export interface StandardDocumentRequest {
  taskKind: TaskKind;
  documentReferences: DocumentReference[];
  userRequest: string;
}

export function parseStandardDocumentRequest(input: string): StandardDocumentRequest | undefined {
  const normalized = input.replace(/\r\n/g, "\n").trim();
  const bodyMatch = normalized.match(new RegExp(`^${OPENING_PHRASE}\\s*\\n([\\s\\S]+)$`));
  if (!bodyMatch?.[1]) {
    return undefined;
  }

  const parsedTask = parseTaskKindSection(bodyMatch[1]);
  if (!parsedTask) {
    return undefined;
  }

  const match = parsedTask.body.match(/^链接：\s*\n([\s\S]+?)\n需求：\s*\n([\s\S]+)$/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  const documentReferences = extractDocumentReferences(match[1]);
  const userRequest = match[2].trim();
  if (documentReferences.length === 0 || !userRequest) {
    return undefined;
  }

  return {
    taskKind: parsedTask.taskKind,
    documentReferences,
    userRequest
  };
}

export function getTaskKindLabel(taskKind: TaskKind): "遍历" | "关联" | "知识库检索" {
  if (taskKind === "associate") return "关联";
  if (taskKind === "kb_search") return "知识库检索";
  return "遍历";
}

function parseTaskKindSection(input: string): { taskKind: TaskKind; body: string } | undefined {
  const body = input.trimStart();
  if (!body.startsWith(TASK_KIND_HEADING)) {
    return { taskKind: "traverse", body };
  }

  const afterHeading = body.slice(TASK_KIND_HEADING.length);
  const firstLineBreak = afterHeading.indexOf("\n");
  if (firstLineBreak === -1) {
    return undefined;
  }

  const sameLineValue = afterHeading.slice(0, firstLineBreak).trim();
  if (sameLineValue) {
    const taskKind = parseTaskKindValue(sameLineValue);
    return taskKind ? { taskKind, body: afterHeading.slice(firstLineBreak + 1).trimStart() } : undefined;
  }

  const remaining = afterHeading.slice(firstLineBreak + 1).trimStart();
  const secondLineBreak = remaining.indexOf("\n");
  if (secondLineBreak === -1) {
    return undefined;
  }

  const nextLineValue = remaining.slice(0, secondLineBreak).trim();
  const taskKind = parseTaskKindValue(nextLineValue);
  return taskKind ? { taskKind, body: remaining.slice(secondLineBreak + 1).trimStart() } : undefined;
}

function parseTaskKindValue(value: string): TaskKind | undefined {
  if (value === "遍历") {
    return "traverse";
  }

  if (value === "关联") {
    return "associate";
  }

  if (value === "知识库检索") {
    return "kb_search";
  }

  return undefined;
}
