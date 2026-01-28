/**
 * Unit tests for the session completion lock feature.
 * 
 * Tests the guardrail that ensures Ralph can only complete ONE task per session.
 * Once a task is marked as "done" with passes=true, further edits to prd.json are blocked
 * until a new session starts.
 */
import { describe, it, expect } from "bun:test";
import { detectsTaskCompletion } from "../../src/templates/plugin-template";

describe("detectsTaskCompletion", () => {
  describe("should detect completion", () => {
    it("detects standard JSON format with status done and passes true", () => {
      const newString = `{
        "description": "Implement feature",
        "status": "done",
        "passes": true,
        "notes": ["Completed successfully"]
      }`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("detects completion with different key order", () => {
      const newString = `{
        "passes": true,
        "description": "Implement feature",
        "status": "done"
      }`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("detects completion with extra whitespace", () => {
      const newString = `{
        "status"  :  "done"  ,
        "passes"  :  true
      }`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("detects completion in partial edit (only relevant fields)", () => {
      const newString = `"status": "done",
        "passes": true`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("handles Windows line endings (CRLF)", () => {
      const newString = `{\r\n  "status": "done",\r\n  "passes": true\r\n}`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("handles Mac line endings (CR)", () => {
      const newString = `{\r  "status": "done",\r  "passes": true\r}`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("handles mixed line endings", () => {
      const newString = `{\r\n  "status": "done",\n  "passes": true\r}`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("detects completion with single quotes", () => {
      const newString = `{
        'status': 'done',
        'passes': true
      }`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("detects completion case-insensitively for status value", () => {
      const newString = `{
        "status": "DONE",
        "passes": true
      }`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("detects completion with unquoted keys (JavaScript object literal style)", () => {
      const newString = `{
        status: "done",
        passes: true
      }`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });
  });

  describe("should not detect completion", () => {
    it("returns false for status done without passes true", () => {
      const newString = `{
        "status": "done",
        "passes": false
      }`;
      expect(detectsTaskCompletion(newString)).toBe(false);
    });

    it("returns false for passes true without status done", () => {
      const newString = `{
        "status": "active",
        "passes": true
      }`;
      expect(detectsTaskCompletion(newString)).toBe(false);
    });

    it("returns false for pending status", () => {
      const newString = `{
        "status": "pending",
        "passes": false
      }`;
      expect(detectsTaskCompletion(newString)).toBe(false);
    });

    it("returns false for active status", () => {
      const newString = `{
        "status": "active",
        "passes": false
      }`;
      expect(detectsTaskCompletion(newString)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(detectsTaskCompletion("")).toBe(false);
    });

    it("returns false for short content (less than 5 chars)", () => {
      expect(detectsTaskCompletion("done")).toBe(false);
    });

    it("returns false for null", () => {
      expect(detectsTaskCompletion(null as any)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(detectsTaskCompletion(undefined as any)).toBe(false);
    });

    it("returns false when done is in a comment, not status", () => {
      const newString = `{
        "status": "active",
        "notes": "This task is done soon",
        "passes": true
      }`;
      expect(detectsTaskCompletion(newString)).toBe(false);
    });

    it("returns false when passes is not a boolean true", () => {
      const newString = `{
        "status": "done",
        "passes": "true"
      }`;
      expect(detectsTaskCompletion(newString)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles multiline JSON with comments style content", () => {
      const newString = `{
        // Task completed
        "status": "done",
        "passes": true,
        "notes": ["Verified working"]
      }`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("handles nested objects", () => {
      const newString = `{
        "task": {
          "status": "done",
          "passes": true
        }
      }`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("handles arrays containing the patterns", () => {
      const newString = `[
        { "status": "done", "passes": true },
        { "status": "pending", "passes": false }
      ]`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("handles very long content with completion at end", () => {
      const longDescription = "a".repeat(10000);
      const newString = `{
        "description": "${longDescription}",
        "status": "done",
        "passes": true
      }`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("handles Unicode content", () => {
      const newString = `{
        "description": "完成タスク 완료된 작업",
        "status": "done",
        "passes": true
      }`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });
  });
});

describe("Session Completion Lock behavior scenarios", () => {
  /**
   * These tests document the expected behavior of the guardrail.
   * They serve as specification tests for the feature.
   */

  describe("Typical task lifecycle", () => {
    it("pending -> active transition should NOT lock", () => {
      const newString = `{
        "status": "active",
        "passes": false
      }`;
      expect(detectsTaskCompletion(newString)).toBe(false);
    });

    it("active -> done with passes:false should NOT lock", () => {
      const newString = `{
        "status": "done",
        "passes": false
      }`;
      expect(detectsTaskCompletion(newString)).toBe(false);
    });

    it("active -> done with passes:true SHOULD lock", () => {
      const newString = `{
        "status": "done",
        "passes": true
      }`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });
  });

  describe("Real-world edit scenarios", () => {
    it("detects completion in a typical Ralph edit operation", () => {
      // This simulates what the edit tool's newString looks like
      const newString = `    {
      "id": 1,
      "description": "Add session completion lock to guardrail plugin",
      "status": "done",
      "passes": true,
      "category": "feature",
      "notes": [
        "Implemented isPlanLockedThisSession state",
        "Added tool.execute.after hook",
        "Added comprehensive tests"
      ]
    }`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });

    it("does not lock on status update without completion", () => {
      const newString = `    {
      "id": 1,
      "description": "Add session completion lock to guardrail plugin",
      "status": "active",
      "passes": false,
      "category": "feature",
      "notes": ["Started implementation"]
    }`;
      expect(detectsTaskCompletion(newString)).toBe(false);
    });

    it("detects completion in minimal surgical edit", () => {
      // Sometimes edits are very targeted
      const newString = `"status": "done",
    "passes": true,
    "notes"`;
      expect(detectsTaskCompletion(newString)).toBe(true);
    });
  });
});
