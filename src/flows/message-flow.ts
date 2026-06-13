import type { DeepSeekClient } from "../services/deepseek-client.js";
import { buildResultCard } from "../services/feishu-card.js";
import type { FeishuClient } from "../services/feishu-client.js";
import { getTaskKindLabel, parseStandardDocumentRequest, STANDARD_REQUEST_FORMAT } from "../services/document-reference.js";
import {
  buildAssociationMarkdown,
  buildKbSearchMarkdown,
  buildTraversalMarkdown,
  getMarkdownFileDeliveryReasons,
  writeMarkdownResult
} from "../services/markdown-result.js";
import type { TokenStore } from "../stores/token-store.js";
import type { KbSearchItem } from "../services/markdown-result.js";
import type { DocumentReference, FeishuMessageEvent, FeishuMessageMention, FeishuTextMessage, TokenSet } from "../types.js";

const MESSAGE_DEDUP_TTL_MS = 30 * 60 * 1000;
const MAX_DEDUPED_MESSAGES = 1000;

export class MessageFlow {
  private readonly handledMessageIds = new Map<string, number>();
  private isBusy = false;

  constructor(
    private readonly feishu: FeishuClient,
    private readonly deepseek: DeepSeekClient,
    private readonly tokenStore: TokenStore,
    private readonly resultsDir = ".data/results"
  ) {}

