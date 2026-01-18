import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { parsePlanTasks, savePlanTasks, type Task } from "../../src/plan";
import { TempDir } from "../helpers/temp-files";
import type { TaskStatus } from "../../src/types/task-status";

describe("Manual Task State Override", () => {
  const tempDir = new TempDir();

  beforeEach(async () => {
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  describe("savePlanTasks (PRD JSON)", () => {
    it("should update task status and passes field in PRD JSON", async () => {
      const initialPrd = {
        items: [
          { description: "Task 1", passes: false },
          { description: "Task 2", passes: true }
        ]
      };
      const planFile = await tempDir.write("prd.json", JSON.stringify(initialPrd, null, 2));

      const tasks: Task[] = [
        { id: "prd-1", line: 1, text: "Task 1", done: true, status: "done" as TaskStatus },
        { id: "prd-2", line: 2, text: "Task 2", done: false, status: "pending" as TaskStatus }
      ];

      await savePlanTasks(planFile, tasks);

      const updatedContent = JSON.parse(await tempDir.read("prd.json"));
      expect(updatedContent.items[0].passes).toBe(true);
      expect(updatedContent.items[0].status).toBe("done");
      expect(updatedContent.items[1].passes).toBe(false);
      expect(updatedContent.items[1].status).toBe("pending");
    });
  });

  describe("savePlanTasks (Markdown)", () => {
    it("should update checkboxes in Markdown", async () => {
      const initialMd = `
# Tasks
- [ ] Task 1
- [x] Task 2
`;
      const planFile = await tempDir.write("plan.md", initialMd);

      const tasks: Task[] = [
        { id: "task-3", line: 3, text: "Task 1", done: true },
        { id: "task-4", line: 4, text: "Task 2", done: false }
      ];

      await savePlanTasks(planFile, tasks);

      const updatedMd = await tempDir.read("plan.md");
      expect(updatedMd).toContain("- [x] Task 1");
      expect(updatedMd).toContain("- [ ] Task 2");
    });
  });

  describe("Cyclic status logic (UI level simulation)", () => {
    it("should cycle through statuses correctly", () => {
      const nextStatus = (current: TaskStatus): TaskStatus => {
        if (current === "pending") return "actionable";
        if (current === "actionable") return "done";
        return "pending";
      };

      expect(nextStatus("pending")).toBe("actionable");
      expect(nextStatus("actionable")).toBe("done");
      expect(nextStatus("done")).toBe("pending");
      // Test other statuses which should fallback to pending
      expect(nextStatus("blocked" as TaskStatus)).toBe("pending");
      expect(nextStatus("error" as TaskStatus)).toBe("pending");
    });
  });
});
