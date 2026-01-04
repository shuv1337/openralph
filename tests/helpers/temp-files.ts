/**
 * Test helper for managing temporary files and directories.
 * Provides automatic cleanup after tests.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Manages a temporary directory for test fixtures.
 * Call `create()` in beforeEach and `cleanup()` in afterEach.
 *
 * @example
 * ```ts
 * import { describe, it, expect, beforeEach, afterEach } from "bun:test";
 * import { TempDir } from "../helpers/temp-files";
 *
 * describe("my test", () => {
 *   const tempDir = new TempDir();
 *
 *   beforeEach(async () => {
 *     await tempDir.create();
 *   });
 *
 *   afterEach(async () => {
 *     await tempDir.cleanup();
 *   });
 *
 *   it("should use temp directory", async () => {
 *     const filePath = tempDir.path("test-file.txt");
 *     await Bun.write(filePath, "content");
 *     // ...
 *   });
 * });
 * ```
 */
export class TempDir {
  private _dir: string | null = null;

  /**
   * Creates a new temporary directory with a unique name.
   * @param prefix - Optional prefix for the temp directory name (default: "ralph-test-")
   */
  async create(prefix: string = "ralph-test-"): Promise<string> {
    this._dir = await mkdtemp(join(tmpdir(), prefix));
    return this._dir;
  }

  /**
   * Returns the path to the temporary directory.
   * @throws Error if create() hasn't been called
   */
  get dir(): string {
    if (!this._dir) {
      throw new Error("TempDir not created. Call create() first.");
    }
    return this._dir;
  }

  /**
   * Returns a path within the temporary directory.
   * @param relativePath - Path relative to the temp directory
   */
  path(...relativePath: string[]): string {
    return join(this.dir, ...relativePath);
  }

  /**
   * Writes content to a file in the temporary directory.
   * @param relativePath - Path relative to the temp directory
   * @param content - Content to write
   */
  async write(relativePath: string, content: string): Promise<string> {
    const filePath = this.path(relativePath);
    await Bun.write(filePath, content);
    return filePath;
  }

  /**
   * Reads content from a file in the temporary directory.
   * @param relativePath - Path relative to the temp directory
   */
  async read(relativePath: string): Promise<string> {
    const filePath = this.path(relativePath);
    return await Bun.file(filePath).text();
  }

  /**
   * Checks if a file exists in the temporary directory.
   * @param relativePath - Path relative to the temp directory
   */
  async exists(relativePath: string): Promise<boolean> {
    const filePath = this.path(relativePath);
    return await Bun.file(filePath).exists();
  }

  /**
   * Removes the temporary directory and all its contents.
   * Safe to call even if create() wasn't called.
   */
  async cleanup(): Promise<void> {
    if (this._dir) {
      try {
        await rm(this._dir, { recursive: true, force: true });
      } catch {
        // Ignore errors during cleanup (directory may already be deleted)
      }
      this._dir = null;
    }
  }
}

/**
 * Tracks files for cleanup at the end of a test.
 * Useful when working in the current directory rather than a temp directory.
 *
 * @example
 * ```ts
 * import { describe, it, expect, beforeEach, afterEach } from "bun:test";
 * import { FileTracker } from "../helpers/temp-files";
 *
 * describe("my test", () => {
 *   const tracker = new FileTracker();
 *
 *   afterEach(async () => {
 *     await tracker.cleanup();
 *   });
 *
 *   it("should cleanup tracked files", async () => {
 *     await Bun.write(".ralph-lock", "12345");
 *     tracker.track(".ralph-lock");
 *     // ... test runs ...
 *     // File is automatically cleaned up after test
 *   });
 * });
 * ```
 */
export class FileTracker {
  private files: Set<string> = new Set();

  /**
   * Tracks a file for cleanup.
   * @param filePath - Path to the file to track
   */
  track(filePath: string): void {
    this.files.add(filePath);
  }

  /**
   * Tracks multiple files for cleanup.
   * @param filePaths - Paths to the files to track
   */
  trackAll(...filePaths: string[]): void {
    for (const filePath of filePaths) {
      this.files.add(filePath);
    }
  }

  /**
   * Writes content to a file and tracks it for cleanup.
   * @param filePath - Path to the file
   * @param content - Content to write
   */
  async writeAndTrack(filePath: string, content: string): Promise<void> {
    await Bun.write(filePath, content);
    this.track(filePath);
  }

  /**
   * Removes all tracked files.
   * Safe to call even if no files were tracked.
   */
  async cleanup(): Promise<void> {
    const { unlink } = await import("node:fs/promises");
    for (const filePath of this.files) {
      try {
        await unlink(filePath);
      } catch {
        // Ignore errors (file may not exist or already deleted)
      }
    }
    this.files.clear();
  }
}

/**
 * Creates a temporary directory, runs a function with it, and cleans up automatically.
 * Useful for one-off tests that need a temp directory.
 *
 * @example
 * ```ts
 * it("should work with temp files", async () => {
 *   await withTempDir(async (dir) => {
 *     await Bun.write(dir.path("file.txt"), "content");
 *     const content = await dir.read("file.txt");
 *     expect(content).toBe("content");
 *   });
 *   // Directory is automatically cleaned up
 * });
 * ```
 */
export async function withTempDir<T>(
  fn: (dir: TempDir) => Promise<T>,
  prefix?: string
): Promise<T> {
  const dir = new TempDir();
  try {
    await dir.create(prefix);
    return await fn(dir);
  } finally {
    await dir.cleanup();
  }
}
