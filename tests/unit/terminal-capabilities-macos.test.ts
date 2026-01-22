import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { detectCapabilities, resetCapabilitiesCache } from "../../src/lib/terminal-capabilities";

describe("terminal-capabilities - macOS", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    resetCapabilitiesCache();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    process.env = { ...originalEnv };
    resetCapabilitiesCache();
  });

  describe("macOS terminal detection", () => {
    it("SHOULD detect Terminal.app via TERM_PROGRAM", () => {
      process.env.TERM_PROGRAM = "Apple_Terminal";
      const caps = detectCapabilities();
      expect(caps.isMacOS).toBe(true);
      expect(caps.isTerminalApp).toBe(true);
      expect(caps.isITerm2).toBe(false);
    });

    it("SHOULD detect iTerm2 via TERM_PROGRAM", () => {
      process.env.TERM_PROGRAM = "iTerm.app";
      const caps = detectCapabilities();
      expect(caps.isMacOS).toBe(true);
      expect(caps.isITerm2).toBe(true);
      expect(caps.isTerminalApp).toBe(false);
    });

    it("SHOULD detect Ghostty via TERM_PROGRAM", () => {
      process.env.TERM_PROGRAM = "ghostty";
      const caps = detectCapabilities();
      expect(caps.isGhostty).toBe(true);
    });

    it("SHOULD detect Ghostty via GHOSTTY_RESOURCES_DIR", () => {
      delete process.env.TERM_PROGRAM;
      process.env.GHOSTTY_RESOURCES_DIR = "/some/path";
      const caps = detectCapabilities();
      expect(caps.isGhostty).toBe(true);
    });

    it("SHOULD mark Terminal.app as not supporting keyboard enhancement", () => {
      process.env.TERM_PROGRAM = "Apple_Terminal";
      const caps = detectCapabilities();
      expect(caps.supportsKeyboardEnhancement).toBe(false);
    });

    it("SHOULD mark iTerm2 as supporting keyboard enhancement", () => {
      process.env.TERM_PROGRAM = "iTerm.app";
      const caps = detectCapabilities();
      expect(caps.supportsKeyboardEnhancement).toBe(true);
    });

    it("SHOULD mark Terminal.app as supporting 256 colors but maybe not truecolor by default", () => {
        process.env.TERM_PROGRAM = "Apple_Terminal";
        process.env.TERM = "xterm-256color";
        delete process.env.COLORTERM;
        const caps = detectCapabilities();
        expect(caps.level).toBe("256");
        expect(caps.supportsTrueColor).toBe(false);
    });

    it("SHOULD detect Alacritty on macOS", () => {
      process.env.TERM_PROGRAM = "Alacritty";
      const caps = detectCapabilities();
      expect(caps.isAlacritty).toBe(true);
      expect(caps.supportsTrueColor).toBe(true);
      expect(caps.supportsKeyboardEnhancement).toBe(true);
    });

    it("SHOULD detect WezTerm on macOS", () => {
      process.env.TERM_PROGRAM = "WezTerm";
      const caps = detectCapabilities();
      expect(caps.isWezTerm).toBe(true);
      expect(caps.supportsTrueColor).toBe(true);
      expect(caps.supportsKeyboardEnhancement).toBe(true);
    });

    it("SHOULD fallback to basic if TERM is dumb", () => {
      process.env.TERM = "dumb";
      const caps = detectCapabilities();
      expect(caps.level).toBe("basic");
      expect(caps.supportsAnimation).toBe(false);
    });
  });
});
