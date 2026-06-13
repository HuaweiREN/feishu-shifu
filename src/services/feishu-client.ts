import type { AppConfig } from "../config.js";
import type { DocumentReference, TokenSet } from "../types.js";
import { fetchWithTimeout } from "./fetch-timeout.js";

interface FeishuResponse<T> {
  code: number;
  msg?: string;
  data?: T;
}

interface TenantAccessTokenData {
  tenant_access_token: string;
  expire?: number;
}

interface TenantAccessTokenResponse extends FeishuResponse<unknown>, TenantAccessTokenData {}

interface UserAccessTokenData {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface WikiNodeData {
  node?: {
    obj_token?: string;
    obj_type?: string;
    space_id?: string;
    node_token?: string;
    parent_node_token?: string;
    has_child?: boolean;
    title?: string;
    url?: string;
  };
}

interface ResolvedWikiNode {
  token: string;
  objType: string;
  spaceId?: string;
  nodeToken?: string;
  title: string;
  url: string;
  hasChild?: boolean;
}

interface WikiChildListData {
  items?: WikiChildNodeItem[];
  has_more?: boolean;
  page_token?: string;
}

export interface WikiChildNodeItem {
  node_token?: string;
  obj_token?: string;
  obj_type?: string;
  title?: string;
  url?: string;
  has_child?: boolean;
}

interface DocumentContentData {
  content?: string;
}

interface DocxBlocksData {
  items?: DocxBlock[];
  has_more?: boolean;
  page_token?: string;
}

interface DocxBlock extends Record<string, unknown> {
  block_id?: string;
  block_type?: number;
  parent_id?: string;
  children?: unknown;
  text?: unknown;
  table?: unknown;
  table_cell?: unknown;
  sheet?: unknown;
  bitable?: unknown;
  spreadsheet?: unknown;
  base?: unknown;
}

interface DocxEmbeddedResource {
  kind: "sheet" | "bitable";
  token: string;
}

interface SheetData {
  sheets?: Array<{
    sheet_id?: string;
    title?: string;
  }>;
}

interface SheetValuesData {
  valueRange?: {
    values?: unknown[][];
  };
}

interface BitableTableData {
  items?: Array<{
    table_id?: string;
    name?: string;
  }>;
  has_more?: boolean;
  page_token?: string;
}

interface BitableRecordData {
  items?: Array<{
    fields?: Record<string, unknown>;
  }>;
  has_more?: boolean;
  page_token?: string;
}

interface MessageResponseData {
  message_id?: string;
}

interface FileUploadData {
  file_key?: string;
}

interface BotInfoData {
  bot?: {
    open_id?: string;
  };
}

interface BotInfoResponse extends FeishuResponse<BotInfoData>, BotInfoData {}

export class FeishuClient {
  private tenantToken?: { value: string; expiresAt: number };
  private botOpenId?: string;

  constructor(private readonly config: AppConfig) {}

  buildOAuthUrl(userOpenId: string): string {
    if (!this.config.PUBLIC_BASE_URL) {
      throw new Error("PUBLIC_BASE_URL is required before starting OAuth document authorization.");
    }

    const redirectUri = `${this.config.PUBLIC_BASE_URL}/feishu/oauth/callback`;
    const params = new URLSearchParams({
      app_id: this.config.FEISHU_APP_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      state: userOpenId
    });

    if (this.config.FEISHU_OAUTH_SCOPES.trim()) {
      params.set("scope", this.config.FEISHU_OAUTH_SCOPES.trim());
    }

    return `https://open.feishu.cn/open-apis/authen/v1/authorize?${params.toString()}`;
  }

