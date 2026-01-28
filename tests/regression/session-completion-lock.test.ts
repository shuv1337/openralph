/**
 * Regression tests for the guardrail plugin.
 * 
 * These tests ensure that the session completion lock feature
 * does not break existing functionality.
 */
import { describe, it, expect } from "bun:test";
import { PLUGIN_TEMPLATE, detectsTaskCompletion, isGeneratedPlugin, GENERATED_PLUGIN_MARKER } from "../../src/templates/plugin-template";

describe("Guardrail Regression Tests", () => {
  describe("Original task-switching guard remains intact", () => {
    it("still tracks activeTaskIndex for different task detection", () => {
      expect(PLUGIN_TEMPLATE).toContain("let activeTaskIndex: number | null = null");
      expect(PLUGIN_TEMPLATE).toContain("activeTaskIndex = taskIndex");
      expect(PLUGIN_TEMPLATE).toContain("activeTaskIndex !== taskIndex");
    });

    it("still uses findTaskIndexByContent for task identification", () => {
      expect(PLUGIN_TEMPLATE).toContain("findTaskIndexByContent");
      expect(PLUGIN_TEMPLATE).toContain("await findTaskIndexByContent(filePath, oldString)");
    });

    it("still allows multiple edits to the same task (before completion)", () => {
      // The comment should still indicate this behavior
      expect(PLUGIN_TEMPLATE).toContain("Same task index - allow the edit");
    });

    it("resets activeTaskIndex on session.created", () => {
      expect(PLUGIN_TEMPLATE).toContain("activeTaskIndex = null");
    });
  });

  describe("Path normalization remains platform-agnostic", () => {
    it("normalizes backslashes to forward slashes", () => {
      expect(PLUGIN_TEMPLATE).toContain('replace(/\\\\/g, "/")');
    });

    it("checks for both Unix and Windows path separators", () => {
      expect(PLUGIN_TEMPLATE).toContain('endsWith("/" + PRD_FILE_NAME)');
      expect(PLUGIN_TEMPLATE).toContain('endsWith("\\\\" + PRD_FILE_NAME)');
    });
  });

  describe("Fail-open behavior for edge cases", () => {
    it("allows edits when task index cannot be determined", () => {
      expect(PLUGIN_TEMPLATE).toContain("If we couldn't determine task index, allow the edit");
    });

    it("requires minimum content length for matching", () => {
      expect(PLUGIN_TEMPLATE).toContain("oldString.length >= 5");
    });
  });

  describe("Protected files behavior unchanged", () => {
    it("PROTECTED_FILES array contains original entries", () => {
      const expectedFiles = ["prd.json", "progress.txt", ".ralph-prompt.md", "AGENTS.md"];
      for (const file of expectedFiles) {
        expect(PLUGIN_TEMPLATE).toContain(`"${file}"`);
      }
    });

    it("isProtectedFile function still exists", () => {
      expect(PLUGIN_TEMPLATE).toContain("function isProtectedFile(filePath: string): string | null");
    });

    it("wouldModifyProtectedFile function still exists", () => {
      expect(PLUGIN_TEMPLATE).toContain("function wouldModifyProtectedFile(command: string): string | null");
    });
  });

  describe("Destructive command patterns unchanged", () => {
    it("still blocks rm commands", () => {
      expect(PLUGIN_TEMPLATE).toContain("/^rm");
      expect(PLUGIN_TEMPLATE).toContain("(FILENAME)");
    });

    it("still blocks mv commands", () => {
      expect(PLUGIN_TEMPLATE).toContain("/^mv");
    });

    it("still blocks redirect operators", () => {
      expect(PLUGIN_TEMPLATE).toContain("[>|]");
    });
  });
});

describe("detectsTaskCompletion Regression Tests", () => {
  describe("Does not false-positive on common edits", () => {
    it("does not trigger on description-only edits", () => {
      const newString = `{
        "description": "Updated task description with done and passes keywords"
      }`;
      expect(detectsTaskCompletion(newString)).toBe(false);
    });

    it("does not trigger on notes-only edits", () => {
      const newString = `{
        "notes": ["The task is almost done", "passes all tests"]
      }`;
      expect(detectsTaskCompletion(newString)).toBe(false);
    });

    it("does not trigger on status active with passes false", () => {
      const newString = `{
        "status": "active",
        "passes": false
      }`;
      expect(detectsTaskCompletion(newString)).toBe(false);
    });

    it("does not trigger on status blocked", () => {
      const newString = `{
        "status": "blocked",
        "passes": false
      }`;
      expect(detectsTaskCompletion(newString)).toBe(false);
    });
  });

  describe("Correctly identifies completion patterns", () => {
    it("triggers on standard completion", () => {
      expect(detectsTaskCompletion('{"status": "done", "passes": true}')).toBe(true);
    });

    it("triggers on completion with extra fields", () => {
      expect(detectsTaskCompletion('{"id": 1, "status": "done", "passes": true, "notes": []}')).toBe(true);
    });

    it("triggers regardless of field order", () => {
      expect(detectsTaskCompletion('{"passes": true, "status": "done"}')).toBe(true);
    });
  });
});

describe("Plugin Generation Regression Tests", () => {
  describe("Generated plugin marker", () => {
    it("GENERATED_PLUGIN_MARKER is unchanged", () => {
      expect(GENERATED_PLUGIN_MARKER).toContain("Generated by ralph init");
      expect(GENERATED_PLUGIN_MARKER).toContain("generator: ralph-init");
      expect(GENERATED_PLUGIN_MARKER).toContain("safe_to_delete: true");
    });

    it("isGeneratedPlugin still works", () => {
      expect(isGeneratedPlugin("// Generated by ralph init\n// test")).toBe(true);
      expect(isGeneratedPlugin("// Custom plugin")).toBe(false);
    });

    it("PLUGIN_TEMPLATE starts with marker", () => {
      expect(PLUGIN_TEMPLATE.startsWith("// Generated by ralph init")).toBe(true);
    });
  });

  describe("Plugin imports", () => {
    it("imports Plugin type from @opencode-ai/plugin", () => {
      expect(PLUGIN_TEMPLATE).toContain('import type { Plugin } from "@opencode-ai/plugin"');
    });
  });

  describe("Plugin export", () => {
    it("exports RalphWriteGuardrail", () => {
      expect(PLUGIN_TEMPLATE).toContain("export const RalphWriteGuardrail: Plugin");
    });
  });
});

describe("Cross-platform Regression Tests", () => {
  describe("Line ending handling in detectsTaskCompletion", () => {
    const testCases = [
      { name: "Unix LF", content: '{\n"status": "done",\n"passes": true\n}' },
      { name: "Windows CRLF", content: '{\r\n"status": "done",\r\n"passes": true\r\n}' },
      { name: "Old Mac CR", content: '{\r"status": "done",\r"passes": true\r}' },
      { name: "Mixed", content: '{\r\n"status": "done",\n"passes": true\r}' },
    ];

    for (const { name, content } of testCases) {
      it(`correctly handles ${name} line endings`, () => {
        expect(detectsTaskCompletion(content)).toBe(true);
      });
    }
  });

  describe("Path separator handling in template", () => {
    it("handles forward slashes", () => {
      expect(PLUGIN_TEMPLATE).toContain('endsWith("/" + PRD_FILE_NAME)');
    });

    it("handles backslashes", () => {
      expect(PLUGIN_TEMPLATE).toContain('endsWith("\\\\" + PRD_FILE_NAME)');
    });

    it("normalizes paths", () => {
      expect(PLUGIN_TEMPLATE).toContain('replace(/\\\\/g, "/")');
    });
  });
});
