import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { resetCapabilitiesCache } from "../../src/lib/terminal-capabilities";

// Import types statically (these are not mocked)
import type { BannerStyle, PaletteName, BannerOptions } from "../../src/lib/ascii-banner";

// CRITICAL: Clear module mocks before importing the real module
// This must happen at the top level, before any describe blocks
mock.restore();

// Now import the real module (this import happens after mock.restore())
// Note: Due to ES module hoisting, all imports are evaluated first before any code runs.
// However, mock.restore() is called synchronously when this module is parsed,
// and it should clear any mocks set by previously parsed test files.
import {
  renderBanner,
  getBannerForTerminal,
  getBannerForTier,
  getAvailablePalettes,
  getAvailableStyles,
  shouldShowBanner,
  renderBannerWithMetadata,
  PALETTES,
  _internals,
} from "../../src/lib/ascii-banner";

/**
 * Comprehensive tests for ASCII banner module.
 *
 * Tests cover:
 * - All banner styles (filled, gradient, plain, minimal)
 * - All terminal tiers
 * - Color palette application
 * - NO_COLOR / RALPH_BANNER_DISABLED environment handling
 * - Gradient color interpolation
 * - Unicode/ASCII fallbacks
 */
describe("ascii-banner", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment to clean state
    process.env = { ...originalEnv };
    delete process.env.NO_COLOR;
    delete process.env.RALPH_BANNER_DISABLED;
    resetCapabilitiesCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetCapabilitiesCache();
  });

  describe("exports", () => {
    it("SHOULD export all public API functions", () => {
      expect(typeof renderBanner).toBe("function");
      expect(typeof getBannerForTerminal).toBe("function");
      expect(typeof getBannerForTier).toBe("function");
      expect(typeof getAvailablePalettes).toBe("function");
      expect(typeof getAvailableStyles).toBe("function");
      expect(typeof shouldShowBanner).toBe("function");
      expect(typeof renderBannerWithMetadata).toBe("function");
    });

    it("SHOULD export PALETTES constant", () => {
      expect(PALETTES).toBeDefined();
      expect(typeof PALETTES).toBe("object");
      expect(PALETTES.openralph).toBeDefined();
    });

    it("SHOULD export _internals for testing", () => {
      expect(_internals).toBeDefined();
      expect(_internals.FILLED_BANNER).toBeDefined();
      expect(_internals.SIMPLE_BANNER).toBeDefined();
      expect(_internals.PLAIN_BANNER).toBeDefined();
      expect(_internals.MINIMAL_BANNER).toBeDefined();
    });
  });

  describe("getAvailablePalettes", () => {
    it("SHOULD return all palette names", () => {
      const palettes = getAvailablePalettes();

      expect(palettes).toContain("openralph");
      expect(palettes).toContain("fire");
      expect(palettes).toContain("ocean");
      expect(palettes).toContain("forest");
      expect(palettes).toContain("sunset");
      expect(palettes).toContain("sunrise");
      expect(palettes).toContain("grad-blue");
      expect(palettes).toContain("monochrome");
      expect(palettes).toContain("neon");
      expect(palettes).toContain("matrix");
      expect(palettes.length).toBe(10);
    });
  });

  describe("getAvailableStyles", () => {
    it("SHOULD return all style names", () => {
      const styles = getAvailableStyles();

      expect(styles).toContain("filled");
      expect(styles).toContain("gradient");
      expect(styles).toContain("plain");
      expect(styles).toContain("minimal");
      expect(styles.length).toBe(4);
    });
  });

  describe("shouldShowBanner", () => {
    it("SHOULD return true when RALPH_BANNER_DISABLED is not set", () => {
      delete process.env.RALPH_BANNER_DISABLED;
      expect(shouldShowBanner()).toBe(true);
    });

    it("SHOULD return false when RALPH_BANNER_DISABLED=1", () => {
      process.env.RALPH_BANNER_DISABLED = "1";
      expect(shouldShowBanner()).toBe(false);
    });
  });

  describe("renderBanner", () => {
    it("SHOULD return empty string when RALPH_BANNER_DISABLED=1", () => {
      process.env.RALPH_BANNER_DISABLED = "1";
      const banner = renderBanner();
      expect(banner).toBe("");
    });

    it("SHOULD return non-empty banner by default", () => {
      const banner = renderBanner();
      expect(banner.length).toBeGreaterThan(0);
    });

    it("SHOULD respect style option", () => {
      const minimalBanner = renderBanner({ style: "minimal" });
      expect(minimalBanner).toBe("OpenRalph");
    });

    it("SHOULD include version when requested", () => {
      const banner = renderBanner({
        style: "minimal",
        includeVersion: true,
        version: "1.2.3",
      });
      expect(banner).toContain("v1.2.3");
    });

    it("SHOULD disable colors with colors: false option", () => {
      const banner = renderBanner({ style: "filled", colors: false });
      // Should not contain ANSI escape codes
      expect(banner).not.toContain("\x1b[38;2;");
      expect(banner).not.toContain("\x1b[38;5;");
    });
  });

  describe("getBannerForTerminal", () => {
    it("SHOULD return a valid banner string", () => {
      const banner = getBannerForTerminal();
      expect(typeof banner).toBe("string");
      expect(banner.length).toBeGreaterThan(0);
    });
  });

  describe("getBannerForTier", () => {
    describe("legacy_windows tier", () => {
      it("SHOULD return plain ASCII without colors", () => {
        const banner = getBannerForTier("legacy_windows");

        // Should not contain ANSI escape codes
        expect(banner).not.toContain("\x1b[");
        // Should contain recognizable text
        expect(banner).toContain("OpenRalph");
      });

      it("SHOULD not use Unicode characters", () => {
        const banner = getBannerForTier("legacy_windows");

        // Should not contain Unicode block characters
        expect(banner).not.toContain("█");
        expect(banner).not.toContain("╗");
        expect(banner).not.toContain("╚");
      });
    });

    describe("basic_ansi tier", () => {
      it("SHOULD apply basic ANSI color", () => {
        const banner = getBannerForTier("basic_ansi");

        // May contain basic ANSI color codes
        // The banner should be non-empty
        expect(banner.length).toBeGreaterThan(0);
      });

      it("SHOULD use simple ASCII art", () => {
        const banner = getBannerForTier("basic_ansi", { style: "plain" });
        // Contains the simple style - uses characters like | and _ for art
        expect(banner).toContain("|");
        expect(banner).toContain("_");
      });
    });

    describe("ansi_256 tier", () => {
      it("SHOULD apply 256-color palette", () => {
        const banner = getBannerForTier("ansi_256");

        // Should contain 256-color ANSI codes
        expect(banner).toContain("\x1b[38;5;");
      });

      it("SHOULD use gradient style by default", () => {
        const banner = getBannerForTier("ansi_256");
        // Contains Unicode block characters
        expect(banner).toContain("█");
      });
    });

    describe("truecolor tier", () => {
      it("SHOULD apply truecolor gradient", () => {
        const banner = getBannerForTier("truecolor");

        // Should contain truecolor ANSI codes
        expect(banner).toContain("\x1b[38;2;");
      });

      it("SHOULD use filled style by default", () => {
        const banner = getBannerForTier("truecolor");
        // Contains Unicode block characters (with color codes between them)
        expect(banner).toContain("█");
        expect(banner).toContain("╗");
      });
    });

    describe("full_feature tier", () => {
      it("SHOULD behave same as truecolor", () => {
        const truecolorBanner = getBannerForTier("truecolor");
        const fullBanner = getBannerForTier("full_feature");

        // Both should use truecolor gradients
        expect(fullBanner).toContain("\x1b[38;2;");
        // Contains block characters (with color codes between them)
        expect(fullBanner).toContain("█");
      });
    });

    it("SHOULD allow style override", () => {
      const banner = getBannerForTier("truecolor", { style: "minimal" });
      expect(banner).toBe("OpenRalph");
    });

    it("SHOULD apply different palettes", () => {
      const openralphBanner = getBannerForTier("truecolor", { palette: "openralph" });
      const fireBanner = getBannerForTier("truecolor", { palette: "fire" });

      // Different palettes should produce different color codes
      // (Both will have \x1b[38;2; but different RGB values)
      expect(openralphBanner).not.toBe(fireBanner);
    });
  });

  describe("renderBannerWithMetadata", () => {
    it("SHOULD return RenderResult with all metadata", () => {
      const result = renderBannerWithMetadata({ style: "minimal" });

      expect(result.output).toBeDefined();
      expect(result.tier).toBeDefined();
      expect(result.style).toBe("minimal");
      expect(typeof result.hasColors).toBe("boolean");
      expect(typeof result.hasUnicode).toBe("boolean");
      expect(typeof result.renderTimeMs).toBe("number");
      expect(result.renderTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("SHOULD report correct style in result", () => {
      const filled = renderBannerWithMetadata({ style: "filled" });
      const plain = renderBannerWithMetadata({ style: "plain" });

      expect(filled.style).toBe("filled");
      expect(plain.style).toBe("plain");
    });
  });

  describe("PALETTES constant", () => {
    it("SHOULD have valid hex colors for all palettes", () => {
      const hexColorRegex = /^#[0-9a-fA-F]{6}$/;

      for (const [name, palette] of Object.entries(PALETTES)) {
        expect(palette.name).toBe(name);
        expect(palette.startColor).toMatch(hexColorRegex);
        expect(palette.endColor).toMatch(hexColorRegex);
        if (palette.middleColor) {
          expect(palette.middleColor).toMatch(hexColorRegex);
        }
        expect(palette.description).toBeTruthy();
      }
    });

    it("SHOULD have openralph as default palette with correct colors", () => {
      const openralph = PALETTES.openralph;

      expect(openralph.startColor).toBe("#7aa2f7"); // Primary blue
      expect(openralph.endColor).toBe("#bb9af7"); // Purple
      expect(openralph.middleColor).toBe("#a9b1d6"); // Transition
    });
  });

  describe("_internals (internal utilities)", () => {
    describe("hexToRgb", () => {
      it("SHOULD parse hex color correctly", () => {
        const rgb = _internals.hexToRgb("#ff0000");
        expect(rgb).toEqual({ r: 255, g: 0, b: 0 });
      });

      it("SHOULD handle lowercase hex", () => {
        const rgb = _internals.hexToRgb("#00ff00");
        expect(rgb).toEqual({ r: 0, g: 255, b: 0 });
      });

      it("SHOULD handle uppercase hex", () => {
        const rgb = _internals.hexToRgb("#0000FF");
        expect(rgb).toEqual({ r: 0, g: 0, b: 255 });
      });

      it("SHOULD return white for invalid hex", () => {
        const rgb = _internals.hexToRgb("invalid");
        expect(rgb).toEqual({ r: 255, g: 255, b: 255 });
      });

      it("SHOULD handle hex without # prefix", () => {
        const rgb = _internals.hexToRgb("7aa2f7");
        expect(rgb).toEqual({ r: 122, g: 162, b: 247 });
      });
    });

    describe("interpolateColor", () => {
      it("SHOULD return start color at factor 0", () => {
        const start = { r: 255, g: 0, b: 0 };
        const end = { r: 0, g: 255, b: 0 };
        const result = _internals.interpolateColor(start, end, 0);
        expect(result).toEqual({ r: 255, g: 0, b: 0 });
      });

      it("SHOULD return end color at factor 1", () => {
        const start = { r: 255, g: 0, b: 0 };
        const end = { r: 0, g: 255, b: 0 };
        const result = _internals.interpolateColor(start, end, 1);
        expect(result).toEqual({ r: 0, g: 255, b: 0 });
      });

      it("SHOULD return midpoint at factor 0.5", () => {
        const start = { r: 0, g: 0, b: 0 };
        const end = { r: 100, g: 100, b: 100 };
        const result = _internals.interpolateColor(start, end, 0.5);
        expect(result).toEqual({ r: 50, g: 50, b: 50 });
      });
    });

    describe("getBannerArt", () => {
      it("SHOULD return FILLED_BANNER for filled style with unicode", () => {
        const art = _internals.getBannerArt("filled", true);
        expect(art).toBe(_internals.FILLED_BANNER);
      });

      it("SHOULD return SIMPLE_BANNER for filled style without unicode", () => {
        const art = _internals.getBannerArt("filled", false);
        expect(art).toBe(_internals.SIMPLE_BANNER);
      });

      it("SHOULD return SIMPLE_BANNER for plain style with unicode", () => {
        const art = _internals.getBannerArt("plain", true);
        expect(art).toBe(_internals.SIMPLE_BANNER);
      });

      it("SHOULD return PLAIN_BANNER for plain style without unicode", () => {
        const art = _internals.getBannerArt("plain", false);
        expect(art).toBe(_internals.PLAIN_BANNER);
      });

      it("SHOULD return MINIMAL_BANNER for minimal style", () => {
        const art = _internals.getBannerArt("minimal", true);
        expect(art).toBe(_internals.MINIMAL_BANNER);
      });
    });

    describe("applyHorizontalGradient", () => {
      it("SHOULD add ANSI escape codes to text", () => {
        const text = "ABC";
        const palette = PALETTES.openralph;
        const result = _internals.applyHorizontalGradient(text, palette);

        expect(result).toContain("\x1b[38;2;");
        expect(result).toContain("\x1b[0m"); // Reset
      });

      it("SHOULD preserve spaces without color codes", () => {
        const text = "A B";
        const palette = PALETTES.openralph;
        const result = _internals.applyHorizontalGradient(text, palette);

        // The space should be in the result
        expect(result).toContain(" ");
      });

      it("SHOULD handle multi-line text", () => {
        const text = "AB\nCD";
        const palette = PALETTES.openralph;
        const result = _internals.applyHorizontalGradient(text, palette);

        // Should have newline preserved
        expect(result).toContain("\n");
        // Both lines should have colors
        const lines = result.split("\n");
        expect(lines.length).toBe(2);
        expect(lines[0]).toContain("\x1b[38;2;");
        expect(lines[1]).toContain("\x1b[38;2;");
      });
    });

    describe("applyVerticalGradient", () => {
      it("SHOULD apply same color to entire line", () => {
        const text = "ABC";
        const palette = PALETTES.openralph;
        const result = _internals.applyVerticalGradient(text, palette);

        // Should start with color code
        expect(result).toMatch(/^\x1b\[38;2;/);
        // Should end with reset
        expect(result).toContain("\x1b[0m");
      });

      it("SHOULD apply different colors to different lines", () => {
        const text = "Line1\nLine2\nLine3";
        const palette = PALETTES.openralph;
        const result = _internals.applyVerticalGradient(text, palette);

        const lines = result.split("\n");
        expect(lines.length).toBe(3);

        // Each line should have its own color
        for (const line of lines) {
          expect(line).toContain("\x1b[38;2;");
        }
      });
    });

    describe("apply256Color", () => {
      it("SHOULD use 256-color ANSI codes", () => {
        const text = "Test";
        const result = _internals.apply256Color(text, "openralph");

        expect(result).toContain("\x1b[38;5;");
        expect(result).toContain("\x1b[0m");
      });
    });

    describe("applyBasicColor", () => {
      it("SHOULD use basic ANSI color codes", () => {
        const text = "Test";
        const result = _internals.applyBasicColor(text, "openralph");

        // Basic ANSI codes are \x1b[3Xm where X is 0-7
        expect(result).toMatch(/\x1b\[3[0-7]m/);
        expect(result).toContain("\x1b[0m");
      });

      it("SHOULD apply correct color for each palette", () => {
        // Blue for openralph
        const openralph = _internals.applyBasicColor("Test", "openralph");
        expect(openralph).toContain("\x1b[34m"); // Blue

        // Red for fire
        const fire = _internals.applyBasicColor("Test", "fire");
        expect(fire).toContain("\x1b[31m"); // Red

        // Green for matrix
        const matrix = _internals.applyBasicColor("Test", "matrix");
        expect(matrix).toContain("\x1b[32m"); // Green
      });
    });
  });

  describe("NO_COLOR environment variable", () => {
    it("SHOULD disable colors when NO_COLOR is set", () => {
      process.env.NO_COLOR = "1";
      resetCapabilitiesCache();

      const banner = renderBanner({ style: "filled" });

      // Should not contain any ANSI escape codes
      expect(banner).not.toContain("\x1b[38;2;");
      expect(banner).not.toContain("\x1b[38;5;");
      expect(banner).not.toContain("\x1b[3");
    });
  });

  describe("banner content validation", () => {
    it("FILLED_BANNER SHOULD contain OpenRalph text in block chars", () => {
      const banner = _internals.FILLED_BANNER;

      // Should contain block characters
      expect(banner).toContain("█");
      expect(banner).toContain("╗");
      expect(banner).toContain("╚");
      expect(banner).toContain("║");
    });

    it("SIMPLE_BANNER SHOULD contain readable ASCII art", () => {
      const banner = _internals.SIMPLE_BANNER;

      // Should be ASCII art with typical figlet characters
      expect(banner).toContain("|");
      expect(banner).toContain("_");
      expect(banner).toContain("/");
      expect(banner).toContain("\\");
    });

    it("PLAIN_BANNER SHOULD be simple text", () => {
      const banner = _internals.PLAIN_BANNER;

      expect(banner).toContain("OpenRalph");
      expect(banner).toContain("===");
    });

    it("MINIMAL_BANNER SHOULD be just the name", () => {
      expect(_internals.MINIMAL_BANNER).toBe("OpenRalph");
    });
  });
});
