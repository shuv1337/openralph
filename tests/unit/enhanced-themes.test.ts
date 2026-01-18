import { describe, it, expect } from "bun:test";
import { getExtendedTheme, EXTENDED_THEME_MAPPINGS } from "../../src/lib/enhanced-themes";
import { resolveTheme } from "../../src/lib/theme-resolver";

describe("Enhanced Theme System", () => {
  it("should extend a base theme with semantic colors", () => {
    // Theme names are normalized, so 'tokyo' should match 'tokyonight'
    const baseTheme = resolveTheme("tokyonight", "dark");
    const extended = getExtendedTheme(baseTheme, "tokyonight");

    expect(extended.primary).toBe(baseTheme.primary);
    expect(extended.toolRead).toBeDefined();
    expect(extended.toolWrite).toBeDefined();
    expect(extended.iteration).toBeDefined();
    
    // Specific check for tokyonight mapping
    expect(extended.toolRead).toBe(EXTENDED_THEME_MAPPINGS.tokyonight.toolRead!);
  });

  it("should provide defaults when mapping is missing", () => {
    const baseTheme = resolveTheme("tokyonight", "dark");
    const extended = getExtendedTheme(baseTheme, "non-existent-theme");

    expect(extended.toolRead).toBe(baseTheme.info || baseTheme.primary);
    expect(extended.toolWrite).toBe(baseTheme.success || baseTheme.accent);
  });

  it("should support different base themes", () => {
    const tokyoBase = resolveTheme("tokyonight", "dark");
    const gruvboxBase = resolveTheme("gruvbox", "dark");
    
    const tokyoExtended = getExtendedTheme(tokyoBase, "tokyonight");
    const gruvboxExtended = getExtendedTheme(gruvboxBase, "gruvbox");
    
    expect(tokyoExtended.toolRead).not.toBe(gruvboxExtended.toolRead);
  });

  it("should support fuzzy matching for theme names", () => {
    const baseTheme = resolveTheme("catppuccin-frappe", "dark");
    const extended = getExtendedTheme(baseTheme, "catppuccin-frappe");
    
    // Should match 'catppuccin' mapping
    expect(extended.toolRead).toBe(EXTENDED_THEME_MAPPINGS.catppuccin.toolRead!);
  });
});