  async exchangeOAuthCode(code: string): Promise<TokenSet> {
    const tenantToken = await this.getTenantAccessToken();
    const response = await fetchWithTimeout(
      "https://open.feishu.cn/open-apis/authen/v1/access_token",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code
        })
      },
      this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
      "Feishu exchange OAuth code"
    );

    const data = await parseFeishuResponse<UserAccessTokenData>(response, "exchange OAuth code");
    if (!data.access_token) {
      throw new Error("Feishu exchange OAuth code response did not include access_token.");
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined
    };
  }

  async refreshUserAccessToken(refreshToken: string): Promise<TokenSet> {
    const tenantToken = await this.getTenantAccessToken();
    const response = await fetchWithTimeout(
      "https://open.feishu.cn/open-apis/authen/v1/refresh_access_token",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      },
      this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
      "Feishu refresh user access token"
    );

    const data = await parseFeishuResponse<UserAccessTokenData>(response, "refresh user access token");
    if (!data.access_token) {
      throw new Error("Feishu refresh user access token response did not include access_token.");
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined
    };
  }

  async replyInteractiveCard(messageId: string, card: unknown): Promise<string> {
    const tenantToken = await this.getTenantAccessToken();
    const response = await fetchWithTimeout(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          msg_type: "interactive",
          content: JSON.stringify(card)
        })
      },
      this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
      "Feishu reply with interactive card"
    );

    const data = await parseFeishuResponse<MessageResponseData>(response, "reply with interactive card");
    if (!data.message_id) {
      throw new Error("Feishu reply with interactive card response did not include message_id.");
    }

    return data.message_id;
  }

  async updateInteractiveCard(messageId: string, card: unknown): Promise<void> {
    const tenantToken = await this.getTenantAccessToken();
    const response = await fetchWithTimeout(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          content: JSON.stringify(card)
        })
      },
      this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
      "Feishu update interactive card"
    );

    await parseFeishuResponse(response, "update interactive card");
  }

  async replyMarkdownFile(messageId: string, fileName: string, markdown: string): Promise<string> {
    const fileKey = await this.uploadMarkdownFile(fileName, markdown);
    return this.replyFile(messageId, fileKey);
  }

  async getBotOpenId(): Promise<string> {
    if (this.botOpenId) {
      return this.botOpenId;
    }

    const tenantToken = await this.getTenantAccessToken();
    const response = await fetchWithTimeout(
      "https://open.feishu.cn/open-apis/bot/v3/info",
      {
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          "Content-Type": "application/json; charset=utf-8"
        }
      },
      this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
      "Feishu get bot info"
    );

    const data = await parseFeishuBotInfoResponse(response, "get bot info");
    const openId = data.bot?.open_id;
    if (!openId) {
      throw new Error("Feishu get bot info response did not include bot.open_id.");
    }

    this.botOpenId = openId;
    return openId;
  }

  async getWikiNodeMetadata(wikiToken: string, userAccessToken: string): Promise<ResolvedWikiNode> {
    const result = await this.resolveWikiNodeWithReadableError(wikiToken, userAccessToken);
    if (!result.spaceId) {
      throw new Error("Wiki node response did not include space_id, which is required for listing child pages.");
    }
    if (!result.nodeToken) {
      throw new Error("Wiki node response did not include node_token, which is required for listing child pages.");
    }
    return result;
  }

  async listWikiChildNodes(spaceId: string, parentNodeToken: string, userAccessToken: string): Promise<WikiChildNodeItem[]> {
    const children: WikiChildNodeItem[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        parent_node_token: parentNodeToken,
        page_size: "50"
      });
      if (pageToken) {
        params.set("page_token", pageToken);
      }

      const response = await fetchWithTimeout(
        `https://open.feishu.cn/open-apis/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${userAccessToken}`,
            "Content-Type": "application/json; charset=utf-8"
          }
        },
        this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
        "Feishu list wiki child nodes"
      );

      const data = await parseFeishuResponse<WikiChildListData>(response, "list wiki child nodes");
      if (data.items) {
        children.push(...data.items);
      }
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);

    return children;
  }

  async readDocumentContent(reference: DocumentReference, userAccessToken: string): Promise<string> {
    if (reference.kind === "wiki") {
      const resolved = await this.resolveWikiNodeWithReadableError(reference.token, userAccessToken);
      return this.readResolvedWikiContent(resolved, userAccessToken);
    }

    if (reference.kind === "docx") {
      return this.readDocxMarkdownContent(reference.token, userAccessToken);
    }

    if (reference.kind === "sheet") {
      return this.readSheetContent(reference.token, userAccessToken);
    }

    if (reference.kind === "bitable") {
      return this.readBitableContent(reference.token, userAccessToken);
    }

    throw new Error("Legacy docs links are not supported by the Markdown content API. Please send a docx document link.");
  }

  private async resolveWikiNodeWithReadableError(wikiToken: string, userAccessToken: string): Promise<ResolvedWikiNode> {
    try {
      return await this.resolveWikiNode(wikiToken, userAccessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("99991679") || message.includes("wiki:node:read") || message.includes("wiki:wiki") || message.includes("wiki:node:retrieve")) {
        throw new Error("读取 wiki 链接需要当前 user_access_token 包含 wiki 用户权限。请确认飞书开放平台已添加并发布 wiki:node:read 和 wiki:node:retrieve，且 .env 的 FEISHU_OAUTH_SCOPES 包含这两个 scope，然后重新授权。也可以直接发送新版 docx 链接绕过 wiki 解析。");
      }

      throw error;
    }
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.tenantToken && this.tenantToken.expiresAt > Date.now() + 60_000) {
      return this.tenantToken.value;
    }

    const response = await fetchWithTimeout(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          app_id: this.config.FEISHU_APP_ID,
          app_secret: this.config.FEISHU_APP_SECRET
        })
      },
      this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
      "Feishu get tenant access token"
    );

    const data = await parseFeishuTenantTokenResponse(response, "get tenant access token");
    this.tenantToken = {
      value: data.tenant_access_token,
      expiresAt: Date.now() + (data.expire ?? 7200) * 1000
    };
    return this.tenantToken.value;
  }

  private async resolveWikiNode(wikiToken: string, userAccessToken: string): Promise<ResolvedWikiNode> {
    const url = `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiToken)}`;
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`
        }
      },
      this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
      "Feishu resolve wiki node"
    );

    const data = await parseFeishuResponse<WikiNodeData>(response, "resolve wiki node");
    const token = data.node?.obj_token;
    if (!token) {
      throw new Error("Wiki node did not contain a document token.");
    }

    return {
      token,
      objType: data.node?.obj_type ?? "docx",
      spaceId: data.node?.space_id,
      nodeToken: data.node?.node_token,
      title: data.node?.title ?? "",
      url: data.node?.url ?? "",
      hasChild: data.node?.has_child ?? false
    };
  }

  private async readResolvedWikiContent(resolved: ResolvedWikiNode, userAccessToken: string): Promise<string> {
    if (resolved.objType === "docx") {
      return this.readDocxMarkdownContent(resolved.token, userAccessToken);
    }

    if (resolved.objType === "sheet") {
      return this.readSheetContent(resolved.token, userAccessToken);
    }

    if (resolved.objType === "bitable") {
      return this.readBitableContent(resolved.token, userAccessToken);
    }

    throw new Error(`Unsupported wiki node object type: ${resolved.objType}`);
  }

  private async readSheetContent(spreadsheetToken: string, userAccessToken: string): Promise<string> {
    const response = await fetchWithTimeout(
      `https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`,
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          "Content-Type": "application/json; charset=utf-8"
        }
      },
      this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
      "Feishu query spreadsheet sheets"
    );
    const data = await parseFeishuResponse<SheetData>(response, "query spreadsheet sheets");
    const sheets = data.sheets?.filter((sheet) => sheet.sheet_id) ?? [];
    if (sheets.length === 0) {
      throw new Error("Feishu spreadsheet did not contain any readable sheets.");
    }

    const sections = [];
    for (const sheet of sheets) {
      const sheetId = sheet.sheet_id as string;
      const values = await this.readSheetValues(spreadsheetToken, sheetId, userAccessToken);
      sections.push([`## ${sheet.title ?? sheetId}`, "", formatTableValues(values)].join("\n"));
    }

    return ["# 飞书电子表格", "", ...sections].join("\n\n");
  }

  private async readSheetValues(spreadsheetToken: string, sheetId: string, userAccessToken: string): Promise<unknown[][]> {
    const response = await fetchWithTimeout(
      `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(sheetId)}`,
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          "Content-Type": "application/json; charset=utf-8"
        }
      },
      this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
      "Feishu read spreadsheet values"
    );
    const data = await parseFeishuResponse<SheetValuesData>(response, "read spreadsheet values");
    return data.valueRange?.values ?? [];
  }

  private async readBitableContent(appToken: string, userAccessToken: string): Promise<string> {
    const tables = await this.readBitableTables(appToken, userAccessToken);
    if (tables.length === 0) {
      throw new Error("Feishu bitable did not contain any readable tables.");
    }

    const sections = [];
    for (const table of tables) {
      const tableId = table.table_id as string;
      const records = await this.readBitableRecords(appToken, tableId, userAccessToken);
      sections.push([`## ${table.name ?? tableId}`, "", formatBitableRecords(records)].join("\n"));
    }

    return ["# 飞书多维表格", "", ...sections].join("\n\n");
  }

  private async readBitableTables(appToken: string, userAccessToken: string): Promise<Array<{ table_id?: string; name?: string }>> {
    const tables: Array<{ table_id?: string; name?: string }> = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({ page_size: "100" });
      if (pageToken) {
        params.set("page_token", pageToken);
      }

      const response = await fetchWithTimeout(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${userAccessToken}`,
            "Content-Type": "application/json; charset=utf-8"
          }
        },
        this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
        "Feishu list bitable tables"
      );
      const data = await parseFeishuResponse<BitableTableData>(response, "list bitable tables");
      tables.push(...(data.items?.filter((table) => table.table_id) ?? []));
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);

    return tables;
  }

  private async readBitableRecords(appToken: string, tableId: string, userAccessToken: string): Promise<Array<Record<string, unknown>>> {
    const records: Array<Record<string, unknown>> = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        page_size: "500",
        automatic_fields: "true"
      });
      if (pageToken) {
        params.set("page_token", pageToken);
      }

      const response = await fetchWithTimeout(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${userAccessToken}`,
            "Content-Type": "application/json; charset=utf-8"
          }
        },
        this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
        "Feishu list bitable records"
      );
      const data = await parseFeishuResponse<BitableRecordData>(response, "list bitable records");
      records.push(...(data.items?.map((record) => record.fields ?? {}) ?? []));
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);

    return records;
  }

  private async readDocxBlocks(documentId: string, userAccessToken: string): Promise<DocxBlock[]> {
    const blocks: DocxBlock[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        document_revision_id: "-1",
        page_size: "500"
      });
      if (pageToken) {
        params.set("page_token", pageToken);
      }

      const response = await fetchWithTimeout(
        `https://open.feishu.cn/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${userAccessToken}`,
            "Content-Type": "application/json; charset=utf-8"
          }
        },
        this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
        "Feishu read docx blocks"
      );
      const data = await parseFeishuResponse<DocxBlocksData>(response, "read docx blocks");
      blocks.push(...(data.items ?? []));
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);

    return blocks;
  }

  private async readDocxBlockAppendix(documentId: string, userAccessToken: string): Promise<string> {
    const blocks = await this.readDocxBlocks(documentId, userAccessToken);
    if (blocks.length === 0) {
      return "";
    }

    const blockById = new Map(blocks.flatMap((block) => (block.block_id ? [[block.block_id, block] as const] : [])));
    const sections: string[] = [];

    const tables = extractDocxTables(blocks, blockById);
    tables.forEach((table, index) => {
      sections.push([`## 文档内表格 ${index + 1}`, "", formatDocxTableValues(table)].join("\n"));
    });

    let sheetCount = 0;
    let bitableCount = 0;
    for (const resource of extractDocxEmbeddedResources(blocks)) {
      if (resource.kind === "sheet") {
        sheetCount += 1;
        const title = `## 文档内嵌电子表格 ${sheetCount}`;
        try {
          const content = await this.readEmbeddedSheetContent(resource.token, userAccessToken);
          sections.push([title, "", content].join("\n"));
        } catch (error) {
          sections.push([title, "", formatEmbeddedResourceReadFailure(error)].join("\n"));
        }
      } else {
        bitableCount += 1;
        const title = `## 文档内嵌多维表格 ${bitableCount}`;
        try {
          const content = await this.readEmbeddedBitableContent(resource.token, userAccessToken);
          sections.push([title, "", content].join("\n"));
        } catch (error) {
          sections.push([title, "", formatEmbeddedResourceReadFailure(error)].join("\n"));
        }
      }
    }

    return sections.length > 0 ? ["# 文档内嵌内容", "", ...sections].join("\n\n") : "";
  }

  private async readEmbeddedSheetContent(spreadsheetToken: string, userAccessToken: string): Promise<string> {
    return this.readEmbeddedResourceContent({ kind: "sheet", token: spreadsheetToken }, userAccessToken);
  }

  private async readEmbeddedBitableContent(appToken: string, userAccessToken: string): Promise<string> {
    return this.readEmbeddedResourceContent({ kind: "bitable", token: appToken }, userAccessToken);
  }

  private async readEmbeddedResourceContent(resource: DocxEmbeddedResource, userAccessToken: string): Promise<string> {
    try {
      return resource.kind === "sheet"
        ? await this.readSheetContent(resource.token, userAccessToken)
        : await this.readBitableContent(resource.token, userAccessToken);
    } catch (directError) {
      let resolvedToken: string | undefined;
      try {
        resolvedToken = await this.resolveEmbeddedResourceToken(resource, userAccessToken);
      } catch (resolveError) {
        throw combineEmbeddedResourceReadErrors(directError, resolveError);
      }

      if (!resolvedToken) {
        throw combineEmbeddedResourceReadErrors(directError, createMissingEmbeddedResourceMetadataError(resource.kind));
      }

      if (resolvedToken === resource.token) {
        throw combineEmbeddedResourceReadErrors(directError, createUnchangedEmbeddedResourceMetadataError(resource.kind));
      }

      try {
        return resource.kind === "sheet"
          ? await this.readSheetContent(resolvedToken, userAccessToken)
          : await this.readBitableContent(resolvedToken, userAccessToken);
      } catch (resolvedError) {
        throw combineEmbeddedResourceReadErrors(directError, resolvedError);
      }
    }
  }

  private async resolveEmbeddedResourceToken(resource: DocxEmbeddedResource, userAccessToken: string): Promise<string | undefined> {
    const response = await fetchWithTimeout(
      "https://open.feishu.cn/open-apis/drive/v1/metas/batch_query",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          request_docs: [
            {
              doc_token: resource.token,
              doc_type: resource.kind === "sheet" ? "sheet" : "bitable"
            }
          ]
        })
      },
      this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
      "Feishu resolve embedded resource metadata"
    );
    const data = await parseFeishuResponse<unknown>(response, "resolve embedded resource metadata");
    return findDriveMetaResourceToken(data, resource.kind, resource.token);
  }

  private async uploadMarkdownFile(fileName: string, markdown: string): Promise<string> {
    const tenantToken = await this.getTenantAccessToken();
    const formData = new FormData();
    formData.set("file_type", "stream");
    formData.set("file_name", fileName);
    formData.set("file", new Blob([markdown], { type: "text/markdown; charset=utf-8" }), fileName);

    const response = await fetchWithTimeout(
      "https://open.feishu.cn/open-apis/im/v1/files",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenantToken}`
        },
        body: formData
      },
      this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
      "Feishu upload markdown file"
    );

    const data = await parseFeishuResponse<FileUploadData>(response, "upload markdown file");
    if (!data.file_key) {
      throw new Error("Feishu upload markdown file response did not include file_key.");
    }

    return data.file_key;
  }

  private async replyFile(messageId: string, fileKey: string): Promise<string> {
    const tenantToken = await this.getTenantAccessToken();
    const response = await fetchWithTimeout(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          msg_type: "file",
          content: JSON.stringify({ file_key: fileKey })
        })
      },
      this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
      "Feishu reply with markdown file"
    );

    const data = await parseFeishuResponse<MessageResponseData>(response, "reply with markdown file");
    if (!data.message_id) {
      throw new Error("Feishu reply with markdown file response did not include message_id.");
    }

    return data.message_id;
  }

  private async readDocxMarkdownContent(documentId: string, userAccessToken: string): Promise<string> {
    const params = new URLSearchParams({
      content_type: "markdown",
      doc_token: documentId,
      doc_type: "docx",
      lang: "zh"
    });
    const response = await fetchWithTimeout(
      `https://open.feishu.cn/open-apis/docs/v1/content?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${userAccessToken}`,
          "Content-Type": "application/json; charset=utf-8"
        }
      },
      this.config.EXTERNAL_REQUEST_TIMEOUT_MS,
      "Feishu read docx markdown content"
    );

    const data = await parseFeishuResponse<DocumentContentData>(response, "read docx markdown content");
    const appendix = await this.readDocxBlockAppendix(documentId, userAccessToken);
    const parts = [data.content, appendix].filter(isNonEmptyString);
    if (parts.length === 0) {
      throw new Error("Feishu docx markdown content was empty.");
    }

    return parts.join("\n\n");
  }
}

