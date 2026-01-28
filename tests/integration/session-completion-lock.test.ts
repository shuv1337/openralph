/**
 * Integration tests for the session completion lock feature.
 * 
 * Tests the full guardrail plugin behavior including:
 * - session.created reset logic
 * - tool.execute.before blocking
 * - tool.execute.after lock activation
 */
import { describe, it, expect } from "bun:test";
import { PLUGIN_TEMPLATE, detectsTaskCompletion } from "../../src/templates/plugin-template";

describe("Plugin Template Integration", () => {
  describe("PLUGIN_TEMPLATE content", () => {
    it("includes session completion lock state variables", () => {
      expect(PLUGIN_TEMPLATE).toContain("isPlanLockedThisSession");
      expect(PLUGIN_TEMPLATE).toContain("pendingLockActivation");
    });

    it("includes session.created reset logic", () => {
      expect(PLUGIN_TEMPLATE).toContain("session.created");
      expect(PLUGIN_TEMPLATE).toContain("isPlanLockedThisSession = false");
      expect(PLUGIN_TEMPLATE).toContain("pendingLockActivation = false");
      expect(PLUGIN_TEMPLATE).toContain("activeTaskIndex = null");
    });

    it("includes tool.execute.after hook", () => {
      expect(PLUGIN_TEMPLATE).toContain("tool.execute.after");
      expect(PLUGIN_TEMPLATE).toContain('if (input.tool === "edit" && pendingLockActivation)');
      expect(PLUGIN_TEMPLATE).toContain("isPlanLockedThisSession = true");
    });

    it("includes session lock check in tool.execute.before", () => {
      expect(PLUGIN_TEMPLATE).toContain("if (isPlanLockedThisSession)");
      expect(PLUGIN_TEMPLATE).toContain("Task completed this session");
      expect(PLUGIN_TEMPLATE).toContain("Blocking further edits to prd.json");
    });

    it("includes completion detection call", () => {
      expect(PLUGIN_TEMPLATE).toContain("detectsTaskCompletion");
      expect(PLUGIN_TEMPLATE).toContain("if (newString && detectsTaskCompletion(newString))");
    });

    it("includes the detectsTaskCompletion function", () => {
      expect(PLUGIN_TEMPLATE).toContain("function detectsTaskCompletion(newString: string): boolean");
    });

    it("includes platform-agnostic line ending normalization", () => {
      // The template contains regex for normalizing line endings
      expect(PLUGIN_TEMPLATE).toContain("replace(/");
      expect(PLUGIN_TEMPLATE).toContain("Normalize line endings");
    });
  });

  describe("Plugin template structure", () => {
    it("exports RalphWriteGuardrail as Plugin type", () => {
      expect(PLUGIN_TEMPLATE).toContain("export const RalphWriteGuardrail: Plugin");
    });

    it("has proper async plugin factory", () => {
      expect(PLUGIN_TEMPLATE).toContain("RalphWriteGuardrail: Plugin = async () => {");
    });

    it("returns hooks object", () => {
      expect(PLUGIN_TEMPLATE).toContain("return {");
      expect(PLUGIN_TEMPLATE).toContain("event:");
      expect(PLUGIN_TEMPLATE).toContain('"tool.execute.before":');
      expect(PLUGIN_TEMPLATE).toContain('"tool.execute.after":');
    });
  });

  describe("Error messages", () => {
    it("has clear session lock error message", () => {
      expect(PLUGIN_TEMPLATE).toContain("Task completed this session. Blocking further edits to prd.json");
      expect(PLUGIN_TEMPLATE).toContain("only one task can be completed per iteration");
      expect(PLUGIN_TEMPLATE).toContain("Start a new iteration to continue with the next task");
    });

    it("has clear different task error message", () => {
      expect(PLUGIN_TEMPLATE).toContain("Cannot edit multiple tasks in prd.json in a single session");
      expect(PLUGIN_TEMPLATE).toContain("You are already working on task at index");
    });

    it("uses [Ralph Guardrail] prefix for all errors", () => {
      const matches = PLUGIN_TEMPLATE.match(/\[Ralph Guardrail\]/g);
      expect(matches?.length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe("Session Lifecycle Behavior", () => {
  describe("State reset on session.created", () => {
    it("documents that session.created resets all state", () => {
      // This test documents the expected behavior
      // The plugin template should reset all tracking when session.created fires
      const resetCode = `if (event.type === "session.created") {
        activeTaskIndex = null
        isPlanLockedThisSession = false
        pendingLockActivation = false
      }`;
      
      // Normalize whitespace for comparison
      const normalizedTemplate = PLUGIN_TEMPLATE.replace(/\s+/g, " ");
      const normalizedResetCode = resetCode.replace(/\s+/g, " ");
      
      expect(normalizedTemplate).toContain(normalizedResetCode);
    });
  });

  describe("Lock activation timing", () => {
    it("documents that lock activates in after hook, not before", () => {
      // This ensures we don't lock if the edit fails
      // pendingLockActivation is set in before hook
      expect(PLUGIN_TEMPLATE).toContain("pendingLockActivation = true");
      
      // isPlanLockedThisSession is set in after hook
      expect(PLUGIN_TEMPLATE).toContain('"tool.execute.after"');
      
      // The after hook checks pendingLockActivation and sets the lock
      const afterHookPattern = /"tool\.execute\.after".*pendingLockActivation.*isPlanLockedThisSession = true/s;
      expect(afterHookPattern.test(PLUGIN_TEMPLATE)).toBe(true);
    });
  });
});

describe("Compatibility with existing guardrails", () => {
  describe("Write tool protection", () => {
    it("still blocks write tool on protected files", () => {
      expect(PLUGIN_TEMPLATE).toContain('if (input.tool === "write")');
      expect(PLUGIN_TEMPLATE).toContain("Cannot overwrite protected file");
    });
  });

  describe("Bash tool protection", () => {
    it("still blocks bash commands on protected files", () => {
      expect(PLUGIN_TEMPLATE).toContain('if (input.tool === "bash")');
      expect(PLUGIN_TEMPLATE).toContain("Bash command would modify protected file");
    });
  });

  describe("Different task protection", () => {
    it("still blocks editing different tasks in same session", () => {
      expect(PLUGIN_TEMPLATE).toContain("activeTaskIndex !== taskIndex");
      expect(PLUGIN_TEMPLATE).toContain("Cannot edit multiple tasks in prd.json");
    });
  });

  describe("Protected files list", () => {
    it("still protects the standard files", () => {
      expect(PLUGIN_TEMPLATE).toContain('"prd.json"');
      expect(PLUGIN_TEMPLATE).toContain('"progress.txt"');
      expect(PLUGIN_TEMPLATE).toContain('".ralph-prompt.md"');
      expect(PLUGIN_TEMPLATE).toContain('"AGENTS.md"');
    });
  });
});
