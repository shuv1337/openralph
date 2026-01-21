import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getToolClassification, parseMcpToolName } from "../../src/lib/tool-classification";
import { getToolIconWithFallback, getIcon, ICON_SETS, getIconStyle } from "../../src/lib/icon-fallback";
import { _resetCapabilitiesCache } from "../../src/lib/terminal-capabilities";
import { getExtendedTheme } from "../../src/lib/enhanced-themes";
import type { Theme } from "../../src/lib/theme-resolver";

/**
 * Regression tests for MCP tool icon and color rendering.
 * 
 * Issue: MCP tools showed squared box icons and white/no color
 * Root cause: MCP tools were not recognized and fell back to generic "custom" category
 *            with Nerd Font box icon that displays as square on unsupported terminals.
 */
describe("Regression: MCP Tool Icon Rendering", () => {
  beforeEach(() => {
    _resetCapabilitiesCache();
  });

  afterEach(() => {
    _resetCapabilitiesCache();
  });

  describe("Issue: MCP tools should not show square box icons", () => {
    it("should recognize tavily_search as an MCP tool", () => {
      const classification = getToolClassification("tavily_search");
      expect(classification.category).toBe("mcp");
      expect(classification.icon).not.toBe("");  // Not the box icon
      expect(classification.icon).toBe("󰌘");     // Plug icon
    });

    it("should recognize context7_query-docs as an MCP tool", () => {
      const classification = getToolClassification("context7_query-docs");
      expect(classification.category).toBe("mcp");
      expect(classification.icon).not.toBe("");
    });

    it("should recognize gh_grep_searchGitHub as an MCP tool", () => {
      const classification = getToolClassification("gh_grep_searchGitHub");
      expect(classification.category).toBe("mcp");
      expect(classification.displayName).toContain("Gh");  // Auto-capitalized, not hardcoded "GitHub"
    });

    it("should provide proper fallback icons for terminals without Nerd Fonts", () => {
      // ASCII fallback should be readable text, not a box
      const classification = getToolClassification("tavily_search");
      expect(classification.fallbackIcon).toBe("[TAVILY]");
      expect(classification.fallbackIcon).not.toBe("[]");  // Not empty brackets
    });
  });

  describe("Issue: MCP tools should have proper colors", () => {
    it("should use toolMcp color key for MCP tools", () => {
      const classification = getToolClassification("tavily_search");
      expect(classification.color).toBe("toolMcp");
    });

    it("should have toolMcp defined in all theme mappings", () => {
      // Create a minimal base theme matching the Theme interface
      const baseTheme: Theme = {
        primary: "#000",
        secondary: "#111",
        success: "#0f0",
        warning: "#ff0",
        error: "#f00",
        info: "#00f",
        text: "#fff",
        textMuted: "#888",
        background: "#000",
        backgroundPanel: "#111",
        backgroundElement: "#222",
        border: "#333",
        borderActive: "#444",
        borderSubtle: "#222",
        accent: "#f90",
        // Diff colors
        diffAdded: "#0f0",
        diffRemoved: "#f00",
        diffContext: "#888",
        diffHunkHeader: "#00f",
        diffHighlightAdded: "#0f0",
        diffHighlightRemoved: "#f00",
        diffAddedBg: "#010",
        diffRemovedBg: "#100",
        diffContextBg: "#111",
        diffLineNumber: "#888",
        diffAddedLineNumberBg: "#020",
        diffRemovedLineNumberBg: "#200",
        // Markdown colors
        markdownText: "#fff",
        markdownHeading: "#f90",
        markdownLink: "#00f",
        markdownLinkText: "#0ff",
        markdownCode: "#0f0",
        markdownBlockQuote: "#888",
        markdownEmph: "#ff0",
        markdownStrong: "#f90",
        markdownHorizontalRule: "#888",
        markdownListItem: "#fff",
        markdownListEnumeration: "#888",
        markdownImage: "#00f",
        markdownImageText: "#0ff",
        markdownCodeBlock: "#111",
        // Syntax colors
        syntaxKeyword: "#f90",
        syntaxString: "#0f0",
        syntaxNumber: "#f0f",
        syntaxComment: "#888",
        syntaxFunction: "#00f",
        syntaxVariable: "#0ff",
        syntaxType: "#ff0",
        syntaxOperator: "#f00",
        syntaxPunctuation: "#888",
      };

      // Test with different theme names
      const themes = ["tokyonight", "nightowl", "gruvbox", "dracula", "catppuccin", "unknown"];
      
      for (const themeName of themes) {
        const extendedTheme = getExtendedTheme(baseTheme, themeName);
        expect(extendedTheme.toolMcp).toBeTruthy();
        expect(extendedTheme.toolMcp).not.toBe("");
        expect(extendedTheme.toolMcp).not.toBe("#ffffff"); // Not plain white
      }
    });
  });

  describe("Issue: MCP tool display names should be human-readable", () => {
    it("should format tavily_search as 'Tavily: Search'", () => {
      const classification = getToolClassification("tavily_search");
      expect(classification.displayName).toBe("Tavily: Search");
    });

    it("should format context7_query-docs as 'Context7: Query Docs'", () => {
      const classification = getToolClassification("context7_query-docs");
      expect(classification.displayName).toBe("Context7: Query Docs");
    });

    it("should format multi-word actions properly", () => {
      const classification = getToolClassification("tavily_tavily_extract");
      expect(classification.displayName).toContain("Tavily");
      // Action should be formatted
      expect(classification.displayName).not.toBe("tavily_tavily_extract");
    });

    it("should capitalize unknown server names", () => {
      const classification = getToolClassification("myserver_doaction");
      expect(classification.displayName).toContain("Myserver");
    });
  });

  describe("Platform compatibility", () => {
    it("should provide ASCII fallback for Windows legacy terminals", () => {
      // The ASCII fallback should be a readable text representation
      const classification = getToolClassification("tavily_search");
      expect(classification.fallbackIcon).toMatch(/^\[.+\]$/);
    });

    it("should provide Unicode emoji fallback for modern terminals without Nerd Fonts", () => {
      const mcpIconSet = ICON_SETS.mcp;
      expect(mcpIconSet.unicode).toBe("🔌");  // Plug emoji - widely supported
    });

    it("should not use Nerd Font icons as fallback", () => {
      // The fallbackIcon should never be a Nerd Font icon
      const classification = getToolClassification("tavily_search");
      // Nerd Font icons are typically in the private use area
      const nerdFontRange = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}]/u;
      expect(classification.fallbackIcon).not.toMatch(nerdFontRange);
    });
  });
});

