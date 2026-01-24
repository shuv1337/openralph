import { describe, it, expect, mock, spyOn } from "bun:test";
import { HeadlessRunner } from "../../src/headless/runner";
import * as ansi from "../../src/lib/ansi";

describe("HeadlessRunner Lifecycle", () => {
  it("should clear terminal at start and on iteration complete", async () => {
    const clearTerminalSpy = spyOn(ansi, "clearTerminal");
    
    // Mock loopOptions and persistedState
    const loopOptions = { planFile: "plan.md", progressFile: "progress.md", model: "test", prompt: "test" };
    const persistedState = { startTime: Date.now(), initialCommitHash: "abc", iterationTimes: [], planFile: "plan.md", totalPausedMs: 0, lastSaveTime: Date.now() };
    
    // Mock runLoop to just complete one iteration
    const mockRunLoop = mock(async (options, state, callbacks) => {
      callbacks.onIterationStart(1);
      callbacks.onIterationComplete(1, 100, 1);
      callbacks.onComplete();
    });

    const runner = new HeadlessRunner({
      format: "text",
      timestamps: false,
      limits: { maxIterations: 1 },
      autoStart: true,
      write: () => {} // Suppress output
    });

    // Mock terminal as TTY and NOT CI to allow clearing
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    
    // Save CI env vars
    const ciVars = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI'];
    const originalCiValues: Record<string, string | undefined> = {};
    for (const v of ciVars) {
      originalCiValues[v] = process.env[v];
      delete process.env[v];
    }

    try {
      await runner.run({
        loopOptions: loopOptions as any,
        persistedState: persistedState as any,
        runLoop: mockRunLoop as any
      });

      // Should be called at least twice: once at start, once in onIterationComplete
      expect(clearTerminalSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      // Restore TTY
      Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
      
      // Restore CI vars
      for (const v of ciVars) {
        if (originalCiValues[v] !== undefined) {
          process.env[v] = originalCiValues[v];
        } else {
          delete process.env[v];
        }
      }
      
      clearTerminalSpy.mockRestore();
    }
  });
});
