import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { spawnPty } from "../../src/pty/spawn";

describe("pty/spawn - macOS environment", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    process.env = { ...originalEnv };
    mock.restore();
  });

  it("SHOULD include macOS-specific vars in PTY environment", () => {
    process.env.TERM_PROGRAM = "Apple_Terminal";
    process.env.TERM_PROGRAM_VERSION = "443";
    process.env.LANG = "en_GB.UTF-8";

    const spawnMock = mock((cmd: string[], options?: any) => {
      return {
        pid: 123,
        exited: new Promise(() => {}),
        terminal: { write: () => {} }
      } as any;
    });

    // @ts-ignore
    globalThis.Bun.spawn = spawnMock;

    spawnPty(["ls"]);

    const options = spawnMock.mock.calls[0][1];
    expect(options?.env.TERM_PROGRAM).toBe("Apple_Terminal");
    expect(options?.env.TERM_PROGRAM_VERSION).toBe("443");
    expect(options?.env.LANG).toBe("en_GB.UTF-8");
    expect(options?.env.FORCE_COLOR).toBe("1");
  });

  it("SHOULD use default LANG if not set on macOS", () => {
    delete process.env.LANG;
    
    const spawnMock = mock((cmd: string[], options?: any) => ({
        pid: 123,
        exited: new Promise(() => {}),
    })) as any;

    // @ts-ignore
    globalThis.Bun.spawn = spawnMock;

    spawnPty(["ls"]);

    const options = spawnMock.mock.calls[0][1];
    expect(options?.env.LANG).toBe("en_US.UTF-8");
  });

  it("SHOULD preserve GHOSTTY_RESOURCES_DIR if set", () => {
    process.env.GHOSTTY_RESOURCES_DIR = "/ghostty/res";
    
    const spawnMock = mock((cmd: string[], options?: any) => ({
        pid: 123,
        exited: new Promise(() => {}),
    })) as any;

    // @ts-ignore
    globalThis.Bun.spawn = spawnMock;

    spawnPty(["ls"]);

    const options = spawnMock.mock.calls[0][1];
    expect(options?.env.GHOSTTY_RESOURCES_DIR).toBe("/ghostty/res");
  });
});
