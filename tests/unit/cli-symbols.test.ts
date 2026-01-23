import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  STATUS_SYMBOLS,
  ARROW_SYMBOLS,
  BOX_SYMBOLS,
  BLOCK_SYMBOLS,
  TOOL_TYPE_SYMBOLS,
  MISC_SYMBOLS,
  TOOL_SYMBOLS,
  getSymbol,
  getSymbolStyle,
  getStatusSymbol,
  getToolTypeSymbol,
  getArrowSymbol,
  getBoxSymbol,
  getBlockSymbol,
  getToolSymbol,
  formatToolPrefix,
  formatStatusIndicator,
  formatProgressBar,
  formatSeparator,
  type SymbolStyle,
} from "../../src/lib/cli-symbols";
import { resetCapabilitiesCache } from "../../src/lib/terminal-capabilities";

describe("CLI Symbols - Symbol Sets", () => {
  describe("STATUS_SYMBOLS", () => {
    it("should have all required status symbols", () => {
      const requiredSymbols = [
        "success",
        "error",
        "warning",
        "info",
        "neutral",
        "running",
        "pending",
        "paused",
        "complete",
        "stopped",
        "active",
        "waiting",
      ];

      for (const symbol of requiredSymbols) {
        expect(STATUS_SYMBOLS[symbol]).toBeDefined();
        expect(STATUS_SYMBOLS[symbol].unicode).toBeDefined();
        expect(STATUS_SYMBOLS[symbol].ascii).toBeDefined();
      }
    });

    it("should have monospace-compatible unicode symbols", () => {
      // These should all be single-width characters, not emojis
      for (const [name, symbolSet] of Object.entries(STATUS_SYMBOLS)) {
        // Verify unicode symbols don't contain common emoji patterns
        expect(symbolSet.unicode).not.toMatch(/[\u{1F000}-\u{1FFFF}]/u);
        // ASCII should be printable ASCII characters
        expect(symbolSet.ascii).toMatch(/^[\x20-\x7E]+$/);
      }
    });
  });

  describe("ARROW_SYMBOLS", () => {
    it("should have all arrow and pointer symbols", () => {
      const requiredSymbols = [
        "right",
        "left",
        "up",
        "down",
        "pointer",
        "pointerSmall",
        "bullet",
        "dot",
      ];

      for (const symbol of requiredSymbols) {
        expect(ARROW_SYMBOLS[symbol]).toBeDefined();
        expect(ARROW_SYMBOLS[symbol].unicode).toBeDefined();
        expect(ARROW_SYMBOLS[symbol].ascii).toBeDefined();
      }
    });
  });

  describe("BOX_SYMBOLS", () => {
    it("should have all box-drawing symbols", () => {
      const requiredSymbols = [
        "horizontal",
        "vertical",
        "topLeft",
        "topRight",
        "bottomLeft",
        "bottomRight",
        "teeRight",
        "teeLeft",
        "teeDown",
        "teeUp",
        "cross",
        "horizontalDouble",
        "verticalDouble",
      ];

      for (const symbol of requiredSymbols) {
        expect(BOX_SYMBOLS[symbol]).toBeDefined();
      }
    });
  });

  describe("BLOCK_SYMBOLS", () => {
    it("should have block element symbols", () => {
      const requiredSymbols = [
        "full",
        "light",
        "medium",
        "dark",
        "leftHalf",
        "rightHalf",
        "topHalf",
        "bottomHalf",
      ];

      for (const symbol of requiredSymbols) {
        expect(BLOCK_SYMBOLS[symbol]).toBeDefined();
      }
    });
  });

  describe("TOOL_TYPE_SYMBOLS", () => {
    it("should have all tool operation symbols", () => {
      const requiredSymbols = [
        "read",
        "write",
        "edit",
        "bash",
        "exec",
        "search",
        "glob",
        "grep",
        "task",
        "taskDone",
        "todo",
        "think",
        "thought",
        "lsp",
        "mcp",
        "plugin",
        "web",
        "fetch",
        "api",
        "git",
        "github",
        "tool",
        "custom",
        "skill",
      ];

      for (const symbol of requiredSymbols) {
        expect(TOOL_TYPE_SYMBOLS[symbol]).toBeDefined();
        expect(TOOL_TYPE_SYMBOLS[symbol].unicode).toBeDefined();
        expect(TOOL_TYPE_SYMBOLS[symbol].ascii).toBeDefined();
      }
    });

    it("should NOT use emoji characters", () => {
      for (const [name, symbolSet] of Object.entries(TOOL_TYPE_SYMBOLS)) {
        // Check that unicode doesn't contain emoji ranges
        // Basic emoji range check (not exhaustive but catches common cases)
        expect(symbolSet.unicode).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
        expect(symbolSet.unicode).not.toMatch(/[\u{1F600}-\u{1F64F}]/u);
        expect(symbolSet.unicode).not.toMatch(/[\u{1F680}-\u{1F6FF}]/u);
      }
    });
  });

  describe("TOOL_SYMBOLS", () => {
    it("should have mappings for all 21+ tools", () => {
      const requiredTools = [
        "read",
        "write",
        "edit",
        "bash",
        "glob",
        "grep",
        "codesearch",
        "task",
        "todowrite",
        "todoread",
        "thought",
        "lsp",
        "websearch",
        "webfetch",
        "mcp",
        "tavily",
        "context7",
        "exa",
        "brave",
        "gh",
        "github",
        "custom",
        "skill",
      ];

      for (const tool of requiredTools) {
        expect(TOOL_SYMBOLS[tool]).toBeDefined();
      }
    });
  });
});

