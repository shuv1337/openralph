import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { detectCapabilities, _resetCapabilitiesCache, getCapabilities } from "../../src/lib/terminal-capabilities";
import { getIcon, ICON_SETS } from "../../src/lib/icon-fallback";
import { getColorPalette } from "../../src/lib/color-fallback";

describe("Terminal Fallback System", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.WT_SESSION;
    delete process.env.TERM_PROGRAM;
    delete process.env.ANSICON;
    delete process.env.ConEmuANSI;
    delete process.env.COLORTERM;
    delete process.env.LANG;
    process.env.TERM = "xterm-256color";
    _resetCapabilitiesCache();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("Capability Detection", () => {
    it("should detect Windows Terminal as truecolor and unicode capable", () => {
      process.env.WT_SESSION = "some-guid";
      const caps = getCapabilities();
      expect(caps.supportsTrueColor).toBe(true);
      expect(caps.supportsUnicode).toBe(true);
      expect(caps.isWindowsLegacy).toBe(false);
    });

    it("should detect legacy Windows CMD correctly", () => {
      process.env.TERM = "dumb";
      
      if (process.platform === 'win32') {
        const caps = getCapabilities();
        expect(caps.isWindowsLegacy).toBe(true);
        expect(caps.level).toBe("basic");
      }
    });
  });

  describe("Icon Fallbacks", () => {
    it("should return nerd icons when supported", () => {
      process.env.WT_SESSION = "some-guid";
      process.env.LANG = "en_US.UTF-8";
      
      const icon = getIcon(ICON_SETS.read);
      expect(icon).toBe(ICON_SETS.read.nerd);
    });

    it("should return ascii fallbacks on basic terminals", () => {
      process.env.TERM = "dumb";
      
      const icon = getIcon(ICON_SETS.read);
      const caps = getCapabilities();
      if (caps.level === 'basic' || !caps.supportsUnicode) {
        expect(icon).toBe(ICON_SETS.read.ascii);
      }
    });
  });

  describe("Color Palette", () => {
    it("should return truecolor palette when supported", () => {
      process.env.WT_SESSION = "some-guid";
      process.env.COLORTERM = "truecolor";
      const palette = getColorPalette();
      expect(palette.primary).toBe("#7aa2f7");
    });
  });
});
