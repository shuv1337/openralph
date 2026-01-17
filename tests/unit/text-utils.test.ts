import { describe, it, expect } from "bun:test";
import { parseMarkdownSegments, stripMarkdownBold, hasMarkdownBold } from "../../src/lib/markdown";

describe("text-utils", () => {
  describe("parseMarkdownSegments", () => {
    it("should return single segment for plain text", () => {
      const result = parseMarkdownSegments("Hello world");
      expect(result).toEqual([{ text: "Hello world", bold: false }]);
    });

    it("should parse single bold section", () => {
      const result = parseMarkdownSegments("Hello **world**");
      expect(result).toEqual([
        { text: "Hello ", bold: false },
        { text: "world", bold: true },
      ]);
    });

    it("should parse multiple bold sections", () => {
      const result = parseMarkdownSegments("**Hello** and **world**");
      expect(result).toEqual([
        { text: "Hello", bold: true },
        { text: " and ", bold: false },
        { text: "world", bold: true },
      ]);
    });

    it("should handle bold at start and end", () => {
      const result = parseMarkdownSegments("**Start** middle **end**");
      expect(result).toEqual([
        { text: "Start", bold: true },
        { text: " middle ", bold: false },
        { text: "end", bold: true },
      ]);
    });

    it("should handle consecutive bold sections", () => {
      const result = parseMarkdownSegments("**one****two**");
      expect(result).toEqual([
        { text: "one", bold: true },
        { text: "two", bold: true },
      ]);
    });

    it("should return empty array for empty string", () => {
      const result = parseMarkdownSegments("");
      expect(result).toEqual([]);
    });

    it("should handle text with only bold content", () => {
      const result = parseMarkdownSegments("**only bold**");
      expect(result).toEqual([{ text: "only bold", bold: true }]);
    });
  });

  describe("stripMarkdownBold", () => {
    it("should return plain text unchanged", () => {
      expect(stripMarkdownBold("Hello world")).toBe("Hello world");
    });

    it("should remove single bold markers", () => {
      expect(stripMarkdownBold("Hello **world**")).toBe("Hello world");
    });

    it("should remove multiple bold markers", () => {
      expect(stripMarkdownBold("**Hello** and **world**")).toBe("Hello and world");
    });

    it("should handle empty string", () => {
      expect(stripMarkdownBold("")).toBe("");
    });

    it("should handle only bold text", () => {
      expect(stripMarkdownBold("**bold**")).toBe("bold");
    });
  });

  describe("hasMarkdownBold", () => {
    it("should return false for plain text", () => {
      expect(hasMarkdownBold("Hello world")).toBe(false);
    });

    it("should return true for text with bold", () => {
      expect(hasMarkdownBold("Hello **world**")).toBe(true);
    });

    it("should return false for incomplete markers", () => {
      expect(hasMarkdownBold("Hello **world")).toBe(false);
      expect(hasMarkdownBold("Hello world**")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(hasMarkdownBold("")).toBe(false);
    });

    it("should return true for multiple bold sections", () => {
      expect(hasMarkdownBold("**one** and **two**")).toBe(true);
    });
  });
});