describe("CLI Symbols - Symbol Resolution", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetCapabilitiesCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetCapabilitiesCache();
  });

  describe("getSymbol", () => {
    it("should return unicode when style is unicode", () => {
      const result = getSymbol(STATUS_SYMBOLS.success, "unicode");
      expect(result).toBe("✓");
    });

    it("should return ascii when style is ascii", () => {
      const result = getSymbol(STATUS_SYMBOLS.success, "ascii");
      expect(result).toBe("+");
    });
  });

  describe("getStatusSymbol", () => {
    it("should return correct symbols for success", () => {
      expect(getStatusSymbol("success", "unicode")).toBe("✓");
      expect(getStatusSymbol("success", "ascii")).toBe("+");
    });

    it("should return correct symbols for error", () => {
      expect(getStatusSymbol("error", "unicode")).toBe("✗");
      expect(getStatusSymbol("error", "ascii")).toBe("x");
    });

    it("should return correct symbols for running", () => {
      expect(getStatusSymbol("running", "unicode")).toBe("●");
      expect(getStatusSymbol("running", "ascii")).toBe("*");
    });
  });

  describe("getToolTypeSymbol", () => {
    it("should return correct symbol for bash", () => {
      expect(getToolTypeSymbol("bash", "unicode")).toBe("$");
      expect(getToolTypeSymbol("bash", "ascii")).toBe("$");
    });

    it("should return correct symbol for read", () => {
      expect(getToolTypeSymbol("read", "unicode")).toBe("◀");
      expect(getToolTypeSymbol("read", "ascii")).toBe("<");
    });

    it("should return fallback for unknown tools", () => {
      expect(getToolTypeSymbol("unknownTool", "unicode")).toBe("◆");
      expect(getToolTypeSymbol("unknownTool", "ascii")).toBe("*");
    });

    it("should be case-insensitive", () => {
      expect(getToolTypeSymbol("BASH", "unicode")).toBe("$");
      expect(getToolTypeSymbol("Read", "unicode")).toBe("◀");
    });
  });

  describe("getArrowSymbol", () => {
    it("should return correct arrow symbols", () => {
      expect(getArrowSymbol("right", "unicode")).toBe("→");
      expect(getArrowSymbol("right", "ascii")).toBe("->");
      expect(getArrowSymbol("pointer", "unicode")).toBe("❯");
      expect(getArrowSymbol("pointer", "ascii")).toBe(">");
    });
  });

  describe("getBoxSymbol", () => {
    it("should return correct box-drawing symbols", () => {
      expect(getBoxSymbol("horizontal", "unicode")).toBe("─");
      expect(getBoxSymbol("horizontal", "ascii")).toBe("-");
      expect(getBoxSymbol("horizontalDouble", "unicode")).toBe("═");
      expect(getBoxSymbol("horizontalDouble", "ascii")).toBe("=");
    });
  });

  describe("getBlockSymbol", () => {
    it("should return correct block symbols", () => {
      expect(getBlockSymbol("full", "unicode")).toBe("█");
      expect(getBlockSymbol("full", "ascii")).toBe("#");
      expect(getBlockSymbol("light", "unicode")).toBe("░");
      expect(getBlockSymbol("light", "ascii")).toBe(".");
    });
  });

  describe("getToolSymbol", () => {
    it("should return correct tool symbols", () => {
      expect(getToolSymbol("bash", "unicode")).toBe("$");
      expect(getToolSymbol("read", "unicode")).toBe("◀");
      expect(getToolSymbol("edit", "unicode")).toBe("◇");
    });

    it("should handle MCP tool patterns", () => {
      // tavily_search -> should use tavily symbol
      expect(getToolSymbol("tavily_search", "unicode")).toBe("◉");
      // context7_query -> should use context7 symbol
      expect(getToolSymbol("context7_query", "unicode")).toBe("⬡");
    });

    it("should fallback for unknown MCP servers", () => {
      // unknown_action -> should use MCP symbol
      expect(getToolSymbol("unknown_action", "unicode")).toBe("⬡");
    });
  });
});