async function parseFeishuResponse<T = unknown>(response: Response, action: string): Promise<T> {
  const rawBody = await response.text();
  let body: FeishuResponse<T>;

  try {
    body = JSON.parse(rawBody) as FeishuResponse<T>;
  } catch {
    throw new Error(`Feishu ${action} returned non-JSON response: ${response.status} ${rawBody}`);
  }

  if (!response.ok || body.code !== 0) {
    throw new Error(`Feishu ${action} failed: ${response.status} ${body.code} ${body.msg ?? rawBody}`);
  }

  return body.data as T;
}

async function parseFeishuTenantTokenResponse(response: Response, action: string): Promise<TenantAccessTokenData> {
  const rawBody = await response.text();
  let body: TenantAccessTokenResponse;

  try {
    body = JSON.parse(rawBody) as TenantAccessTokenResponse;
  } catch {
    throw new Error(`Feishu ${action} returned non-JSON response: ${response.status} ${rawBody}`);
  }

  if (!response.ok || body.code !== 0) {
    throw new Error(`Feishu ${action} failed: ${response.status} ${body.code} ${body.msg ?? rawBody}`);
  }

  if (!body.tenant_access_token) {
    throw new Error(`Feishu ${action} response did not include tenant_access_token.`);
  }

  return {
    tenant_access_token: body.tenant_access_token,
    expire: body.expire
  };
}