describe("Regression: Built-in tools should still work", () => {
  it("should not break built-in tool classification", () => {
    const read = getToolClassification("read");
    expect(read.category).toBe("file");
    expect(read.displayName).toBe("Read");

    const bash = getToolClassification("bash");
    expect(bash.category).toBe("execute");
    expect(bash.displayName).toBe("Bash");

    const grep = getToolClassification("grep");
    expect(grep.category).toBe("search");
    expect(grep.displayName).toBe("Grep");
  });

  it("should not classify built-in tools as MCP", () => {
    const builtInTools = ["read", "write", "edit", "glob", "grep", "bash", "task", "todowrite", "todoread", "thought", "lsp"];
    
    for (const tool of builtInTools) {
      const classification = getToolClassification(tool);
      expect(classification.category).not.toBe("mcp");
    }
  });
});

describe("Edge cases", () => {
  it("should handle tools with multiple underscores", () => {
    const classification = getToolClassification("server_action_with_underscores");
    expect(classification.category).toBe("mcp");
    expect(classification.displayName).toContain("Server");
  });

  it("should handle tools with hyphens in action name", () => {
    const classification = getToolClassification("context7_resolve-library-id");
    expect(classification.category).toBe("mcp");
    expect(classification.displayName).toContain("Context7");
    expect(classification.displayName).toContain("Resolve");
    expect(classification.displayName).toContain("Library");
    expect(classification.displayName).toContain("Id");
  });

  it("should handle single-word tools that look like MCP but aren't", () => {
    // Single underscore in the middle could be ambiguous
    const classification = getToolClassification("a_b");
    expect(classification.category).toBe("mcp");  // Two parts = MCP pattern
    
    // But single word should not be MCP
    const singleWord = getToolClassification("read");
    expect(singleWord.category).not.toBe("mcp");
  });
});
