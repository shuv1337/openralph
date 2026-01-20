import { describe, it, expect } from "bun:test";
import { parsePlan, parsePlanTasks, type Task } from "../../src/plan";
import { isGeneratedPrd, parsePrdMetadata } from "../../src/init";
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

  it("should count all checkboxes at any nesting level", async () => {
    // complex-nested.md has checkboxes at various nesting levels:
    // - Root level tasks
    // - Single-nested tasks (indented once)
    // - Deeply nested tasks (indented twice)
    // Plus a checkbox-like pattern in text (line 38) which the regex matches
    // Completed (x/X): 6 total
    // Incomplete [ ]: 7 total
    // (Excludes checkboxes inside code blocks which are correctly ignored)
    const result = await parsePlan(path.join(fixturesDir, "complex-nested.md"));
    expect(result).toEqual({ done: 6, total: 13 });
  });

  it("should parse PRD JSON plans with passes fields", async () => {
    const result = await parsePlan(path.join(fixturesDir, "prd-valid.json"));
    expect(result).toEqual({ done: 1, total: 2 });
  });

  it("should parse PRD JSON object plans with items array", async () => {
    const result = await parsePlan(path.join(fixturesDir, "prd-object.json"));
    expect(result).toEqual({ done: 1, total: 2 });
  });
});

