import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { join } from "node:path";

// Mock homedir to return a consistent path for testing
mock.module("node:os", () => ({
  homedir: () => "/Users/testuser",
}));

// Mock node:path to use posix behavior for these tests
mock.module("node:path", () => ({
  join: (...args: string[]) => args.join("/"),
}));

describe("paths - macOS", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // In Bun, process.platform is read-only. We need to mock it if possible or 
    // use a different approach. Since we're testing the logic in paths.ts, 
    // and paths.ts captures platform at top level, we might need to re-import it.
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    process.env = { ...originalEnv };
  });

  // Helper to get fresh paths module
  async function getPathsModule() {
    // We use a query param to bust the module cache if needed, 
    // but Bun might not support this for local files.
    // Alternatively, we can just hope Object.defineProperty works before any import.
    return await import("../../src/lib/paths");
  }

  describe("getLogDir", () => {
    it("SHOULD return ~/Library/Logs/Ralph on macOS", async () => {
      const { getLogDir } = await import("../../src/lib/paths");
      expect(getLogDir()).toBe("/Users/testuser/Library/Logs/Ralph");
    });

    it("SHOULD respect RALPH_LOG_DIR override on macOS", async () => {
      process.env.RALPH_LOG_DIR = "/custom/logs";
      const { getLogDir } = await import("../../src/lib/paths");
      expect(getLogDir()).toBe("/custom/logs");
    });
  });

  describe("getStateDir", () => {
    it("SHOULD return ~/Library/Application Support/Ralph on macOS", async () => {
      const { getStateDir } = await import("../../src/lib/paths");
      expect(getStateDir()).toBe("/Users/testuser/Library/Application Support/Ralph");
    });
  });

  describe("getConfigDir", () => {
    it("SHOULD return ~/Library/Application Support/Ralph on macOS", async () => {
      const { getConfigDir } = await import("../../src/lib/paths");
      expect(getConfigDir()).toBe("/Users/testuser/Library/Application Support/Ralph");
    });
  });

  describe("getCacheDir", () => {
    it("SHOULD return ~/Library/Caches/Ralph on macOS", async () => {
      const { getCacheDir } = await import("../../src/lib/paths");
      expect(getCacheDir()).toBe("/Users/testuser/Library/Caches/Ralph");
    });
  });
});
