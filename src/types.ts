export interface FeishuMessageEvent {
  header?: {
    event_type?: string;
    token?: string;
  };
  event?: {
    sender?: {
      sender_id?: {
        open_id?: string;
        user_id?: string;
      };
    };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      content?: string;
      mentions?: FeishuMessageMention[];
    };
  };
}

export interface FeishuMessageMention {
  key?: string;
  name?: string;
  id?: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
  };
  tenant_key?: string;
}

export interface FeishuTextMessage {
  text?: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface DocumentReference {
  token: string;
  kind: "docx" | "docs" | "wiki" | "sheet" | "bitable";
  url: string;
}

export type TaskKind = "traverse" | "associate" | "kb_search";

export interface CardAction {
  text: string;
  url: string;
}