async function parseFeishuBotInfoResponse(response: Response, action: string): Promise<BotInfoData> {
  const rawBody = await response.text();
  let body: BotInfoResponse;

  try {
    body = JSON.parse(rawBody) as BotInfoResponse;
  } catch {
    throw new Error(`Feishu ${action} returned non-JSON response: ${response.status} ${rawBody}`);
  }

  if (!response.ok || body.code !== 0) {
    throw new Error(`Feishu ${action} failed: ${response.status} ${body.code} ${body.msg ?? rawBody}`);
  }

  return body.data ?? { bot: body.bot };
}

function combineEmbeddedResourceReadErrors(directError: unknown, resolveError: unknown): Error {
  return new Error(formatErrorMessage(directError) + "；通过 Drive 元数据解析内嵌资源失败：" + formatErrorMessage(resolveError));
}

function createMissingEmbeddedResourceMetadataError(kind: DocxEmbeddedResource["kind"]): Error {
  return new Error("未返回可读取的" + getEmbeddedResourceLabel(kind) + " URL 或 token；当前 docx block token 不能直接用于 Sheets/Base API。");
}

function createUnchangedEmbeddedResourceMetadataError(kind: DocxEmbeddedResource["kind"]): Error {
  return new Error("返回的" + getEmbeddedResourceLabel(kind) + " token 与 docx block token 相同，仍不能直接读取。");
}

