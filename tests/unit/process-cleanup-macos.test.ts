import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { findProcessByPort } from "../../src/lib/process-cleanup";

describe("process-cleanup - macOS", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    mock.restore();
  });

  it("SHOULD use lsof to find process by port on macOS", async () => {
    const spawnMock = mock((cmd: string[]) => {
      if (cmd[0] === "lsof") {
        return {
          stdout: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("1234\n"));
              controller.close();
            },
          }),
          exited: Promise.resolve(0),
          exitCode: 0,
        };
      }
      return {
          stdout: new ReadableStream({ start(c) { c.close(); } }),
          exited: Promise.resolve(1),
          exitCode: 1,
      };
    });

    // @ts-ignore
    globalThis.Bun.spawn = spawnMock;

    const pid = await findProcessByPort(4096);
    expect(pid).toBe(1234);
    
    // Verify lsof was called with correct arguments
    const calls = spawnMock.mock.calls;
    const lsofCall = calls.find(call => call[0][0] === "lsof");
    expect(lsofCall).toBeDefined();
    expect(lsofCall![0]).toContain("-i");
    expect(lsofCall![0]).toContain(":4096");
  });

  it("SHOULD skip netstat fallback on macOS", async () => {
      // On macOS, if lsof fails, it should NOT try netstat as a fallback 
      // because netstat on macOS doesn't show PIDs.
      
      const spawnMock = mock((cmd: string[]) => {
          return {
              stdout: new ReadableStream({ start(c) { c.close(); } }),
              exited: Promise.resolve(1),
              exitCode: 1,
          };
      });

      // @ts-ignore
      globalThis.Bun.spawn = spawnMock;

      await findProcessByPort(4096);
      
      const calls = spawnMock.mock.calls;
      const netstatCall = calls.find(call => call[0][0] === "netstat");
      expect(netstatCall).toBeUndefined();
  });

  it("SHOULD return null if lsof finds no process", async () => {
    const spawnMock = mock((cmd: string[]) => {
      return {
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(""));
            controller.close();
          },
        }),
        exited: Promise.resolve(0),
        exitCode: 0,
      };
    });

    // @ts-ignore
    globalThis.Bun.spawn = spawnMock;

    const pid = await findProcessByPort(4096);
    expect(pid).toBeNull();
  });
});
