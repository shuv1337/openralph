import { describe, it, expect } from "bun:test";
import { stripAnsiCodes, hasAnsiCodes, sanitizeForDisplay } from "../../src/lib/ansi";

describe("ansi", () => {
  describe("stripAnsiCodes", () => {
    it("should strip color codes", () => {
      const input = "\x1b[31mHello\x1b[0m \x1b[32mWorld\x1b[0m";
      expect(stripAnsiCodes(input)).toBe("Hello World");
    });

    it("should strip bold and underline codes", () => {
      const input = "\x1b[1mBold\x1b[0m \x1b[4mUnderline\x1b[0m";
      expect(stripAnsiCodes(input)).toBe("Bold Underline");
    });

    it("should strip complex CSI sequences", () => {
      const input = "\x1b[2J\x1b[HClear screen and home";
      expect(stripAnsiCodes(input)).toBe("Clear screen and home");
    });

    it("should return plain text unchanged", () => {
      expect(stripAnsiCodes("Plain text")).toBe("Plain text");
    });

    it("should handle empty string", () => {
      expect(stripAnsiCodes("")).toBe("");
    });
  });

  describe("hasAnsiCodes", () => {
    it("should return true for text with ANSI codes", () => {
      expect(hasAnsiCodes("\x1b[31mRed\x1b[0m")).toBe(true);
    });

    it("should return false for plain text", () => {
      expect(hasAnsiCodes("Plain text")).toBe(false);
    });
  });

  describe("sanitizeForDisplay", () => {
    it("should strip ANSI and return text", () => {
      expect(sanitizeForDisplay("\x1b[31mRed\x1b[0m")).toBe("Red");
    });

    it("should truncate long text", () => {
      const longText = "This is a very long text that should be truncated";
      expect(sanitizeForDisplay(longText, 10)).toBe("This is a ...[truncated]");
    });
  });
});