function getEmbeddedResourceLabel(kind: DocxEmbeddedResource["kind"]): string {
  return kind === "sheet" ? "电子表格" : "多维表格";
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findDriveMetaResourceToken(value: unknown, kind: DocxEmbeddedResource["kind"], originalToken: string): string | undefined {
  const urlToken = findFeishuResourceTokenInValue(value, kind);
  if (urlToken && urlToken !== originalToken) {
    return urlToken;
  }

  const explicitToken = findStringByKeys(
    value,
    kind === "sheet" ? ["spreadsheet_token", "spreadsheetToken"] : ["app_token", "appToken"]
  );
  if (explicitToken && explicitToken !== originalToken) {
    return explicitToken;
  }

  return undefined;
}

function findFeishuResourceTokenInValue(value: unknown, kind: DocxEmbeddedResource["kind"]): string | undefined {
  if (typeof value === "string") {
    return extractFeishuResourceTokenFromUrl(value, kind);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const token = findFeishuResourceTokenInValue(item, kind);
      if (token) {
        return token;
      }
    }
    return undefined;
  }

  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      const token = findFeishuResourceTokenInValue(item, kind);
      if (token) {
        return token;
      }
    }
  }

  return undefined;
}

function extractFeishuResourceTokenFromUrl(value: string, kind: DocxEmbeddedResource["kind"]): string | undefined {
  const markers = kind === "sheet" ? ["/sheets/"] : ["/base/", "/bitable/"];
  for (const marker of markers) {
    const markerIndex = value.indexOf(marker);
    if (markerIndex === -1) {
      continue;
    }

    const tokenStart = markerIndex + marker.length;
    const rest = value.slice(tokenStart);
    const tokenEnd = rest.search(/[/?#\s)]/);
    const token = tokenEnd === -1 ? rest : rest.slice(0, tokenEnd);
    if (token) {
      return token;
    }
  }

  return undefined;
}

function extractDocxTables(blocks: DocxBlock[], blockById: Map<string, DocxBlock>): unknown[][][] {
  return blocks.filter(isDocxTableBlock).map((block) => buildDocxTableRows(block, blockById)).filter(isNonEmptyTable);
}

function formatEmbeddedResourceReadFailure(error: unknown): string {
  return "_读取失败：" + formatErrorMessage(error) + "_";
}

function buildDocxTableRows(tableBlock: DocxBlock, blockById: Map<string, DocxBlock>): unknown[][] {
  const cellIds = getBlockChildIds(tableBlock).filter((childId) => {
    const child = blockById.get(childId);
    return child ? isDocxTableCellBlock(child) : false;
  });
  const cellTexts = cellIds.map((cellId) => collectDocxBlockText(blockById.get(cellId), blockById, new Set([tableBlock.block_id ?? ""])));
  const columnCount = findNumberByKeys(tableBlock.table, ["column_size", "columnSize", "column_count", "columnCount"]);

  if (!columnCount || columnCount <= 0) {
    return cellTexts.map((text) => [text]);
  }

  const rows: unknown[][] = [];
  for (let index = 0; index < cellTexts.length; index += columnCount) {
    rows.push(cellTexts.slice(index, index + columnCount));
  }

  return rows;
}

function collectDocxBlockText(block: DocxBlock | undefined, blockById: Map<string, DocxBlock>, visited: Set<string>): string {
  if (!block) {
    return "";
  }

  if (block.block_id) {
    if (visited.has(block.block_id)) {
      return "";
    }
    visited.add(block.block_id);
  }

  const textParts = collectRichTextParts(block);
  for (const childId of getBlockChildIds(block)) {
    const childText = collectDocxBlockText(blockById.get(childId), blockById, visited);
    if (childText) {
      textParts.push(childText);
    }
  }

  return textParts.filter(isNonEmptyString).join("\n");
}

function collectRichTextParts(value: unknown): string[] {
  const parts: string[] = [];
  collectRichTextPartsInto(value, parts);
  return parts;
}

function collectRichTextPartsInto(value: unknown, parts: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRichTextPartsInto(item, parts);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const textRun = value.text_run;
  if (isRecord(textRun) && typeof textRun.content === "string") {
    parts.push(textRun.content);
  }

  const mentionDoc = value.mention_doc;
  if (isRecord(mentionDoc) && typeof mentionDoc.title === "string") {
    parts.push(mentionDoc.title);
  }

  const mentionUser = value.mention_user;
  if (isRecord(mentionUser) && typeof mentionUser.name === "string") {
    parts.push(mentionUser.name);
  }

  const equation = value.equation;
  if (isRecord(equation) && typeof equation.content === "string") {
    parts.push(equation.content);
  }

  const file = value.file;
  if (isRecord(file) && typeof file.name === "string") {
    parts.push(file.name);
  }

  for (const item of Object.values(value)) {
    collectRichTextPartsInto(item, parts);
  }
}

function extractDocxEmbeddedResources(blocks: DocxBlock[]): DocxEmbeddedResource[] {
  const resources: DocxEmbeddedResource[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const sheetToken = findEmbeddedToken(block, ["sheet", "spreadsheet"], ["spreadsheet_token", "spreadsheetToken"], ["token"]);
    if (sheetToken && !seen.has("sheet:" + sheetToken)) {
      seen.add("sheet:" + sheetToken);
      resources.push({ kind: "sheet", token: sheetToken });
    }

    const bitableToken = findEmbeddedToken(block, ["bitable", "base"], ["app_token", "appToken"], ["token"]);
    if (bitableToken && !seen.has("bitable:" + bitableToken)) {
      seen.add("bitable:" + bitableToken);
      resources.push({ kind: "bitable", token: bitableToken });
    }
  }

  return resources;
}

function findEmbeddedToken(block: DocxBlock, containerKeys: string[], explicitKeys: string[], fallbackKeys: string[]): string | undefined {
  for (const containerKey of containerKeys) {
    const container = block[containerKey];
    if (!isRecord(container)) {
      continue;
    }

    const explicitToken = findStringByKeys(container, explicitKeys);
    if (explicitToken) {
      return explicitToken;
    }

    const fallbackToken = findStringByKeys(container, fallbackKeys);
    if (fallbackToken) {
      return fallbackToken;
    }
  }

  return undefined;
}

function getBlockChildIds(block: DocxBlock): string[] {
  return Array.isArray(block.children) ? block.children.filter((child): child is string => typeof child === "string") : [];
}

function isDocxTableBlock(block: DocxBlock): boolean {
  return isRecord(block.table) || block.block_type === 31;
}

function isDocxTableCellBlock(block: DocxBlock): boolean {
  return isRecord(block.table_cell) || block.block_type === 32;
}

function formatDocxTableValues(values: unknown[][]): string {
  if (values.length === 0) {
    return "_空表格_";
  }

  const columnCount = Math.max(...values.map((row) => row.length), 1);
  const header = values[0] ?? [];
  const normalizedHeader = Array.from({ length: columnCount }, (_, index) => formatMarkdownCell(header[index] ?? `列${index + 1}`));
  const rows = values.slice(1).map((row) => Array.from({ length: columnCount }, (_, index) => formatMarkdownCell(row[index] ?? "")));
  return formatMarkdownTable(normalizedHeader, rows);
}

function formatTableValues(values: unknown[][]): string {
  if (values.length === 0) {
    return "_空表格_";
  }

  const columnCount = Math.max(...values.map((row) => row.length), 1);
  const header = Array.from({ length: columnCount }, (_, index) => `列${index + 1}`);
  const rows = values.map((row) => Array.from({ length: columnCount }, (_, index) => formatMarkdownCell(row[index] ?? "")));
  return formatMarkdownTable(header, rows);
}

function formatBitableRecords(records: Array<Record<string, unknown>>): string {
  if (records.length === 0) {
    return "_空表格_";
  }

  const headers: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!headers.includes(key)) {
        headers.push(key);
      }
    }
  }

  if (headers.length === 0) {
    return "_空表格_";
  }

  const rows = records.map((record) => headers.map((header) => formatMarkdownCell(record[header] ?? "")));
  return formatMarkdownTable(headers.map(formatMarkdownCell), rows);
}

function formatMarkdownTable(header: string[], rows: string[][]): string {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function formatMarkdownCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map(formatMarkdownCell).filter(isNonEmptyString).join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
  }

  return String(value).replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

function findStringByKeys(value: unknown, keys: string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKeys(item, keys);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item) {
      return item;
    }
  }

  for (const item of Object.values(value)) {
    const found = findStringByKeys(item, keys);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function findNumberByKeys(value: unknown, keys: string[]): number | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNumberByKeys(item, keys);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of keys) {
    const item = value[key];
    if (typeof item === "number") {
      return item;
    }
  }

  for (const item of Object.values(value)) {
    const found = findNumberByKeys(item, keys);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyTable(value: unknown[][]): boolean {
  return value.some((row) => row.some((cell) => isNonEmptyString(formatMarkdownCell(cell))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
