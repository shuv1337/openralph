import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { detectCapabilities, resetCapabilitiesCache, type TerminalTier } from "../../src/lib/terminal-capabilities";
import { findProcessByPort, cleanupProcess, killProcess } from "../../src/lib/process-cleanup";

// CRITICAL: Clear module mocks before importing banner module (avoids pollution from other tests)
mock.restore();

import { renderBanner, getBannerForTier } from "../../src/lib/ascii-banner";

describe("Cross-Platform Compatibility Tests", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };
  const originalIsTTY = process.stdout.isTTY;
  const originalSpawn = globalThis.Bun.spawn;
  const originalKill = process.kill;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetCapabilitiesCache();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    process.env = { ...originalEnv };
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    // @ts-ignore
    globalThis.Bun.spawn = originalSpawn;
    // @ts-ignore
    process.kill = originalKill;
    resetCapabilitiesCache();
    mock.restore();
  });

  describe("Terminal Detection Compatibility", () => {
    it("SHOULD detect Windows cmd.exe correctly", () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      delete process.env.WT_SESSION;
      delete process.env.ANSICON;
      delete process.env.ConEmuANSI;
      delete process.env.TERM_PROGRAM;
      delete process.env.TERM;
      delete process.env.MSYSTEM;
      process.env.RALPH_MOCK_WINDOWS_VERSION = "legacy";

      const caps = detectCapabilities();
      expect(caps.isWindows).toBe(true);
      expect(caps.isWindowsLegacy).toBe(true);
      expect(caps.tier).toBe("legacy_windows" as TerminalTier);
    });

    it("SHOULD detect Windows Terminal correctly", () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      process.env.WT_SESSION = "some-session-id";
      delete process.env.CI;

      const caps = detectCapabilities();
      expect(caps.isWindows).toBe(true);
      expect(caps.isWindowsTerminal).toBe(true);
      expect(caps.supportsTrueColor).toBe(true);
      expect(caps.tier).toBe("full_feature" as TerminalTier);
    });

    it("SHOULD distinguish macOS Terminal.app from iTerm2", () => {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      
      // Test Terminal.app
      process.env.TERM_PROGRAM = "Apple_Terminal";
      let caps = detectCapabilities();
      expect(caps.isMacOS).toBe(true);
      expect(caps.isTerminalApp).toBe(true);
      expect(caps.supportsTrueColor).toBe(false); // Spec says Terminal.app doesn't support truecolor reliably

      resetCapabilitiesCache();
      
      // Test iTerm2
      process.env.TERM_PROGRAM = "iTerm.app";
      caps = detectCapabilities();
      expect(caps.isITerm2).toBe(true);
      expect(caps.supportsTrueColor).toBe(true);
    });

    it("SHOULD detect CI environment and disable interactivity", () => {
      process.env.GITHUB_ACTIONS = "true";
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

      const caps = detectCapabilities();
      expect(caps.isCI).toBe(true);
      expect(caps.ciPlatform).toBe("github_actions");
      expect(caps.isInteractive).toBe(false);
    });
  });

  describe("Process Cleanup Compatibility", () => {
    it("SHOULD use taskkill on Windows", async () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      
      const spawnMock = mock((cmd: string[]) => {
        return {
          exited: Promise.resolve(0),
          exitCode: 0,
          stdout: new ReadableStream({ start(c) { c.close(); } }),
          stderr: new ReadableStream({ start(c) { c.close(); } }),
        };
      });
      // @ts-ignore
      globalThis.Bun.spawn = spawnMock;

      await killProcess(1234, true);
      
      const calls = spawnMock.mock.calls;
      const taskkillCall = calls.find(call => call[0][0] === "taskkill");
      expect(taskkillCall).toBeDefined();
      expect(taskkillCall![0]).toContain("/F");
      expect(taskkillCall![0]).toContain("/T");
      expect(taskkillCall![0]).toContain("1234");
    });

    it("SHOULD use SIGKILL on Unix for forced kill", async () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      
      const killSpy = spyOn(process, "kill").mockImplementation(() => true);

      await killProcess(1234, true);
      
      expect(killSpy).toHaveBeenCalledWith(1234, "SIGKILL");
    });

    it("SHOULD use SIGTERM on Unix for graceful kill", async () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      
      const killSpy = spyOn(process, "kill").mockImplementation(() => true);

      await killProcess(1234, false);
      
      expect(killSpy).toHaveBeenCalledWith(1234, "SIGTERM");
    });

    it("SHOULD use lsof/ss on Linux for port detection", async () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      
      const spawnMock = mock((cmd: string[]) => {
        return {
          exited: Promise.resolve(0),
          exitCode: 0,
          stdout: new ReadableStream({ 
            start(c) { 
              c.enqueue(new TextEncoder().encode("1234"));
              c.close(); 
            } 
          }),
          stderr: new ReadableStream({ start(c) { c.close(); } }),
        };
      });
      // @ts-ignore
      globalThis.Bun.spawn = spawnMock;

      await findProcessByPort(8080);
      
      const calls = spawnMock.mock.calls;
      // Should try lsof first
      expect(calls[0][0][0]).toBe("lsof");
    });
  });

  describe("ASCII Banner Compatibility", () => {
    it("SHOULD respect NO_COLOR across platforms", () => {
      process.env.NO_COLOR = "1";
      
      const banner = renderBanner();
      // Banner should not contain ANSI color codes
      expect(banner).not.toContain("\x1b[38;2;");
      expect(banner).not.toContain("\x1b[38;5;");
      expect(banner).not.toContain("\x1b[31m");
    });

    it("SHOULD use plain style for legacy windows", () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      delete process.env.WT_SESSION;
      delete process.env.ANSICON;
      delete process.env.ConEmuANSI;
      delete process.env.TERM_PROGRAM;
      delete process.env.TERM;
      delete process.env.MSYSTEM;
      process.env.RALPH_MOCK_WINDOWS_VERSION = "legacy";
      resetCapabilitiesCache();

      const banner = renderBanner();
      // Legacy windows uses PLAIN_BANNER which contains "=== OpenRalph ==="
      expect(banner).toContain("=== OpenRalph ===");
    });

    it("SHOULD use block characters only on supported tiers", () => {
      const truecolorBanner = getBannerForTier("truecolor");
      const legacyBanner = getBannerForTier("legacy_windows");

      // Block character ██ is used in FILLED_BANNER
      expect(truecolorBanner).toContain("█");
      expect(legacyBanner).not.toContain("█");
    });
  });
});
