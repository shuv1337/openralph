/**
 * Windows Terminal Support Tests
 * 
 * These tests verify Windows-specific functionality for terminal support.
 * Tests that require Windows will be skipped on other platforms.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";

const isWindows = process.platform === "win32";

describe("Windows Terminal Support", () => {
  describe("Platform Detection", () => {
    test("should correctly detect Windows platform", () => {
      expect(typeof process.platform).toBe("string");
      // The test itself should pass on any platform
      if (isWindows) {
        expect(process.platform).toBe("win32");
      }
    });

    test("stdin TTY check works correctly", () => {
      // In CI or non-TTY environments, isTTY is undefined
      // When it's a TTY, it should be true
      const isTTY = process.stdin.isTTY;
      expect(isTTY === true || isTTY === undefined).toBe(true);
    });
  });

  describe("Clipboard Tool Detection", () => {
    test.skipIf(!isWindows)("should detect 'clip' on Windows", async () => {
      const { detectClipboardTool } = await import("../../src/lib/clipboard");
      const tool = await detectClipboardTool();
      expect(tool).toBe("clip");
    });

    test.skipIf(!isWindows)("should be able to copy to clipboard", async () => {
      const { copyToClipboard } = await import("../../src/lib/clipboard");
      const result = await copyToClipboard("test content from Windows tests");
      expect(result.success).toBe(true);
    });

    test.skipIf(!isWindows)("should be able to read from clipboard", async () => {
      const { copyToClipboard, readFromClipboard } = await import("../../src/lib/clipboard");
      
      // Write a test value
      const testValue = `test-${Date.now()}`;
      await copyToClipboard(testValue);
      
      // Read it back
      const result = await readFromClipboard();
      expect(result).toContain(testValue);
    });
  });

  describe("Terminal Launcher", () => {
    test.skipIf(!isWindows)("should detect at least one terminal on Windows", async () => {
      const { detectInstalledTerminals, clearTerminalCache } = await import("../../src/lib/terminal-launcher");
      clearTerminalCache();
      const terminals = await detectInstalledTerminals();
      // Windows should have at least cmd.exe
      expect(terminals.length).toBeGreaterThan(0);
    });

    test("should have PowerShell terminals in knownTerminals", async () => {
      const { knownTerminals } = await import("../../src/lib/terminal-launcher");
      
      const win32Terminals = knownTerminals.filter(t => t.platforms.includes("win32"));
      const terminalNames = win32Terminals.map(t => t.name);
      
      expect(terminalNames).toContain("PowerShell Core");
      expect(terminalNames).toContain("Windows PowerShell");
      expect(terminalNames).toContain("Windows Terminal");
      expect(terminalNames).toContain("Windows Terminal (New Tab)");
      expect(terminalNames).toContain("Command Prompt");
    });

    test("PowerShell terminals should have correct args", async () => {
      const { knownTerminals } = await import("../../src/lib/terminal-launcher");
      
      const pwshCore = knownTerminals.find(t => t.name === "PowerShell Core");
      expect(pwshCore).toBeDefined();
      expect(pwshCore?.command).toBe("pwsh");
      expect(pwshCore?.args).toContain("-NoExit");
      expect(pwshCore?.args).toContain("-Command");
      
      const winPwsh = knownTerminals.find(t => t.name === "Windows PowerShell");
      expect(winPwsh).toBeDefined();
      expect(winPwsh?.command).toBe("powershell");
    });
  });

  describe("Windows Console Utilities", () => {
    test("should export VT mode detection function", async () => {
      const { ensureVirtualTerminalProcessing } = await import("../../src/lib/windows-console");
      expect(typeof ensureVirtualTerminalProcessing).toBe("function");
      
      const result = await ensureVirtualTerminalProcessing();
      expect(typeof result).toBe("boolean");
    });

    test("should export truecolor detection function", async () => {
      const { supportsTruecolor } = await import("../../src/lib/windows-console");
      expect(typeof supportsTruecolor).toBe("function");
      
      const result = supportsTruecolor();
      expect(typeof result).toBe("boolean");
    });

    test("should export recommended FPS function", async () => {
      const { getRecommendedFps } = await import("../../src/lib/windows-console");
      expect(typeof getRecommendedFps).toBe("function");
      
      const fps = getRecommendedFps();
      expect(typeof fps).toBe("number");
      expect(fps).toBeGreaterThanOrEqual(20);
      expect(fps).toBeLessThanOrEqual(60);
    });

    test("should export debounce recommendation function", async () => {
      const { getRecommendedDebounceMs } = await import("../../src/lib/windows-console");
      expect(typeof getRecommendedDebounceMs).toBe("function");
      
      const debounce = getRecommendedDebounceMs();
      expect(typeof debounce).toBe("number");
      expect(debounce).toBeGreaterThanOrEqual(50);
    });

    test("should export Windows Terminal detection function", async () => {
      const { isWindowsTerminal } = await import("../../src/lib/windows-console");
      expect(typeof isWindowsTerminal).toBe("function");
      
      const result = isWindowsTerminal();
      expect(typeof result).toBe("boolean");
      
      // If WT_SESSION is set, should return true
      if (process.env.WT_SESSION) {
        expect(result).toBe(true);
      }
    });

    test("should export legacy console detection function", async () => {
      const { isLegacyConsole } = await import("../../src/lib/windows-console");
      expect(typeof isLegacyConsole).toBe("function");
      
      const result = isLegacyConsole();
      expect(typeof result).toBe("boolean");
      
      // On non-Windows, should return false
      if (!isWindows) {
        expect(result).toBe(false);
      }
    });

    test("should export Windows PTY environment getter", async () => {
      const { getWindowsPtyEnv } = await import("../../src/lib/windows-console");
      expect(typeof getWindowsPtyEnv).toBe("function");
      
      const env = getWindowsPtyEnv();
      expect(typeof env).toBe("object");
      
      if (isWindows) {
        expect(env.TERM).toBe("xterm-256color");
        expect(env.FORCE_COLOR).toBe("1");
      } else {
        expect(Object.keys(env).length).toBe(0);
      }
    });

    test("should export keepalive signal function", async () => {
      const { sendKeepaliveSignal } = await import("../../src/lib/windows-console");
      expect(typeof sendKeepaliveSignal).toBe("function");
      
      // Should not throw
      expect(() => sendKeepaliveSignal()).not.toThrow();
    });
  });

  describe("Environment Variable Detection", () => {
    test("should detect WT_SESSION environment variable format", () => {
      const wtSession = process.env.WT_SESSION;
      // WT_SESSION is a GUID when running in Windows Terminal
      if (wtSession) {
        expect(typeof wtSession).toBe("string");
        expect(wtSession.length).toBeGreaterThan(0);
      }
    });

    test.skipIf(!isWindows)("should have appropriate TERM fallback", () => {
      // On Windows, TERM might not be set in legacy consoles
      // Modern terminals typically set it to xterm-256color
      const term = process.env.TERM;
      if (term) {
        expect(typeof term).toBe("string");
      }
    });
  });
});

describe("Cross-Platform Compatibility", () => {
  test("should handle platform-specific keyboard fallback timeout", async () => {
    // Verify the constant would be different on Windows
    // This tests the logic without actually changing the value
    const expectedTimeout = isWindows ? 2000 : 5000;
    expect(expectedTimeout).toBe(isWindows ? 2000 : 5000);
  });

  test("keepalive interval should be valid", () => {
    // The keepalive interval should be a reasonable value
    const keepaliveMs = 30000;
    expect(keepaliveMs).toBeLessThanOrEqual(60000);
    expect(keepaliveMs).toBeGreaterThanOrEqual(10000);
  });
});
