import { describe, it, expect, beforeEach } from "bun:test";
import { OutputParser } from "../../src/lib/output-parser";

describe("OutputParser", () => {
  let parser: OutputParser;

  beforeEach(() => {
    parser = new OutputParser({ maxSize: 1000 });
  });

  describe("Plain Text Parsing", () => {
    it("should extract plain text lines", () => {
      const chunk = "Hello world\nThis is a test\n";
      const result = parser.push(chunk);
      expect(result).toBe("Hello world\nThis is a test\n");
      expect(parser.getOutput()).toBe("Hello world\nThis is a test\n");
    });

    it("should handle incomplete lines", () => {
      parser.push("First line\nIncom");
      expect(parser.getOutput()).toBe("First line\n");
      parser.push("plete line\n");
      expect(parser.getOutput()).toBe("First line\nIncomplete line\n");
    });
  });

  describe("JSONL Parsing", () => {
    it("should extract assistant message content", () => {
      const event = JSON.stringify({
        type: "assistant",
        message: { content: "Thinking..." }
      }) + "\n";
      const result = parser.push(event);
      expect(result).toBe("Thinking...\n");
    });

    it("should handle array message content", () => {
      const event = JSON.stringify({
        type: "assistant",
        message: { 
          content: [
            { type: "text", text: "Part 1 " },
            { type: "text", text: "Part 2" }
          ] 
        }
      }) + "\n";
      const result = parser.push(event);
      expect(result).toBe("Part 1 Part 2\n");
    });

    it("should extract error messages", () => {
      const event = JSON.stringify({
        type: "error",
        message: "Something went wrong"
      }) + "\n";
      const result = parser.push(event);
      expect(result).toBe("Error: Something went wrong\n");
    });

    it("should store result text but not emit it immediately", () => {
      const event = JSON.stringify({
        type: "result",
        result: "Final answer"
      }) + "\n";
      const result = parser.push(event);
      expect(result).toBe("");
      expect(parser.getResultText()).toBe("Final answer");
    });
  });

  describe("Memory Management", () => {
    it("should trim output when exceeding maxSize", () => {
      const smallParser = new OutputParser({ maxSize: 20 });
      smallParser.push("1234567890\n");
      smallParser.push("abcdefghij\n");
      smallParser.push("klmnopqrst\n");
      
      const output = smallParser.getOutput();
      expect(output).toContain("[...output trimmed...]");
      expect(output.length).toBeLessThanOrEqual(20 + 1000); // 1000 is the buffer padding in trimmer
    });
  });

  describe("Formatted Segments", () => {
    it("should highlight tool names", () => {
      parser.push("[read] src/index.ts\n");
      const segments = parser.getSegments();
      
      // Expected: [{text: "[read]", color: "#9ece6a", bold: true}, {text: " src/index.ts"}, {text: "\n"}]
      expect(segments).toContainEqual({ text: "[read]", color: "#9ece6a", bold: true });
      expect(segments).toContainEqual({ text: " src/index.ts" });
    });

    it("should strip ANSI from segments", () => {
      parser.push("\x1b[31mColored text\x1b[0m\n");
      const segments = parser.getSegments();
      expect(segments[0].text).toBe("Colored text");
    });
  });
});
