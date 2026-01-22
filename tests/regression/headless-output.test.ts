import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import { runHeadlessMode, HeadlessRunner, HeadlessExitCodes } from "../../src/headless";
import type { HeadlessEvent, HeadlessSummary } from "../../src/headless/types";
import { resetCapabilitiesCache } from "../../src/lib/terminal-capabilities";

// NOTE: We do NOT use mock.module() here to avoid polluting other test files.
// Banner tests that check for specific content should use spyOn or accept the real output.

/**
 * Headless Mode Regression Tests
 * 
 * Verifies that headless mode output formats, exit codes, and event sequences
 * remain stable across changes.
 */
describe("Regression: Headless Mode", () => {
  // Mock persisted state
  const mockPersistedState = {
    startTime: Date.now(),
    initialCommitHash: "abc1234",
    iterationTimes: [],
    planFile: "plan.md",
    totalPausedMs: 0,
    lastSaveTime: Date.now(),
  };

  // Mock loop options
  const mockLoopOptions = {
    planFile: "plan.md",
    progressFile: "progress.json",
    model: "test-model",
    prompt: "test prompt",
  };

  beforeEach(() => {
    resetCapabilitiesCache();
  });

  describe("Output Format Stability", () => {
    it("should produce valid JSON output schema", async () => {
      let output = "";
      const write = (text: string) => { output += text; };

      // Mock runLoop to emit some events
      const runLoop = async (_opts: any, _state: any, callbacks: any) => {
        callbacks.onIterationStart(1);
        callbacks.onEvent({ type: "tool", name: "read", title: "Read file", iteration: 1 });
        callbacks.onIterationComplete(1, 100, 0);
        callbacks.onComplete();
      };

      const runner = new HeadlessRunner({
        format: "json",
        timestamps: false,
        limits: {},
        write,
      });

      const exitCode = await runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop,
      });

      expect(exitCode).toBe(HeadlessExitCodes.SUCCESS);
      
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty("events");
      expect(parsed).toHaveProperty("summary");
      expect(parsed.events).toBeArray();
      expect(parsed.events.length).toBeGreaterThan(0);
      expect(parsed.summary.exitCode).toBe(0);
      
      // Verify first event is 'start'
      expect(parsed.events[0].type).toBe("start");
    });

    it("should produce valid JSONL event structure", async () => {
      const lines: string[] = [];
      const write = (text: string) => {
        if (text.endsWith("\n")) {
          lines.push(...text.split("\n").filter(Boolean));
        } else {
          // Simplistic for test
          lines.push(text);
        }
      };

      const runLoop = async (_opts: any, _state: any, callbacks: any) => {
        callbacks.onIterationStart(1);
        callbacks.onIterationComplete(1, 100, 0);
        callbacks.onComplete();
      };

      const runner = new HeadlessRunner({
        format: "jsonl",
        timestamps: false,
        limits: {},
        write,
      });

      await runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop,
      });

      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty("type");
      }

      // Last event should be summary
      const lastEvent = JSON.parse(lines[lines.length - 1]);
      expect(lastEvent.type).toBe("summary");
    });

    it("should produce text output with expected structure", async () => {
      let output = "";
      const write = (text: string) => { output += text; };

      const runLoop = async (_opts: any, _state: any, callbacks: any) => {
        callbacks.onIterationStart(1);
        callbacks.onEvent({ type: "tool", name: "bash", title: "Run tests", iteration: 1 });
        callbacks.onIterationComplete(1, 500, 1);
        callbacks.onComplete();
      };

      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: {},
        write,
      });

      await runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop,
      });

      // Verify expected text output elements
      expect(output).toContain("Iteration 1");
      expect(output).toContain("Summary");
      expect(output).toContain("Status:");
    });
  });

  describe("Exit Code Consistency", () => {
    it("should exit with code 0 on success", async () => {
      const runner = new HeadlessRunner({ format: "text", timestamps: false, limits: {} });
      const runLoop = async (_o: any, _s: any, callbacks: any) => { callbacks.onComplete(); };
      
      const exitCode = await runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop,
      });
      expect(exitCode).toBe(HeadlessExitCodes.SUCCESS);
    });

    it("should exit with code 1 on error", async () => {
      const runner = new HeadlessRunner({ format: "text", timestamps: false, limits: {} });
      const runLoop = async () => { throw new Error("Boom"); };
      
      const exitCode = await runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop,
      });
      expect(exitCode).toBe(HeadlessExitCodes.ERROR);
    });

    it("should exit with code 3 when max iterations reached", async () => {
      const runner = new HeadlessRunner({ 
        format: "text", 
        timestamps: false, 
        limits: { maxIterations: 2 } 
      });
      
      const runLoop = async (_o: any, _s: any, callbacks: any) => {
        callbacks.onIterationStart(1);
        callbacks.onIterationComplete(1, 10, 0);
        callbacks.onIterationStart(2);
        callbacks.onIterationComplete(2, 10, 0);
        callbacks.onIterationStart(3); // Should trigger limit
      };
      
      const exitCode = await runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop,
      });
      expect(exitCode).toBe(HeadlessExitCodes.LIMIT_REACHED);
    });
  });

  describe("Event Emission", () => {
    it("should emit events in correct order", async () => {
      const events: string[] = [];
      const runner = new HeadlessRunner({ format: "text", timestamps: false, limits: {} });
      
      runner.on("start", () => events.push("start"));
      runner.on("iteration_start", () => events.push("iter_start"));
      runner.on("tool", () => events.push("tool"));
      runner.on("iteration_end", () => events.push("iter_end"));
      runner.on("complete", () => events.push("complete"));

      const runLoop = async (_o: any, _s: any, callbacks: any) => {
        callbacks.onIterationStart(1);
        callbacks.onEvent({ type: "tool", name: "bash", title: "test", iteration: 1 });
        callbacks.onIterationComplete(1, 10, 0);
        callbacks.onComplete();
      };

      await runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop,
      });

      expect(events).toEqual(["start", "iter_start", "tool", "iter_end", "complete"]);
    });

    it("should include timestamps when enabled", async () => {
      const events: HeadlessEvent[] = [];
      const runner = new HeadlessRunner({ 
        format: "json", 
        timestamps: true, 
        limits: {},
        write: (text) => {
          const parsed = JSON.parse(text);
          events.push(...parsed.events);
        }
      });

      const runLoop = async (_o: any, _s: any, callbacks: any) => {
        callbacks.onComplete();
      };

      await runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop,
      });

      expect(events[0].timestamp).toBeDefined();
      expect(typeof events[0].timestamp).toBe("number");
    });
  });

  describe("Banner Rendering", () => {
    it("should render banner for text format when enabled", async () => {
      let output = "";

      // Mock process.stdout.write to capture output
      const originalWrite = process.stdout.write;
      process.stdout.write = ((text: string) => {
        output += text;
        return true;
      }) as any;

      try {
        await runHeadlessMode({
          loopOptions: mockLoopOptions as any,
          persistedState: mockPersistedState as any,
          format: "text",
          timestamps: false,
          showBanner: true,
          bannerOptions: { style: "minimal" } as any
        }, async (_o, _s, callbacks) => {
          callbacks.onComplete();
        });
      } finally {
        process.stdout.write = originalWrite;
      }

      // Minimal style banner contains "OpenRalph"
      expect(output).toContain("OpenRalph");
    });

    it("should skip banner for JSON format when --banner false", async () => {
      let output = "";
      const originalWrite = process.stdout.write;
      process.stdout.write = ((text: string) => {
        output += text;
        return true;
      }) as any;

      try {
        await runHeadlessMode({
          loopOptions: mockLoopOptions as any,
          persistedState: mockPersistedState as any,
          format: "json",
          timestamps: false,
          showBanner: false, // Explicitly disable banner for clean JSON output
        }, async (_o, _s, callbacks) => {
          callbacks.onComplete();
        });
      } finally {
        process.stdout.write = originalWrite;
      }

      // JSON output should be the only thing in output, starting with {
      expect(output.trim().startsWith("{")).toBe(true);
    });

    it("should show banner for JSON format by default", async () => {
      let output = "";
      const originalWrite = process.stdout.write;
      process.stdout.write = ((text: string) => {
        output += text;
        return true;
      }) as any;

      try {
        await runHeadlessMode({
          loopOptions: mockLoopOptions as any,
          persistedState: mockPersistedState as any,
          format: "json",
          timestamps: false,
          // showBanner defaults to true in headless mode
        }, async (_o, _s, callbacks) => {
          callbacks.onComplete();
        });
      } finally {
        process.stdout.write = originalWrite;
      }

      // Banner should be shown before the JSON
      // Either the graphical banner (filled blocks) or text "OpenRalph" depending on terminal
      const hasBanner = output.includes("OpenRalph") || output.includes("██████");
      expect(hasBanner).toBe(true);
      // JSON should also be in the output
      expect(output).toContain("{");
    });
  });
});