  async handle(event: FeishuMessageEvent): Promise<void> {
    if (event.header?.event_type !== "im.message.receive_v1") {
      console.info("[feishu-shifu] ignored: wrong event_type", event.header?.event_type);
      return;
    }

    const message = event.event?.message;
    const messageId = message?.message_id;
    const userOpenId = event.event?.sender?.sender_id?.open_id;

    if (!messageId || !userOpenId || !message?.content) {
      console.info("[feishu-shifu] ignored: missing fields", { hasMessageId: !!messageId, hasUserOpenId: !!userOpenId, hasContent: !!message?.content });
      return;
    }

    const mentionCheck = await this.checkGroupMention(message);
    if (!mentionCheck.shouldHandle) {
      console.info("[feishu-shifu] ignored: group mention check failed", { chatType: message.chat_type, mentionsCount: message.mentions?.length ?? 0 });
      return;
    }

    const text = readTextContent(message.content, mentionCheck.botMentionKeys, mentionCheck.botOpenId);
    if (!text) {
      console.info("[feishu-shifu] ignored: empty text after parsing", { rawContentLength: message.content.length });
      return;
    }

    if (this.hasHandledMessage(messageId)) {
      console.info("[feishu-shifu] ignored: duplicate message", messageId);
      return;
    }

    const token = this.tokenStore.get(userOpenId) ?? (await this.tryRefreshToken(userOpenId));
    if (!token) {
      console.info("[feishu-shifu] no token, requesting re-auth for", userOpenId);
      await this.feishu.replyInteractiveCard(
        messageId,
        buildResultCard({
          title: "需要授权",
          body: "请先授权师傅以你的身份读取飞书文档，然后再次发送文档链接和需求。",
          actions: [
            {
              text: "授权访问文档",
              url: this.feishu.buildOAuthUrl(userOpenId)
            }
          ]
        })
      );
      return;
    }

    const parsedRequest = parseStandardDocumentRequest(text);
    if (!parsedRequest) {
      await this.feishu.replyInteractiveCard(
        messageId,
        buildResultCard({
          title: "需求格式不正确",
          body: `请按照标准格式发送需求：\n\n${STANDARD_REQUEST_FORMAT}`
        })
      );
      return;
    }

    if (this.isBusy) {
      await this.feishu.replyInteractiveCard(
        messageId,
        buildResultCard({
          title: "师傅正在忙",
          body: "当前有任务正在处理中，请等待上一个任务完成后再发送新请求。"
        })
      );
      return;
    }

    this.isBusy = true;

    const { documentReferences, taskKind, userRequest } = parsedRequest;
    const taskKindLabel = getTaskKindLabel(taskKind);

    const processingMessageId = await this.feishu.replyInteractiveCard(
      messageId,
      buildResultCard({
        title: "师傅开始处理",
        body: `已收到 ${documentReferences.length} 个文档和需求，将按“${taskKindLabel}”任务读取文档并调用 DeepSeek。`
      })
    );

    let markdown: string;
    try {
      try {
        markdown =
          taskKind === "associate"
          ? await this.processAssociation(processingMessageId, documentReferences, userRequest, token.accessToken)
          : taskKind === "kb_search"
            ? await this.processKbSearch(processingMessageId, documentReferences, userRequest, token.accessToken)
            : await this.processTraversal(processingMessageId, documentReferences, userRequest, token.accessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      await this.feishu.updateInteractiveCard(
        processingMessageId,
        buildResultCard({
          title: "师傅处理失败",
          body: `处理文档时遇到问题：${message}`
        })
      );
      return;
    }

    const resultFile = writeMarkdownResult(this.resultsDir, markdown);
    const fileDeliveryReasons = getMarkdownFileDeliveryReasons(markdown);
    if (fileDeliveryReasons.length > 0) {
      try {
        await this.feishu.replyMarkdownFile(messageId, resultFile.fileName, markdown);
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        await this.feishu.updateInteractiveCard(
          processingMessageId,
          buildResultCard({
            title: "师傅处理结果",
            body: [
              "已完成“" + taskKindLabel + "”任务，处理 " + documentReferences.length + " 个文档，但 Markdown 文件发送失败：" + message,
              "",
              "结果已保存到本地文件：" + resultFile.fileName,
              "",
              "如果错误提示缺少 im:resource:upload 或 im:resource，请在飞书开放平台开通对应应用身份权限后重试。"
            ].join("\n")
          })
        );
        return;
      }
      await this.feishu.updateInteractiveCard(
        processingMessageId,
        buildResultCard({
          title: "师傅处理结果",
          body: `已完成“${taskKindLabel}”任务，处理 ${documentReferences.length} 个文档。${fileDeliveryReasons.join("，")}，结果已通过 Markdown 文件发送。\n\n文件：${resultFile.fileName}`
        })
      );
      return;
    }

    await this.feishu.updateInteractiveCard(
      processingMessageId,
      buildResultCard({
        title: "师傅处理结果",
        body: markdown
      })
    );
    } finally {
      this.isBusy = false;
    }
  }

  private async processTraversal(
    processingMessageId: string,
    documentReferences: DocumentReference[],
    userRequest: string,
    userAccessToken: string
  ): Promise<string> {
    const items = [];
    for (const [index, reference] of documentReferences.entries()) {
      await this.updateProcessingStatus(
        processingMessageId,
        `遍历任务进行中：正在读取第 ${index + 1}/${documentReferences.length} 个文档。`
      );
      const documentContent = await this.feishu.readDocumentContent(reference, userAccessToken);
      await this.updateProcessingStatus(
        processingMessageId,
        `遍历任务进行中：正在调用 DeepSeek 处理第 ${index + 1}/${documentReferences.length} 个文档。`
      );
      const answer = await this.deepseek.answerFromDocument({
        userRequest,
        documentContent,
        onChunkProgress: (current, total) => {
          void this.updateProcessingStatus(
            processingMessageId,
            `遍历任务进行中：第 ${index + 1}/${documentReferences.length} 个文档分块处理中（第 ${current}/${total} 块）。`
          );
        }
      });
      items.push({ reference, answer });
    }

    return buildTraversalMarkdown({ userRequest, items });
  }

  private async processAssociation(
    processingMessageId: string,
    documentReferences: DocumentReference[],
    userRequest: string,
    userAccessToken: string
  ): Promise<string> {
    const documents = [];
    for (const [index, reference] of documentReferences.entries()) {
      await this.updateProcessingStatus(
        processingMessageId,
        `关联任务进行中：正在读取第 ${index + 1}/${documentReferences.length} 个文档。`
      );
      documents.push({
        reference,
        content: await this.feishu.readDocumentContent(reference, userAccessToken)
      });
    }

    await this.updateProcessingStatus(
      processingMessageId,
      `关联任务进行中：已读取 ${documentReferences.length} 个文档，正在一次性调用 DeepSeek。`
    );
    const answer = await this.deepseek.answerFromDocuments({
      userRequest,
      documents
    });

    return buildAssociationMarkdown({
      userRequest,
      references: documentReferences,
      answer
    });
  }

  private async processKbSearch(
    processingMessageId: string,
    documentReferences: DocumentReference[],
    userRequest: string,
    userAccessToken: string
  ): Promise<string> {
    if (documentReferences.length !== 1 || documentReferences[0].kind !== "wiki") {
      throw new Error("知识库检索需要提供一个 wiki 链接。");
    }

    const wikiRef = documentReferences[0];

    await this.updateProcessingStatus(processingMessageId, "知识库检索进行中：正在解析母页面。");
    const wikiNode = await this.feishu.getWikiNodeMetadata(wikiRef.token, userAccessToken);
    console.info(`[feishu-shifu] parent wiki resolved: "${wikiNode.title}", spaceId=${wikiNode.spaceId}, nodeToken=${wikiNode.nodeToken}`);

    await this.updateProcessingStatus(processingMessageId, "知识库检索进行中：正在读取母页面内容。");
    const parentDocRef: DocumentReference = {
      kind: mapObjTypeToDocKind(wikiNode.objType),
      token: wikiNode.token,
      url: wikiNode.url
    };
    const parentContent = await this.feishu.readDocumentContent(parentDocRef, userAccessToken);
    console.info(`[feishu-shifu] parent content read: ~${Math.round(parentContent.length / 1000)}k chars`);

    await this.updateProcessingStatus(processingMessageId, "知识库检索进行中：正在调用 DeepSeek 分析母页面。");
    const parentAnswer = await this.deepseek.answerFromDocument({
      userRequest,
      documentContent: parentContent,
      onChunkProgress: (current, total) => {
        void this.updateProcessingStatus(processingMessageId, `知识库检索进行中：母页面分块处理中（第 ${current}/${total} 块）。`);
      }
    });
    console.info(`[feishu-shifu] parent AI done, answer ~${Math.round(parentAnswer.length / 1000)}k chars`);

    await this.updateProcessingStatus(processingMessageId, "知识库检索进行中：正在获取子页面列表。");
    const childNodes = await this.feishu.listWikiChildNodes(wikiNode.spaceId!, wikiNode.nodeToken!, userAccessToken);
    console.info(`[feishu-shifu] child nodes listed: ${childNodes.length} total, ${childNodes.filter((c) => c.obj_token && c.obj_type).length} valid`);

    const items: KbSearchItem[] = [
      {
        title: wikiNode.title,
        url: wikiNode.url,
        answer: parentAnswer,
        isParent: true
      }
    ];

    // Pre-populate skipped nodes (use index as unique fallback key)
    const resultByToken = new Map<string, KbSearchItem>();
    let skipIndex = 0;
    for (const child of childNodes) {
      if (!child.obj_token || !child.obj_type) {
        const key = child.node_token ?? `__skipped_${skipIndex}`;
        resultByToken.set(key, {
          title: child.title ?? "",
          url: child.url ?? "",
          answer: "_此节点不是可读取的内容页面（可能为文件夹或快捷方式），已跳过。_",
          isParent: false
        });
        skipIndex += 1;
      }
    }

    const validChildren = childNodes.filter((child) => child.obj_token && child.obj_type);
    const total = validChildren.length;

    // Phase 1: read child page contents sequentially (avoid Feishu rate limit)
    await this.updateProcessingStatus(processingMessageId, `知识库检索进行中：正在串行读取 ${total} 个子页面。`);
    const contentByToken = new Map<string, { content: string; error?: string }>();
    for (const [index, child] of validChildren.entries()) {
      const childTitle = child.title ?? "(无标题)";
      const startTime = Date.now();
      try {
        const childDocRef: DocumentReference = {
          kind: mapObjTypeToDocKind(child.obj_type!),
          token: child.obj_token!,
          url: child.url ?? ""
        };
        const content = await this.feishu.readDocumentContent(childDocRef, userAccessToken);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        contentByToken.set(child.obj_token!, { content });
        console.info(`[feishu-shifu] read ${index + 1}/${total} "${childTitle}" done in ${elapsed}s, content ~${Math.round(content.length / 1000)}k chars`);
        // rate-limit throttle: wait 1s between Feishu API reads
        if (index < validChildren.length - 1) {
          await sleep(1000);
        }
      } catch (error) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[feishu-shifu] read ${index + 1}/${total} "${childTitle}" FAILED after ${elapsed}s: ${message}`);
        contentByToken.set(child.obj_token!, { content: "", error: message });
      }
      if ((index + 1) % 5 === 0 || index + 1 === total) {
        await this.updateProcessingStatus(
          processingMessageId,
          `知识库检索进行中：已读取 ${index + 1}/${total} 个子页面。`
        );
      }
    }

    // Phase 2: DeepSeek calls (serial to avoid connection-level fetch failures)
    const AI_CONCURRENCY = 1;
    await this.updateProcessingStatus(processingMessageId, `知识库检索进行中：正在调用 DeepSeek 处理 ${total} 个子页面（并发数 ${AI_CONCURRENCY}）。`);
    let aiCompleted = 0;
    await asyncPool(AI_CONCURRENCY, validChildren, async (child) => {
      const childTitle = child.title ?? "(无标题)";
      const startTime = Date.now();
      const entry = contentByToken.get(child.obj_token!);
      if (entry?.error) {
        aiCompleted += 1;
        console.info(`[feishu-shifu] AI ${aiCompleted}/${total} "${childTitle}" SKIPPED (read error)`);
        resultByToken.set(child.obj_token!, {
          title: child.title ?? "",
          url: child.url ?? "",
          answer: `_读取失败：${entry.error}_`
        });
      } else if (!entry?.content) {
        aiCompleted += 1;
        console.info(`[feishu-shifu] AI ${aiCompleted}/${total} "${childTitle}" SKIPPED (empty content)`);
        resultByToken.set(child.obj_token!, {
          title: child.title ?? "",
          url: child.url ?? "",
          answer: "_读取失败：文档内容为空。_"
        });
      } else {
        try {
          console.info(`[feishu-shifu] AI ${aiCompleted + 1}/${total} "${childTitle}" starting (content ~${Math.round(entry.content.length / 1000)}k chars)`);
          const answer = await this.deepseek.answerFromDocument({
            userRequest,
            documentContent: entry.content
          });
          aiCompleted += 1;
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.info(`[feishu-shifu] AI ${aiCompleted}/${total} "${childTitle}" done in ${elapsed}s, answer ~${Math.round(answer.length / 1000)}k chars`);
          resultByToken.set(child.obj_token!, {
            title: child.title ?? "",
            url: child.url ?? "",
            answer
          });
        } catch (error) {
          aiCompleted += 1;
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[feishu-shifu] AI ${aiCompleted}/${total} "${childTitle}" FAILED after ${elapsed}s: ${message}`);
          resultByToken.set(child.obj_token!, {
            title: child.title ?? "",
            url: child.url ?? "",
            answer: `_处理失败：${message}_`
          });
        }
      }
      if (aiCompleted % 3 === 0 || aiCompleted === total) {
        await this.updateProcessingStatus(
          processingMessageId,
          `知识库检索进行中：DeepSeek 处理已完成 ${aiCompleted}/${total} 个子页面。`
        );
      }
    });

    // Assemble results in original order
    let lookupSkipIndex = 0;
    for (const child of childNodes) {
      const key = child.obj_token ?? child.node_token ?? `__skipped_${lookupSkipIndex}`;
      if (!child.obj_token && !child.obj_type) {
        lookupSkipIndex += 1;
      }
      const result = resultByToken.get(key);
      if (result) {
        items.push(result);
      }
    }

    return buildKbSearchMarkdown({ userRequest, items });
  }

  private async updateProcessingStatus(messageId: string, body: string): Promise<void> {
    try {
      await this.feishu.updateInteractiveCard(
        messageId,
        buildResultCard({
          title: "师傅处理中",
          body
        })
      );
    } catch (error) {
      console.warn("[feishu-shifu] Failed to update processing card (non-fatal).", error instanceof Error ? error.message : error);
    }
  }

  private async checkGroupMention(message: NonNullable<NonNullable<FeishuMessageEvent["event"]>["message"]>): Promise<GroupMentionCheck> {
    if (!isGroupChat(message.chat_type)) {
      return { shouldHandle: true, botMentionKeys: [] };
    }

    const mentions = message.mentions ?? [];
    if (mentions.length === 0) {
      return { shouldHandle: false, botMentionKeys: [] };
    }

    try {
      const botOpenId = await this.feishu.getBotOpenId();
      const botMentionKeys = getMentionKeysForOpenId(mentions, botOpenId);
      return { shouldHandle: botMentionKeys.length > 0, botMentionKeys, botOpenId };
    } catch (error) {
      console.error("[feishu-shifu] CRITICAL: cannot resolve bot open_id — ALL group messages will be ignored. Check FEISHU_APP_ID/FEISHU_APP_SECRET and bot:info API permissions.", error);
      return { shouldHandle: false, botMentionKeys: [] };
    }
  }

  private hasHandledMessage(messageId: string): boolean {
    const now = Date.now();
    const handledAt = this.handledMessageIds.get(messageId);
    if (handledAt !== undefined && now - handledAt < MESSAGE_DEDUP_TTL_MS) {
      return true;
    }

    this.handledMessageIds.set(messageId, now);
    this.trimHandledMessages(now);
    return false;
  }

  private async tryRefreshToken(userOpenId: string): Promise<TokenSet | undefined> {
    const rawToken = this.tokenStore.getRaw(userOpenId);
    if (!rawToken?.refreshToken) {
      return undefined;
    }

    try {
      const newToken = await this.feishu.refreshUserAccessToken(rawToken.refreshToken);
      this.tokenStore.set(userOpenId, newToken);
      return newToken;
    } catch (error) {
      console.warn("Failed to refresh user access token; clearing token and falling back to re-auth.", error);
      this.tokenStore.delete(userOpenId);
      return undefined;
    }
  }

  private trimHandledMessages(now: number): void {
    for (const [messageId, handledAt] of this.handledMessageIds) {
      if (now - handledAt >= MESSAGE_DEDUP_TTL_MS) {
        this.handledMessageIds.delete(messageId);
      }
    }

    while (this.handledMessageIds.size > MAX_DEDUPED_MESSAGES) {
      const oldestMessageId = this.handledMessageIds.keys().next().value;
      if (typeof oldestMessageId !== "string") {
        return;
      }
      this.handledMessageIds.delete(oldestMessageId);
    }
  }
}

