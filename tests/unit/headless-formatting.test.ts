import { describe, it, expect } from "bun:test";
import { createTextRenderer } from "../../src/lib/text-renderer";
import { createTextFormatter } from "../../src/formats/text";

describe("Headless Formatting", () => {
  describe("TextFormatter Margins", () => {
    it("should apply left margin to emitted lines", () => {
      let output = "";
      const renderer = createTextRenderer({ leftMargin: 4, mode: "ascii" });
      const formatter = createTextFormatter({
        timestamps: false,
        textRenderer: renderer,
        write: (text) => { output += text; }
      });

      formatter.emit({ type: "idle", isIdle: true });
      expect(output.startsWith("    [||]")).toBe(true);
    });

    it("should apply left margin to multi-line header/footer", () => {
      let output = "";
      const renderer = createTextRenderer({ leftMargin: 2, mode: "ascii" });
      const formatter = createTextFormatter({
        timestamps: false,
        textRenderer: renderer,
        write: (text) => { output += text; }
      });

      formatter.finalize({
        exitCode: 0,
        durationMs: 1000,
        tasksComplete: 1,
        totalTasks: 1,
        commits: 1,
        linesAdded: 1,
        linesRemoved: 1
      });
      
      const lines = output.split("\n").filter(l => l.length > 0);
      expect(lines.every(l => l.startsWith("  "))).toBe(true);
    });
  });

  describe("TextFormatter Banner", () => {
    it("should skip header on start event", () => {
      let output = "";
      const renderer = createTextRenderer({ leftMargin: 2, mode: "ascii" });
      const formatter = createTextFormatter({
        timestamps: false,
        textRenderer: renderer,
        write: (text) => { output += text; }
      });

      formatter.emit({ type: "start" });
      expect(output).toBe(""); // Header skipped
    });
  });
});
