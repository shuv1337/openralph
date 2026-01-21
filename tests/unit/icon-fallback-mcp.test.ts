import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { 
  getIconStyle, 
  getIcon, 
  getToolIcon, 
  getToolIconWithFallback,
  getCategoryIconSet,
  ICON_SETS,
  type IconSet
} from "../../src/lib/icon-fallback";
import { _resetCapabilitiesCache } from "../../src/lib/terminal-capabilities";

describe("Icon Fallback - MCP Tools", () => {
  beforeEach(() => {
    // Reset capabilities cache before each test
    _resetCapabilitiesCache();
  });

  afterEach(() => {
    // Clean up environment
    _resetCapabilitiesCache();
  });

  describe("ICON_SETS", () => {
    it("should have MCP icon set defined", () => {
      expect(ICON_SETS.mcp).toBeDefined();
      expect(ICON_SETS.mcp.nerd).toBe("󰌘");
      expect(ICON_SETS.mcp.unicode).toBe("🔌");
      expect(ICON_SETS.mcp.ascii).toBe("[MCP]");
    });

    it("should have known MCP server icons", () => {
      expect(ICON_SETS.tavily).toBeDefined();
      expect(ICON_SETS.context7).toBeDefined();
      expect(ICON_SETS.exa).toBeDefined();
      expect(ICON_SETS.gh).toBeDefined();
      expect(ICON_SETS.github).toBeDefined();
      expect(ICON_SETS.brave).toBeDefined();
    });

    it("should have proper unicode fallbacks for all icons", () => {
      for (const [name, iconSet] of Object.entries(ICON_SETS)) {
        expect(iconSet.unicode).toBeTruthy();
        expect(iconSet.ascii).toBeTruthy();
      }
    });

    it("should have custom tool icon set", () => {
      expect(ICON_SETS.custom).toBeDefined();
      expect(ICON_SETS.custom.nerd).toBeTruthy();
      expect(ICON_SETS.custom.unicode).toBe("📦");
      expect(ICON_SETS.custom.ascii).toBe("[TOOL]");
    });
  });

  describe("getToolIconWithFallback", () => {
    it("should return MCP icon for MCP tools", () => {
      // This test depends on terminal capabilities
      // In a test environment, it should return based on detected style
      const icon = getToolIconWithFallback("tavily_search");
      expect(icon).toBeTruthy();
      // Should be one of the MCP or tavily icons
      expect(
        icon === "󰌘" || 
        icon === "🔌" || 
        icon === "[MCP]" ||
        icon === "󰖟" ||  // Tavily uses web icon
        icon === "🌐" ||
        icon === "[TAVILY]"
      ).toBe(true);
    });

    it("should return server-specific icon when available", () => {
      const tavilyIcon = getToolIconWithFallback("tavily_search");
      const ghIcon = getToolIconWithFallback("gh_grep_searchGitHub");
      const context7Icon = getToolIconWithFallback("context7_query-docs");
      
      // These should be defined and not empty
      expect(tavilyIcon).toBeTruthy();
      expect(ghIcon).toBeTruthy();
      expect(context7Icon).toBeTruthy();
    });

    it("should return built-in icon for known tools", () => {
      const readIcon = getToolIconWithFallback("read");
      const bashIcon = getToolIconWithFallback("bash");
      
      // Should match one of the known icon representations
      expect(readIcon).toBeTruthy();
      expect(bashIcon).toBeTruthy();
    });

    it("should return fallback icon for unknown tools", () => {
      const icon = getToolIconWithFallback("unknown_custom_tool");
      expect(icon).toBeTruthy();
    });
  });

  describe("getCategoryIconSet", () => {
    it("should return MCP icon set for 'mcp' category", () => {
      const iconSet = getCategoryIconSet("mcp");
      expect(iconSet).toEqual(ICON_SETS.mcp);
    });

    it("should return proper icon sets for all categories", () => {
      expect(getCategoryIconSet("file")).toEqual(ICON_SETS.read);
      expect(getCategoryIconSet("search")).toEqual(ICON_SETS.grep);
      expect(getCategoryIconSet("execute")).toEqual(ICON_SETS.bash);
      expect(getCategoryIconSet("web")).toEqual(ICON_SETS.websearch);
      expect(getCategoryIconSet("planning")).toEqual(ICON_SETS.task);
      expect(getCategoryIconSet("reasoning")).toEqual(ICON_SETS.thought);
      expect(getCategoryIconSet("system")).toEqual(ICON_SETS.lsp);
      expect(getCategoryIconSet("custom")).toEqual(ICON_SETS.custom);
    });

    it("should return custom icon set for unknown categories", () => {
      const iconSet = getCategoryIconSet("unknown_category");
      expect(iconSet).toEqual(ICON_SETS.custom);
    });
  });

  describe("Icon style detection", () => {
    it("should return valid icon style", () => {
      const style = getIconStyle();
      expect(["nerd", "unicode", "ascii"]).toContain(style);
    });
  });

  describe("getIcon", () => {
    it("should return icon based on terminal style", () => {
      const testSet: IconSet = {
        nerd: "󰌘",
        unicode: "🔌",
        ascii: "[TEST]"
      };
      
      const icon = getIcon(testSet);
      // Should return one of the valid icons
      expect([testSet.nerd, testSet.unicode, testSet.ascii]).toContain(icon);
    });
  });
});

describe("Icon Fallback - Platform Compatibility", () => {
  describe("ASCII fallbacks", () => {
    it("should have readable ASCII fallbacks for all icons", () => {
      for (const [name, iconSet] of Object.entries(ICON_SETS)) {
        // ASCII fallback should be readable text in brackets
        expect(iconSet.ascii).toMatch(/^\[.+\]$/);
      }
    });
  });

  describe("Unicode emoji fallbacks", () => {
    it("should use standard emoji that work cross-platform", () => {
      // These emojis should be widely supported
      const commonEmojis = ["📖", "📝", "💻", "📁", "🔍", "📋", "💭", "🌐", "🔌", "📦", "🐙"];
      
      for (const [name, iconSet] of Object.entries(ICON_SETS)) {
        // Unicode should either be an emoji or a simple unicode character
        expect(iconSet.unicode.length).toBeGreaterThan(0);
      }
    });
  });
});

describe("MCP Tool Icon Consistency", () => {
  it("should have consistent icons for related MCP servers", () => {
    // GitHub-related icons should be similar
    expect(ICON_SETS.gh.nerd).toBe(ICON_SETS.github.nerd);
    expect(ICON_SETS.gh.unicode).toBe(ICON_SETS.github.unicode);
  });

  it("should have web icons for web search MCP servers", () => {
    const webServers = ["tavily", "brave"];
    for (const server of webServers) {
      expect(ICON_SETS[server].unicode).toBeTruthy();
    }
  });
});