interface GroupMentionCheck {
  shouldHandle: boolean;
  botMentionKeys: string[];
  botOpenId?: string;
}

function isGroupChat(chatType: string | undefined): boolean {
  return chatType === "group";
}

function getMentionKeysForOpenId(mentions: FeishuMessageMention[], openId: string): string[] {
  return mentions
    .filter((mention) => mention.id?.open_id === openId)
    .map((mention) => mention.key)
    .filter((key): key is string => Boolean(key));
}

function readTextContent(rawContent: string | undefined, botMentionKeys: string[] = [], botOpenId?: string): string | undefined {
  if (!rawContent) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawContent) as FeishuTextMessage;
    const text = parsed.text?.trim();
    return text ? stripBotMentionText(text, botMentionKeys, botOpenId) : undefined;
  } catch {
    return undefined;
  }
}

function stripBotMentionText(text: string, botMentionKeys: string[], botOpenId?: string): string {
  let stripped = text;
  for (const key of [...botMentionKeys].sort((left, right) => right.length - left.length)) {
    stripped = stripped.replace(new RegExp(`\\s?${escapeRegExp(key)}\\s?`, "g"), " ");
  }

  if (botOpenId) {
    stripped = stripped.replace(new RegExp(`\\s?<at\\s+[^>]*(?:user_id|open_id)="${escapeRegExp(botOpenId)}"[^>]*>.*?<\\/at>\\s?`, "g"), " ");
  }

  return stripped.replace(/[ \t]{2,}/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function asyncPool<T>(
  concurrency: number,
  items: T[],
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  async function worker(): Promise<void> {
    let next: T | undefined;
    while ((next = queue.shift()) !== undefined) {
      await fn(next);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapObjTypeToDocKind(objType: string): DocumentReference["kind"] {
  if (objType === "docx") return "docx";
  if (objType === "sheet") return "sheet";
  if (objType === "bitable") return "bitable";
  if (objType === "doc") {
    throw new Error("不支持的传统文档类型（doc），请使用新版 docx 文档。");
  }
  throw new Error(`不支持的 wiki 节点类型：${objType}`);
}
