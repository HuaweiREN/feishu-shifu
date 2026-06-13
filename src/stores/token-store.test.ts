import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileTokenStore } from "./token-store.js";

const tempRoots: string[] = [];

describe("FileTokenStore", () => {
  afterEach(() => {
    for (const tempRoot of tempRoots.splice(0)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("persists tokens and loads them after restart", () => {
    const tokenFile = createTokenFilePath();
    const firstStore = new FileTokenStore(tokenFile);

    firstStore.set("ou_test", {
      accessToken: "user-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60_000
    });

    const secondStore = new FileTokenStore(tokenFile);

    expect(secondStore.get("ou_test")).toMatchObject({
      accessToken: "user-token",
      refreshToken: "refresh-token"
    });
  });

  it("does not return expired tokens", () => {
    const tokenFile = createTokenFilePath();
    mkdirSync(join(tokenFile, ".."), { recursive: true });
    writeFileSync(
      tokenFile,
      JSON.stringify({
        version: 1,
        tokens: {
          ou_test: {
            accessToken: "expired-token",
            expiresAt: Date.now() - 1
          }
        }
      }),
      "utf8"
    );

    const store = new FileTokenStore(tokenFile);

    expect(store.get("ou_test")).toBeUndefined();
    expect(readFileSync(tokenFile, "utf8")).not.toContain("expired-token");
  });
});

function createTokenFilePath(): string {
  mkdirSync(".data", { recursive: true });
  const tempRoot = mkdtempSync(join(process.cwd(), ".data", "token-store-test-"));
  tempRoots.push(tempRoot);
  return join(tempRoot, "tokens.json");
}