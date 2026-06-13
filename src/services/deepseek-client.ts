import type { AppConfig } from "../config.js";
import type { DocumentReference } from "../types.js";
import { fetchWithTimeout } from "./fetch-timeout.js";

interface DeepSeekMessage {
  role: "system" | "user";
  content: string;
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export class DeepSeekClient {
  constructor(private readonly config: AppConfig) {}

  async answerFromDocument(params: { userRequest: string; documentContent: string; onChunkProgress?: (chunkIndex: number, chunkCount: number) => void }): Promise<string> {
    const chunks = splitDocumentContent(params.documentContent, this.config.DEEPSEEK_DOCUMENT_CHUNK_SIZE);
    if (chunks.length > 1) {
      const chunkAnswers: string[] = [];
      for (const [index, chunk] of chunks.entries()) {
        params.onChunkProgress?.(index + 1, chunks.length);
        chunkAnswers.push(
          await this.answerFromDocumentChunk({
            userRequest: params.userRequest,
            chunk,
            chunkIndex: index + 1,
            chunkCount: chunks.length
          })
        );
      }

      return [
        `> 文档较长，已分 ${chunks.length} 块调用 DeepSeek；以下为各分块反馈的拼接结果。`,
        ...chunkAnswers.map((answer, index) => `## 分块 ${index + 1}/${chunks.length}\n\n${answer}`)
      ].join("\n\n");
    }

    const messages: DeepSeekMessage[] = [
      {
        role: "system",
        content: "You are Feishu Shifu. Answer the user's request using only the provided Feishu document content. If the document does not contain enough information, say what is missing. Return Markdown."
      },
      {
        role: "user",
        content: `User request:\n${params.userRequest}\n\nFeishu document content:\n${params.documentContent}`
      }
    ];

    return this.complete(messages);
  }

  async answerFromDocuments(params: { userRequest: string; documents: Array<{ reference: DocumentReference; content: string }>; onChunkProgress?: (chunkIndex: number, chunkCount: number) => void }): Promise<string> {
    const documents = await Promise.all(
      params.documents.map(async (document) => ({
        reference: document.reference,
        content:
          document.content.length > this.config.DEEPSEEK_DOCUMENT_CHUNK_SIZE
            ? await this.answerFromDocument({ userRequest: params.userRequest, documentContent: document.content, onChunkProgress: params.onChunkProgress })
            : document.content
      }))
    );

    const documentBlocks = documents
      .map(
        (document, index) =>
          `Document ${index + 1}\nURL: ${document.reference.url}\nType: ${document.reference.kind}\nContent:\n${document.content}`
      )
      .join("\n\n---\n\n");

    const messages: DeepSeekMessage[] = [
      {
        role: "system",
        content: "You are Feishu Shifu. Analyze all provided Feishu documents together and answer the user's request using only those documents. Compare, connect, and reconcile information across documents when useful. If the documents do not contain enough information, say what is missing. Return Markdown."
      },
      {
        role: "user",
        content: `User request:\n${params.userRequest}\n\nFeishu documents:\n${documentBlocks}`
      }
    ];

    return this.complete(messages);
  }

  private async answerFromDocumentChunk(params: {
    userRequest: string;
    chunk: string;
    chunkIndex: number;
    chunkCount: number;
  }): Promise<string> {
    const messages: DeepSeekMessage[] = [
      {
        role: "system",
        content: "You are Feishu Shifu. Answer the user's request using only this chunk of a longer Feishu document. If this chunk does not contain enough information, say what is missing in this chunk. Return Markdown."
      },
      {
        role: "user",
        content: `User request:\n${params.userRequest}\n\nDocument chunk ${params.chunkIndex}/${params.chunkCount}:\n${params.chunk}`
      }
    ];

    return this.complete(messages);
  }

  private async complete(messages: DeepSeekMessage[]): Promise<string> {
    const contentLength = messages.reduce((sum, m) => sum + m.content.length, 0);
    console.info(`[feishu-shifu] DeepSeek request start (content ~${Math.round(contentLength / 1000)}k chars)`);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const startTime = Date.now();
      let response: Response;
      try {
        response = await fetchWithTimeout(
          `${this.config.DEEPSEEK_BASE_URL}/chat/completions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.config.DEEPSEEK_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: this.config.DEEPSEEK_MODEL,
              messages,
              temperature: 0.2
            })
          },
          this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
          "DeepSeek request"
        );
      } catch (error) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[feishu-shifu] DeepSeek request attempt ${attempt} failed after ${elapsed}s: ${message}`);
        if (attempt < 2 && message.includes("fetch failed")) {
          await sleep(2000);
          continue;
        }
        throw error;
      }

      if (!response.ok) {
        const body = await response.text();
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.error(`[feishu-shifu] DeepSeek request HTTP ${response.status} after ${elapsed}s: ${body.slice(0, 200)}`);
        if (body.includes("Content Exists Risk")) {
          throw new Error("DeepSeek 内容安全过滤：文档包含敏感内容，DeepSeek 拒绝处理。请联系文档作者检查内容。");
        }
        throw new Error(`DeepSeek request failed: ${response.status} ${body}`);
      }

      const data = (await response.json()) as DeepSeekResponse;
      const answer = data.choices?.[0]?.message?.content?.trim();
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.info(`[feishu-shifu] DeepSeek request done in ${elapsed}s, answer ~${Math.round((answer?.length ?? 0) / 1000)}k chars`);

      if (!answer) {
        throw new Error("DeepSeek returned an empty answer.");
      }

      return answer;
    }

    throw new Error("DeepSeek request failed after retries.");
  }
}

export function splitDocumentContent(content: string, chunkSize: number): string[] {
  const normalizedChunkSize = Math.max(1, chunkSize);
  if (content.length <= normalizedChunkSize) {
    return [content];
  }

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of content.split(/\n{2,}/)) {
    const trimmedParagraph = paragraph.trim();
    if (!trimmedParagraph) {
      continue;
    }

    if (trimmedParagraph.length > normalizedChunkSize) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitLongParagraph(trimmedParagraph, normalizedChunkSize));
      continue;
    }

    const next = current ? `${current}\n\n${trimmedParagraph}` : trimmedParagraph;
    if (next.length > normalizedChunkSize) {
      chunks.push(current);
      current = trimmedParagraph;
      continue;
    }

    current = next;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [content.slice(0, normalizedChunkSize)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitLongParagraph(paragraph: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < paragraph.length; index += chunkSize) {
    chunks.push(paragraph.slice(index, index + chunkSize));
  }

  return chunks;
}
