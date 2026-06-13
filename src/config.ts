import { z } from "zod";

const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  FEISHU_EVENT_MODE: z.enum(["webhook", "websocket"]).default("websocket"),
  PUBLIC_BASE_URL: optionalUrl,
  FEISHU_APP_ID: z.string().min(1),
  FEISHU_APP_SECRET: z.string().min(1),
  FEISHU_OAUTH_SCOPES: z.string().default("docs:document.content:read docx:document:readonly wiki:node:read wiki:node:retrieve drive:drive.metadata:readonly sheets:spreadsheet:readonly bitable:app:readonly"),
  FEISHU_VERIFICATION_TOKEN: z.string().default(""),
  FEISHU_ENCRYPT_KEY: z.string().optional(),
  FEISHU_PROXY_URL: optionalUrl,
  TOKEN_STORE_FILE: z.string().default(".data/feishu-user-tokens.json"),
  RESULTS_DIR: z.string().default(".data/results"),
  EXTERNAL_REQUEST_TIMEOUT_MS: z.coerce.number().default(300_000),
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().min(1).default("deepseek-v4-pro"),
  DEEPSEEK_DOCUMENT_CHUNK_SIZE: z.coerce.number().default(30_000)
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  return envSchema.parse(process.env);
}
