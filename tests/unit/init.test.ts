import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runInit } from "../../src/init";
import { TempDir } from "../helpers/temp-files";

describe("runInit", () => {
  const tempDir = new TempDir();

  beforeEach(async () => {
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it("should preserve markdown plan files and write PRD JSON to prd.json", async () => {
    const planPath = await tempDir.write(
      "plan.md",
      "# Plan\n- [ ] First task\n- [ ] Second task\n"
    );
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");

    const result = await runInit({
      planFile: planPath,
      progressFile: progressPath,
      promptFile: promptPath,
    });

    const originalPlan = await tempDir.read("plan.md");
    expect(originalPlan).toBe("# Plan\n- [ ] First task\n- [ ] Second task\n");

    const prdPath = tempDir.path("prd.json");
    const prdExists = await tempDir.exists("prd.json");
    expect(prdExists).toBe(true);

    const prdContent = await Bun.file(prdPath).json();
    expect(Array.isArray(prdContent)).toBe(true);
    expect(prdContent.length).toBe(2);
    expect(prdContent[0]).toMatchObject({
      description: "First task",
      passes: false,
    });

    expect(result.created).toContain(prdPath);
  });

  it("should use plan.md when no args and prd.json does not exist", async () => {
    await tempDir.write("plan.md", "# Plan\n- [ ] First task\n- [ ] Second task\n");
    const prdPath = tempDir.path("prd.json");
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");

    const originalCwd = process.cwd();
    try {
      process.chdir(tempDir.dir);
      const result = await runInit({
        planFile: prdPath,
        progressFile: progressPath,
        promptFile: promptPath,
      });

      const prdContent = await Bun.file(prdPath).json();
      expect(prdContent.length).toBe(2);
      expect(result.warnings.some((warning) => warning.includes("plan.md"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
