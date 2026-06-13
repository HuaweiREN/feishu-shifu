import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TokenSet } from "../types.js";

interface StoredTokenFile {
  version: 1;
  tokens: Record<string, TokenSet>;
}

export interface TokenStore {
  get(userOpenId: string): TokenSet | undefined;
  getRaw(userOpenId: string): TokenSet | undefined;
  set(userOpenId: string, token: TokenSet): void;
  delete(userOpenId: string): void;
}

export class FileTokenStore implements TokenStore {
  private readonly tokens = new Map<string, TokenSet>();

  constructor(private readonly filePath: string) {
    this.filePath = resolve(filePath);
    this.load();
  }

  get(userOpenId: string): TokenSet | undefined {
    const token = this.tokens.get(userOpenId);
    if (!token) {
      return undefined;
    }

    if (isExpired(token)) {
      if (!token.refreshToken) {
        this.tokens.delete(userOpenId);
        this.persist();
      }
      return undefined;
    }

    return token;
  }

  getRaw(userOpenId: string): TokenSet | undefined {
    return this.tokens.get(userOpenId);
  }

  set(userOpenId: string, token: TokenSet): void {
    this.tokens.set(userOpenId, token);
    this.persist();
  }

  delete(userOpenId: string): void {
    this.tokens.delete(userOpenId);
    this.persist();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (error) {
      console.warn("Failed to read token store file; starting with empty tokens.", error);
      return;
    }

    let parsed: Partial<StoredTokenFile>;
    try {
      parsed = JSON.parse(raw) as Partial<StoredTokenFile>;
    } catch (error) {
      console.warn("Token store file contains invalid JSON; starting with empty tokens.", error);
      this.backupCorruptedFile();
      return;
    }
    let shouldPersist = false;

    for (const [userOpenId, token] of Object.entries(parsed.tokens ?? {})) {
      if (!isTokenSet(token) || isExpired(token)) {
        shouldPersist = true;
        continue;
      }

      this.tokens.set(userOpenId, token);
    }

    if (shouldPersist) {
      this.persist();
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const file: StoredTokenFile = {
      version: 1,
      tokens: Object.fromEntries(this.tokens)
    };
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(file, null, 2), "utf8");
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, this.filePath);
  }

  private backupCorruptedFile(): void {
    try {
      const backupPath = `${this.filePath}.backup-${Date.now()}`;
      copyFileSync(this.filePath, backupPath);
      console.warn(`Corrupted token store backed up to ${backupPath}`);
    } catch {
      // best-effort backup
    }
  }
}

function isTokenSet(value: unknown): value is TokenSet {
  if (!value || typeof value !== "object") {
    return false;
  }

  const token = value as Partial<TokenSet>;
  return (
    typeof token.accessToken === "string" &&
    (token.refreshToken === undefined || typeof token.refreshToken === "string") &&
    (token.expiresAt === undefined || typeof token.expiresAt === "number")
  );
}

function isExpired(token: TokenSet): boolean {
  return token.expiresAt !== undefined && token.expiresAt <= Date.now();
}
