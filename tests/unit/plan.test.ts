import { describe, it, expect } from "bun:test";
import { parsePlan } from "../../src/plan";
import path from "path";

const fixturesDir = path.join(import.meta.dir, "../fixtures/plans");

describe("parsePlan", () => {
  it("should return { done: 0, total: 0 } for non-existent file", async () => {
    const result = await parsePlan("/nonexistent/path/to/plan.md");
    expect(result).toEqual({ done: 0, total: 0 });
  });

  it("should not throw for non-existent file", async () => {
    // Verify the function completes without throwing
    await expect(parsePlan("/nonexistent/path/to/plan.md")).resolves.toBeDefined();
  });

  it("should return { done: 0, total: 0 } for empty file", async () => {
    const result = await parsePlan(path.join(fixturesDir, "empty.md"));
    expect(result).toEqual({ done: 0, total: 0 });
  });

  it("should return { done: 5, total: 5 } for all completed tasks", async () => {
    const result = await parsePlan(path.join(fixturesDir, "all-complete.md"));
    expect(result).toEqual({ done: 5, total: 5 });
  });

  it("should return { done: 0, total: 3 } for all incomplete tasks", async () => {
    const result = await parsePlan(path.join(fixturesDir, "all-incomplete.md"));
    expect(result).toEqual({ done: 0, total: 3 });
  });

  it("should return { done: 3, total: 10 } for mixed task states", async () => {
    const result = await parsePlan(path.join(fixturesDir, "partial-complete.md"));
    expect(result).toEqual({ done: 3, total: 10 });
  });

  it("should count uppercase [X] as completed (case insensitive)", async () => {
    const result = await parsePlan(path.join(fixturesDir, "uppercase-complete.md"));
    expect(result).toEqual({ done: 3, total: 4 });
  });

  it("should ignore checkboxes inside fenced code blocks", async () => {
    // code-blocks.md has 2 completed and 3 incomplete real tasks
    // Plus several checkboxes inside ``` code blocks that should NOT be counted
    const result = await parsePlan(path.join(fixturesDir, "code-blocks.md"));
    expect(result).toEqual({ done: 2, total: 5 });
  });
});
