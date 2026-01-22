import { describe, it, expect } from "bun:test";
import { createJsonFormatter } from "../../src/formats/json";
import { createJsonlFormatter } from "../../src/formats/jsonl";
import { createTextFormatter } from "../../src/formats/text";
import { createTextRenderer } from "../../src/lib/text-renderer";

describe("formatters", () => {
  it("text formatter writes expected lines", () => {
    const writes: string[] = [];
    // Create text renderer in minimal mode for predictable output
    const textRenderer = createTextRenderer({ mode: "minimal" });
    
    const formatter = createTextFormatter({
      timestamps: false,
      write: (text) => writes.push(text),
      textRenderer,
    });

    formatter.emit({ type: "start" });
    formatter.emit({ type: "progress", done: 1, total: 3 });
    formatter.emit({ type: "output", data: "hello" });

    const output = writes.join("");
    // In minimal mode, the output format is different
    expect(output).toContain("RALPH");
    expect(output).toContain("1/3");
    expect(output).toContain("hello");
  });

  it("jsonl formatter emits one JSON object per line", () => {
    const writes: string[] = [];
    const formatter = createJsonlFormatter({
      timestamps: false,
      write: (text) => writes.push(text),
    });

    formatter.emit({ type: "start", timestamp: 123 });
    expect(writes[0]).toBe('{"type":"start"}\n');
  });

  it("json formatter accumulates events and outputs with summary", () => {
    const writes: string[] = [];
    const formatter = createJsonFormatter({
      timestamps: false,
      write: (text) => writes.push(text),
    });

    // Emit multiple events
    formatter.emit({ type: "start", timestamp: 123 });
    formatter.emit({ type: "iteration_start", iteration: 1, timestamp: 456 });
    formatter.emit({ type: "tool", iteration: 1, name: "read", title: "Reading file.txt" });
    formatter.emit({ type: "progress", done: 1, total: 3 });
    formatter.emit({ type: "complete" });

    // Finalize with summary
    formatter.finalize({
      exitCode: 0,
      durationMs: 10,
      tasksComplete: 2,
      totalTasks: 3,
      commits: 1,
      linesAdded: 4,
      linesRemoved: 1,
    });

    // Should output single JSON with events array and summary
    expect(writes.length).toBe(1);
    const output = JSON.parse(writes[0]);

    // Verify structure
    expect(output).toHaveProperty("events");
    expect(output).toHaveProperty("summary");

    // Verify events were accumulated (timestamps stripped since timestamps: false)
    expect(output.events.length).toBe(5);
    expect(output.events[0]).toEqual({ type: "start" });
    expect(output.events[1]).toEqual({ type: "iteration_start", iteration: 1 });
    expect(output.events[2]).toEqual({ type: "tool", iteration: 1, name: "read", title: "Reading file.txt" });
    expect(output.events[3]).toEqual({ type: "progress", done: 1, total: 3 });
    expect(output.events[4]).toEqual({ type: "complete" });

    // Verify summary
    expect(output.summary).toEqual({
      exitCode: 0,
      durationMs: 10,
      tasksComplete: 2,
      totalTasks: 3,
      commits: 1,
      linesAdded: 4,
      linesRemoved: 1,
    });
  });

  it("json formatter preserves timestamps when enabled", () => {
    const writes: string[] = [];
    const formatter = createJsonFormatter({
      timestamps: true,
      write: (text) => writes.push(text),
    });

    formatter.emit({ type: "start", timestamp: 1234567890 });
    formatter.finalize({
      exitCode: 0,
      durationMs: 100,
      tasksComplete: 1,
      totalTasks: 1,
      commits: 0,
      linesAdded: 0,
      linesRemoved: 0,
    });

    const output = JSON.parse(writes[0]);
    expect(output.events[0]).toEqual({ type: "start", timestamp: 1234567890 });
  });
});