describe("parsePlanTasks", () => {
  it("should return empty array for non-existent file", async () => {
    const result = await parsePlanTasks("/nonexistent/path/to/plan.md");
    expect(result).toEqual([]);
  });

  it("should return empty array for empty file", async () => {
    const result = await parsePlanTasks(path.join(fixturesDir, "empty.md"));
    expect(result).toEqual([]);
  });

  it("should parse tasks with correct structure", async () => {
    const result = await parsePlanTasks(path.join(fixturesDir, "partial-complete.md"));
    
    // Check we got the right number of tasks
    expect(result.length).toBe(10);
    
    // Check first task structure
    expect(result[0]).toEqual({
      id: "task-7",
      line: 7,
      text: "Initialize project",
      done: true,
    });
    
    // Check an incomplete task
    expect(result[2]).toEqual({
      id: "task-9",
      line: 9,
      text: "Configure build system",
      done: false,
    });
  });

  it("should track line numbers correctly", async () => {
    const result = await parsePlanTasks(path.join(fixturesDir, "partial-complete.md"));
    
    // Verify line numbers are 1-indexed and match actual file positions
    const lineNumbers = result.map(t => t.line);
    expect(lineNumbers).toEqual([7, 8, 9, 13, 14, 15, 19, 20, 21, 22]);
  });

  it("should handle uppercase [X] as completed", async () => {
    const result = await parsePlanTasks(path.join(fixturesDir, "uppercase-complete.md"));
    
    // Count completed tasks
    const completedCount = result.filter(t => t.done).length;
    expect(completedCount).toBe(3);
  });

  it("should ignore checkboxes inside fenced code blocks", async () => {
    const result = await parsePlanTasks(path.join(fixturesDir, "code-blocks.md"));
    
    // code-blocks.md has 5 real tasks, rest are in code blocks
    expect(result.length).toBe(5);
    
    // Verify all tasks are from real section (lines 7-11)
    const allFromRealSection = result.every(t => t.line >= 7 && t.line <= 11);
    expect(allFromRealSection).toBe(true);
  });

  it("should generate unique IDs from line numbers", async () => {
    const result = await parsePlanTasks(path.join(fixturesDir, "partial-complete.md"));
    
    // All IDs should be unique
    const ids = result.map(t => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    
    // IDs should follow the task-{lineNumber} pattern
    result.forEach(task => {
      expect(task.id).toBe(`task-${task.line}`);
    });
  });

  it("should trim task text", async () => {
    const result = await parsePlanTasks(path.join(fixturesDir, "partial-complete.md"));
    
    // No task text should have leading/trailing whitespace
    result.forEach(task => {
      expect(task.text).toBe(task.text.trim());
    });
  });

  it("should parse PRD JSON tasks into displayable items", async () => {
    const result = await parsePlanTasks(path.join(fixturesDir, "prd-valid.json"));

    expect(result.length).toBe(2);
    // Use toMatchObject to allow for additional fields (effort, risk, steps, etc.)
    expect(result[0]).toMatchObject({
      id: "prd-1",
      line: 1,
      text: "Create the initial project scaffolding",
      done: true,
      category: "functional",
    });
    // Also verify steps are included
    expect(result[0].steps).toEqual([
      "Run the project generator",
      "Verify the entry point builds",
    ]);
    
    expect(result[1]).toMatchObject({
      id: "prd-2",
      line: 2,
      text: "Wire up the API client",
      done: false,
      category: "integration",
    });
    expect(result[1].steps).toEqual([
      "Configure the base URL",
      "Ensure the client is used by the service layer",
    ]);

  });

  it("should parse extended PRD with custom IDs, effort, and risk", async () => {
    const result = await parsePlanTasks(path.join(fixturesDir, "prd-extended.json"));

    expect(result.length).toBe(3);
    
    // First task with custom ID
    expect(result[0].id).toBe("1.1.1");
    expect(result[0].originalId).toBe("1.1.1");
    expect(result[0].text).toBe("Verify project setup");
    expect(result[0].done).toBe(true);
    expect(result[0].category).toBe("setup");
    expect(result[0].effort).toBe("XS");
    expect(result[0].risk).toBe("L");
    
    // Second task with status
    expect(result[1].id).toBe("1.1.2");
    expect(result[1].originalId).toBe("1.1.2");
    expect(result[1].effort).toBe("M");
    expect(result[1].risk).toBe("M");
    expect(result[1].status).toBe("actionable");
    
    // Third task
    expect(result[2].id).toBe("2.1.1");
    expect(result[2].status).toBe("pending");
  });

  it("should fallback to prd-{index} when custom ID is not present", async () => {
    const result = await parsePlanTasks(path.join(fixturesDir, "prd-valid.json"));

    // prd-valid.json doesn't have id fields, so should use fallback
    expect(result[0].id).toBe("prd-1");
    expect(result[0].originalId).toBeUndefined();
    expect(result[1].id).toBe("prd-2");
    expect(result[1].originalId).toBeUndefined();
  });
});

describe("isGeneratedPrd", () => {
  it("should recognize ralph-init generated PRDs", () => {
    const content = JSON.stringify({
      metadata: {
        generated: true,
        generator: "ralph-init",
        createdAt: "2026-01-20T00:00:00.000Z",
      },
      items: [],
    });
    expect(isGeneratedPrd(content)).toBe(true);
  });

  it("should recognize ralph-plan-command generated PRDs", () => {
    const content = JSON.stringify({
      metadata: {
        generated: true,
        generator: "ralph-plan-command",
        createdAt: "2026-01-20T00:00:00.000Z",
      },
      items: [],
    });
    expect(isGeneratedPrd(content)).toBe(true);
  });

  it("should recognize any custom generator (generator-agnostic)", () => {
    const content = JSON.stringify({
      metadata: {
        generated: true,
        generator: "my-custom-prd-tool",
        createdAt: "2026-01-20T00:00:00.000Z",
      },
      items: [],
    });
    expect(isGeneratedPrd(content)).toBe(true);
  });

  it("should not recognize PRDs with empty generator string", () => {
    const content = JSON.stringify({
      metadata: {
        generated: true,
        generator: "",
        createdAt: "2026-01-20T00:00:00.000Z",
      },
      items: [],
    });
    expect(isGeneratedPrd(content)).toBe(false);
  });

  it("should not recognize PRDs without generated flag", () => {
    const content = JSON.stringify({
      metadata: {
        generator: "ralph-init",
      },
      items: [],
    });
    expect(isGeneratedPrd(content)).toBe(false);
  });

  it("should not recognize plain arrays as generated", () => {
    const content = JSON.stringify([
      { description: "Task", passes: false },
    ]);
    expect(isGeneratedPrd(content)).toBe(false);
  });
});

describe("parsePrdMetadata", () => {
  it("should parse extended metadata from ralph-plan-command PRDs", async () => {
    const content = await Bun.file(path.join(fixturesDir, "prd-extended.json")).text();
    const metadata = parsePrdMetadata(content);

    expect(metadata).not.toBeNull();
    expect(metadata!.generated).toBe(true);
    expect(metadata!.generator).toBe("ralph-plan-command");
    expect(metadata!.title).toBe("Extended PRD Test Fixture");
    expect(metadata!.summary).toContain("extended PRD format");
    expect(metadata!.assumptions).toHaveLength(2);
    expect(metadata!.assumptions![0]).toBe("The project uses TypeScript");
    expect(metadata!.approach).toContain("extended fields");
    expect(metadata!.risks).toHaveLength(1);
    expect(metadata!.risks![0].risk).toBe("Fields might be ignored");
    expect(metadata!.estimatedEffort).toBe("1-2 hours");
    expect(metadata!.totalTasks).toBe(3);
  });

  it("should return null for plain array PRDs", () => {
    const content = JSON.stringify([
      { description: "Task", passes: false },
    ]);
    expect(parsePrdMetadata(content)).toBeNull();
  });

  it("should return null for PRDs without metadata", () => {
    const content = JSON.stringify({
      items: [{ description: "Task", passes: false }],
    });
    expect(parsePrdMetadata(content)).toBeNull();
  });

  it("should return null for non-JSON content", () => {
    expect(parsePrdMetadata("# This is markdown")).toBeNull();
  });

  it("should handle partial metadata gracefully", () => {
    const content = JSON.stringify({
      metadata: {
        generated: true,
        generator: "ralph-init",
        // Missing optional fields like title, summary, etc.
      },
      items: [],
    });
    const metadata = parsePrdMetadata(content);

    expect(metadata).not.toBeNull();
    expect(metadata!.generated).toBe(true);
    expect(metadata!.title).toBeUndefined();
    expect(metadata!.summary).toBeUndefined();
    expect(metadata!.assumptions).toBeUndefined();
  });
});
