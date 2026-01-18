import { describe, it, expect } from "bun:test";
import { EXECUTION_STATE_STYLES } from "../../src/lib/tool-states";

describe("Tool Execution States", () => {
  it("should have styles defined for all standard states", () => {
    const states = ["pending", "running", "completed", "error", "cancelled"];
    for (const state of states) {
      expect(EXECUTION_STATE_STYLES[state as any]).toBeDefined();
    }
  });

  it("should have correct properties for running state", () => {
    const running = EXECUTION_STATE_STYLES.running;
    expect(running.icon).toBeDefined();
    expect(running.iconAnimated).toBe(true);
    expect(running.pulse).toBe(true);
    expect(running.color).toBe("info");
  });

  it("should have correct properties for completed state", () => {
    const completed = EXECUTION_STATE_STYLES.completed;
    expect(completed.iconAnimated).toBe(false);
    expect(completed.pulse).toBe(false);
    expect(completed.color).toBe("success");
  });
});