describe("CLI Symbols - Formatting Helpers", () => {
  describe("formatToolPrefix", () => {
    it("should format known tools correctly", () => {
      expect(formatToolPrefix("bash", "unicode")).toBe("[$]");
      expect(formatToolPrefix("read", "unicode")).toBe("[◀]");
      expect(formatToolPrefix("edit", "unicode")).toBe("[◇]");
    });

    it("should handle MCP tools", () => {
      // MCP tools use server-specific symbols from TOOL_SYMBOLS
      expect(formatToolPrefix("tavily_search", "unicode")).toBe("[◉]");
      expect(formatToolPrefix("context7_query", "unicode")).toBe("[⬡]");
    });

    it("should fallback for unknown tools", () => {
      expect(formatToolPrefix("myCustomTool", "unicode")).toBe("[◆]");
    });

    it("should work with ASCII style", () => {
      expect(formatToolPrefix("bash", "ascii")).toBe("[$]");
      expect(formatToolPrefix("read", "ascii")).toBe("[<]");
    });
  });

  describe("formatStatusIndicator", () => {
    it("should format status indicators", () => {
      expect(formatStatusIndicator("success", "unicode")).toBe("[✓]");
      expect(formatStatusIndicator("error", "unicode")).toBe("[✗]");
      expect(formatStatusIndicator("running", "unicode")).toBe("[●]");
    });

    it("should work with ASCII style", () => {
      expect(formatStatusIndicator("success", "ascii")).toBe("[+]");
      expect(formatStatusIndicator("error", "ascii")).toBe("[x]");
    });
  });

  describe("formatProgressBar", () => {
    it("should format progress bar at 0%", () => {
      const result = formatProgressBar(0, 10, "unicode");
      expect(result).toBe("[░░░░░░░░░░]");
    });

    it("should format progress bar at 50%", () => {
      const result = formatProgressBar(0.5, 10, "unicode");
      expect(result).toBe("[█████░░░░░]");
    });

    it("should format progress bar at 100%", () => {
      const result = formatProgressBar(1, 10, "unicode");
      expect(result).toBe("[██████████]");
    });

    it("should work with ASCII style", () => {
      const result = formatProgressBar(0.5, 10, "ascii");
      expect(result).toBe("[#####.....]");
    });

    it("should clamp values outside 0-1 range", () => {
      expect(formatProgressBar(-0.5, 10, "unicode")).toBe("[░░░░░░░░░░]");
      expect(formatProgressBar(1.5, 10, "unicode")).toBe("[██████████]");
    });
  });

  describe("formatSeparator", () => {
    it("should format separator without text", () => {
      const result = formatSeparator(20, undefined, "unicode");
      expect(result).toBe("────────────────────");
      expect(result.length).toBe(20);
    });

    it("should format separator with text", () => {
      const result = formatSeparator(30, "Test", "unicode");
      expect(result).toContain("Test");
      expect(result).toContain("──");
    });

    it("should work with ASCII style", () => {
      const result = formatSeparator(20, undefined, "ascii");
      expect(result).toBe("--------------------");
    });
  });
});

describe("CLI Symbols - No Emoji Guarantee", () => {
  it("should not contain any emoji characters in unicode symbols", () => {
    // Comprehensive check of all symbol sets
    const allSymbolSets = [
      STATUS_SYMBOLS,
      ARROW_SYMBOLS,
      BOX_SYMBOLS,
      BLOCK_SYMBOLS,
      TOOL_TYPE_SYMBOLS,
      MISC_SYMBOLS,
    ];

    // Emoji ranges to check (common ranges that should NOT appear in CLI symbols)
    // Note: We exclude U+2600-U+26FF since it contains useful terminal symbols like ☐
    const emojiPatterns = [
      /[\u{1F300}-\u{1F9FF}]/u, // Miscellaneous Symbols and Pictographs, Emoticons
      /[\u{1F600}-\u{1F64F}]/u, // Emoticons
      /[\u{1F680}-\u{1F6FF}]/u, // Transport and Map Symbols
      /[\u{FE00}-\u{FE0F}]/u,   // Variation Selectors (used with emoji)
    ];

    for (const symbolSet of allSymbolSets) {
      for (const [name, symbols] of Object.entries(symbolSet)) {
        for (const pattern of emojiPatterns) {
          expect(
            pattern.test(symbols.unicode),
            `Symbol "${name}" unicode "${symbols.unicode}" contains emoji characters`
          ).toBe(false);
        }
      }
    }
  });
});

describe("CLI Symbols - Platform Fallback", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    resetCapabilitiesCache();
  });

  it("should provide ASCII fallback when terminal is legacy Windows", () => {
    // Simulate legacy Windows environment
    // Note: This test verifies the fallback values exist and are valid ASCII
    for (const [name, symbolSet] of Object.entries(TOOL_TYPE_SYMBOLS)) {
      expect(symbolSet.ascii).toBeDefined();
      expect(symbolSet.ascii.length).toBeGreaterThan(0);
      // ASCII should be printable characters only
      for (const char of symbolSet.ascii) {
        const code = char.charCodeAt(0);
        expect(code >= 32 && code <= 126, `Invalid ASCII in ${name}: ${symbolSet.ascii}`).toBe(true);
      }
    }
  });
});
