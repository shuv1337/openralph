import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { HeadlessRunner } from "../../src/headless/runner";
import { HeadlessExitCodes } from "../../src/headless/types";
import * as ansi from "../../src/lib/ansi";
import * as terminalCapabilities from "../../src/lib/terminal-capabilities";
import * as windowsConsole from "../../src/lib/windows-console";

describe("Headless Mode Optimization Regression", () => {
  let mockWrite: any;
  let capturedOutput: string[];

  beforeEach(() => {
    capturedOutput = [];
    mockWrite = mock((text: string) => {
      capturedOutput.push(text);
    });
  });

  describe("Stats Deduplication", () => {
    it("should NOT emit duplicate stats events", async () => {
      const runner = new HeadlessRunner({
        format: "jsonl",
        timestamps: false,
        limits: {},
        write: mockWrite,
      });

      const runnerAny = runner as any;
      runnerAny.output = {
        emit: mock((event: any) => {
          if (event.type === "stats") {
            mockWrite(JSON.stringify(event));
          }
        }),
        showBanner: mock(() => {}),
        finalize: mock(() => {}),
      };

      // Initial stats
      runnerAny.stats.commits = 1;
      runnerAny.stats.linesAdded = 10;
      runnerAny.stats.linesRemoved = 5;

      // First emission
      runnerAny.emitStats();
      expect(mockWrite).toHaveBeenCalledTimes(1);

      // Duplicate emission
      runnerAny.emitStats();
      expect(mockWrite).toHaveBeenCalledTimes(1);

      // Change and emit
      runnerAny.stats.commits = 2;
      runnerAny.emitStats();
      expect(mockWrite).toHaveBeenCalledTimes(2);
    });
  });

  describe("Terminal Buffer Management", () => {
    let clearTerminalSpy: any;
    let capsSpy: any;
    let vtSpy: any;

    beforeEach(() => {
      clearTerminalSpy = spyOn(ansi, "clearTerminal");
      capsSpy = spyOn(terminalCapabilities, "getCapabilities");
      vtSpy = spyOn(windowsConsole, "isVTSupported");
    });

    afterEach(() => {
      clearTerminalSpy.mockRestore();
      capsSpy.mockRestore();
      vtSpy.mockRestore();
    });

    it("should clear terminal when interactive and VT is supported", async () => {
      capsSpy.mockReturnValue({ isInteractive: true, isCI: false } as any);
      vtSpy.mockReturnValue(true);

      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: { maxIterations: 1 },
        autoStart: true,
        write: mockWrite,
      });

      const mockRunLoop = mock(async (_opts: any, _state: any, callbacks: any) => {
        callbacks.onIterationStart(1);
        callbacks.onIterationComplete(1, 100, 1);
        callbacks.onComplete();
      });

      await runner.run({
        loopOptions: {} as any,
        persistedState: {} as any,
        runLoop: mockRunLoop as any,
      });

      // Once at start, once in onIterationComplete
      expect(clearTerminalSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("should use fallback newlines when interactive but VT is NOT supported", async () => {
      capsSpy.mockReturnValue({ isInteractive: true, isCI: false } as any);
      vtSpy.mockReturnValue(false);

      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: { maxIterations: 1 },
        autoStart: true,
        write: mockWrite,
      });

      const mockRunLoop = mock(async (_opts: any, _state: any, callbacks: any) => {
        callbacks.onIterationStart(1);
        callbacks.onIterationComplete(1, 100, 1);
        callbacks.onComplete();
      });

      await runner.run({
        loopOptions: {} as any,
        persistedState: {} as any,
        runLoop: mockRunLoop as any,
      });

      expect(clearTerminalSpy).not.toHaveBeenCalled();
      expect(capturedOutput.join("")).toContain("\n\n\n");
    });

    it("should show banner AFTER clearing the terminal at start", async () => {
      capsSpy.mockReturnValue({ isInteractive: true, isCI: false } as any);
      vtSpy.mockReturnValue(true);
      clearTerminalSpy.mockImplementation(() => {
        mockWrite("[CLEAR]");
      });

      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: { maxIterations: 1 },
        autoStart: true,
        write: mockWrite,
      });

      const mockRunLoop = mock(async (_opts: any, _state: any, callbacks: any) => {
        callbacks.onComplete();
      });

      await runner.run({
        loopOptions: {} as any,
        persistedState: {} as any,
        runLoop: mockRunLoop as any,
      });

      const output = capturedOutput.join("");
      const clearIndex = output.indexOf("[CLEAR]");
      // The banner typically contains "OpenRalph"
      const bannerIndex = output.indexOf("OpenRalph");
      
      expect(clearIndex).toBeLessThan(bannerIndex);
      expect(clearIndex).not.toBe(-1);
      expect(bannerIndex).not.toBe(-1);
    });

    it("should NOT clear terminal when in CI", async () => {
      capsSpy.mockReturnValue({ isInteractive: true, isCI: true } as any);
      vtSpy.mockReturnValue(true);

      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: { maxIterations: 1 },
        autoStart: true,
        write: mockWrite,
      });

      const mockRunLoop = mock(async (_opts: any, _state: any, callbacks: any) => {
        callbacks.onIterationStart(1);
        callbacks.onIterationComplete(1, 100, 1);
        callbacks.onComplete();
      });

      await runner.run({
        loopOptions: {} as any,
        persistedState: {} as any,
        runLoop: mockRunLoop as any,
      });

      expect(clearTerminalSpy).not.toHaveBeenCalled();
    });
  });

  describe("Spinner Synchronization", () => {
    it("should pause spinner for plan_modified event", async () => {
      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: {},
        write: mockWrite,
      });

      const runnerAny = runner as any;
      
      // Initialize spinner
      runnerAny.setupSpinner();
      const spinner = runnerAny.spinner;
      const pauseSpy = spyOn(spinner, "pause");
      const resumeSpy = spyOn(spinner, "resume");
      
      // Mock spinner as running
      spyOn(spinner, "isRunning").mockReturnValue(true);
      
      // Ensure runner is NOT idle so it resumes
      runnerAny.state.isIdle = false;

      // Emit plan_modified
      runnerAny.emitEvent({ type: "plan_modified" });

      expect(pauseSpy).toHaveBeenCalled();
      // It should also resume if not idle
      expect(resumeSpy).toHaveBeenCalled();
    });
  });
});
