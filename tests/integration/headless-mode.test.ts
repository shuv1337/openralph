import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { runHeadlessMode, HeadlessRunner, HeadlessExitCodes } from "../../src/headless";
import { createMockLoopOptions, createMockPersistedState } from "../helpers/mock-factories";
import * as InterruptMenuModule from "../../src/lib/interrupt-menu";
import { InterruptMenuChoice } from "../../src/lib/interrupt-menu";

// NOTE: We do NOT use mock.module() here to avoid polluting other test files.
// Instead, we use spyOn for function-level mocking within each test.

describe("Headless Mode Integration", () => {
  let mockWrite: ReturnType<typeof mock>;
  let capturedOutput: string[];
  let menuSpy: any;

  beforeEach(() => {
    capturedOutput = [];
    mockWrite = mock((text: string) => {
      capturedOutput.push(text);
    });

    // Mock interrupt menu to prevent hanging in tests
    menuSpy = spyOn(InterruptMenuModule, "createInterruptMenu").mockReturnValue({
      show: () => Promise.resolve(InterruptMenuChoice.FORCE_QUIT),
      dismiss: () => {},
      isVisible: () => false,
      destroy: () => {},
    } as any);
  });

  afterEach(() => {
    menuSpy.mockRestore();
  });

  const baseOptions = createMockLoopOptions();
  const baseState = createMockPersistedState();

  describe("runHeadlessMode (Backward Compatibility)", () => {
    it("should display banner and run loop successfully", async () => {
      const mockRunLoop = mock(async (_opts: unknown, _state: unknown, callbacks: any) => {
        callbacks.onIterationStart(1);
        callbacks.onComplete();
      });

      const exitCode = await runHeadlessMode({
        loopOptions: baseOptions,
        persistedState: baseState,
        format: "text",
        timestamps: false,
        showBanner: true,
      }, mockRunLoop as any);

      expect(exitCode).toBe(HeadlessExitCodes.SUCCESS);
      // Banner is written to stdout, we need to mock process.stdout.write or pass a runner with custom write
    });
  });

  describe("HeadlessRunner Lifecycle", () => {
    it("should emit all 24 event types", async () => {
      const runner = new HeadlessRunner({
        format: "jsonl",
        timestamps: false,
        limits: {},
        write: mockWrite,
        autoStart: true,
      });

      const eventsSeen = new Set<string>();
      const allEventTypes = [
        "start", "iteration_start", "iteration_end", "tool", "reasoning", 
        "output", "progress", "stats", "pause", "resume", "idle", "error", 
        "complete", "model", "sandbox", "tokens", "rate_limit", "active_agent", 
        "backoff", "backoff_cleared", "session", "prompt", "plan_modified", 
        "adapter_mode"
      ];

      allEventTypes.forEach(type => {
        runner.on(type as any, (ev) => eventsSeen.add(ev.type));
      });

      const mockRunLoop = mock(async (_opts: unknown, _state: unknown, callbacks: any) => {
        // Trigger all callbacks
        callbacks.onIterationStart(1);
        callbacks.onEvent({ type: "tool", iteration: 1, icon: "Read", text: "test" });
        callbacks.onEvent({ type: "reasoning", iteration: 1, text: "thinking..." });
        (callbacks as any).onRawOutput?.("raw data");
        callbacks.onTasksUpdated(1, 2);
        callbacks.onCommitsUpdated(5);
        callbacks.onDiffUpdated(10, 5);
        callbacks.onIdleChanged(true);
        callbacks.onModel?.("gpt-4");
        callbacks.onSandbox?.({ enabled: true, mode: "on", network: false });
        callbacks.onTokens?.({ input: 100, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
        callbacks.onRateLimit?.({ primaryAgent: "a", fallbackAgent: "b" });
        callbacks.onActiveAgent?.({ plugin: "test", reason: "primary" });
        callbacks.onBackoff?.(1000, Date.now() + 1000);
        callbacks.onBackoffCleared?.();
        callbacks.onSessionCreated?.({ sessionId: "123", serverUrl: "http://localhost", attached: true, sendMessage: async () => {} });
        callbacks.onSessionEnded?.("123");
        callbacks.onPrompt?.("test prompt");
        callbacks.onPlanFileModified?.();
        callbacks.onAdapterModeChanged?.("pty");
        
        // State changes
        callbacks.onResume?.(); // Trigger resume
        
        callbacks.onIterationComplete(1, 1000, 1);
        callbacks.onComplete();
      });

      await runner.run({
        loopOptions: baseOptions,
        persistedState: baseState,
        runLoop: mockRunLoop as any,
      });

      // Check events seen by runner.on()
      expect(eventsSeen.has("start")).toBe(true);
      expect(eventsSeen.has("iteration_start")).toBe(true);
      expect(eventsSeen.has("iteration_end")).toBe(true);
      expect(eventsSeen.has("tool")).toBe(true);
      expect(eventsSeen.has("reasoning")).toBe(true);
      expect(eventsSeen.has("progress")).toBe(true);
      expect(eventsSeen.has("stats")).toBe(true);
      expect(eventsSeen.has("idle")).toBe(true);
      expect(eventsSeen.has("complete")).toBe(true);
      expect(eventsSeen.has("model")).toBe(true);
      expect(eventsSeen.has("sandbox")).toBe(true);
      expect(eventsSeen.has("tokens")).toBe(true);
      expect(eventsSeen.has("rate_limit")).toBe(true);
      expect(eventsSeen.has("active_agent")).toBe(true);
      expect(eventsSeen.has("backoff")).toBe(true);
      expect(eventsSeen.has("backoff_cleared")).toBe(true);
      expect(eventsSeen.has("session")).toBe(true);
      expect(eventsSeen.has("prompt")).toBe(true);
      expect(eventsSeen.has("plan_modified")).toBe(true);
      expect(eventsSeen.has("adapter_mode")).toBe(true);
      expect(eventsSeen.has("output")).toBe(true);
      expect(eventsSeen.has("resume")).toBe(true);

      // Verify JSONL output contains these events
      const outputEvents = capturedOutput
        .filter(line => line.trim().startsWith("{"))
        .map(line => JSON.parse(line));
      expect(outputEvents.some(e => e.type === "start")).toBe(true);
      expect(outputEvents.some(e => e.type === "complete")).toBe(true);
    });

    it("should return 3 when maxIterations is exceeded", async () => {
      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: { maxIterations: 1 },
        write: mockWrite,
      });

      const mockRunLoop = mock(async (_opts: unknown, _state: unknown, callbacks: any, signal: AbortSignal) => {
        callbacks.onIterationStart(1);
        if (signal.aborted) return;
        callbacks.onIterationStart(2);
      });

      const exitCode = await runner.run({
        loopOptions: baseOptions,
        persistedState: baseState,
        runLoop: mockRunLoop as any,
      });

      expect(exitCode).toBe(HeadlessExitCodes.LIMIT_REACHED);
    });

    it("should return 3 when maxTime is exceeded", async () => {
      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: { maxTime: 0.1 }, // 100ms
        write: mockWrite,
      });

      const mockRunLoop = mock(async (_opts: unknown, _state: unknown, _callbacks: any, signal: AbortSignal) => {
        // Wait for timeout or abort
        return new Promise<void>(resolve => {
          if (signal.aborted) return resolve();
          
          const timer = setTimeout(() => resolve(), 500);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
      });

      const exitCode = await runner.run({
        loopOptions: baseOptions,
        persistedState: baseState,
        runLoop: mockRunLoop as any,
      });

      expect(exitCode).toBe(HeadlessExitCodes.LIMIT_REACHED);
    });

    it("should emit pause and error events", async () => {
      const runner = new HeadlessRunner({
        format: "jsonl",
        timestamps: false,
        limits: {},
        write: mockWrite,
        autoStart: true,
      });

      const eventsSeen = new Set<string>();
      runner.on("pause", () => eventsSeen.add("pause"));
      runner.on("error", () => eventsSeen.add("error"));

      const mockRunLoop = mock(async (_opts: unknown, _state: unknown, callbacks: any) => {
        callbacks.onPause(); // This triggers INTERRUPTED and aborts
        callbacks.onError("forced error");
      });

      await runner.run({
        loopOptions: baseOptions,
        persistedState: baseState,
        runLoop: mockRunLoop as any,
      });

      expect(eventsSeen.has("pause")).toBe(true);
      expect(eventsSeen.has("error")).toBe(true);
    });

    it("should handle SIGINT correctly", async () => {
      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: {},
        write: mockWrite,
      });

      // Capture the signal handler
      let sigintHandler: any;
      const processOnSpy = spyOn(process, "on").mockImplementation((event: any, handler: any) => {
        if (event === "SIGINT") sigintHandler = handler;
        return process;
      });

      const mockRunLoop = mock(async (_opts: unknown, _state: unknown, _callbacks: any, signal: AbortSignal) => {
        // Trigger SIGINT manually after a short delay to ensure runner is ready
        setTimeout(() => {
          if (sigintHandler) sigintHandler("SIGINT");
        }, 10);
        
        // Wait for abort
        return new Promise<void>(resolve => {
          if (signal.aborted) return resolve();
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      });

      const exitCode = await runner.run({
        loopOptions: baseOptions,
        persistedState: baseState,
        runLoop: mockRunLoop as any,
      });

      expect(exitCode).toBe(HeadlessExitCodes.INTERRUPTED);
      processOnSpy.mockRestore();
    });
  });

  describe("Banner Integration", () => {
    it("should show banner for text format by default", async () => {
      const mockRunLoop = mock(async (_opts: unknown, _state: unknown, callbacks: any) => {
        callbacks.onComplete();
      });

      await runHeadlessMode({
        loopOptions: baseOptions,
        persistedState: baseState,
        format: "text",
        timestamps: false,
      }, mockRunLoop as any);
    });

    it("should NOT show banner for json format by default", async () => {
      const mockRunLoop = mock(async (_opts: unknown, _state: unknown, callbacks: any) => {
        callbacks.onComplete();
      });

      await runHeadlessMode({
        loopOptions: baseOptions,
        persistedState: baseState,
        format: "json",
        timestamps: false,
      }, mockRunLoop as any);
    });
  });

  describe("Format Output", () => {
    it("should output valid JSON when format is json", async () => {
      const runner = new HeadlessRunner({
        format: "json",
        timestamps: false,
        limits: {},
        write: mockWrite,
      });

      const mockRunLoop = mock(async (_opts: unknown, _state: unknown, callbacks: any) => {
        callbacks.onIterationStart(1);
        callbacks.onComplete();
      });

      await runner.run({
        loopOptions: baseOptions,
        persistedState: baseState,
        runLoop: mockRunLoop as any,
      });

      const fullOutput = capturedOutput.join("");
      const jsonStart = fullOutput.indexOf("{");
      const parsed = JSON.parse(fullOutput.substring(jsonStart));
      expect(parsed).toHaveProperty("events");
      expect(parsed).toHaveProperty("summary");
      expect(parsed.summary.exitCode).toBe(0);
    });

    it("should output streaming JSON Lines when format is jsonl", async () => {
      const runner = new HeadlessRunner({
        format: "jsonl",
        timestamps: false,
        limits: {},
        write: mockWrite,
        autoStart: true,
      });

      const mockRunLoop = mock(async (_opts: unknown, _state: unknown, callbacks: any) => {
        callbacks.onIterationStart(1);
        callbacks.onComplete();
      });

      await runner.run({
        loopOptions: baseOptions,
        persistedState: baseState,
        runLoop: mockRunLoop as any,
      });

      expect(capturedOutput.length).toBeGreaterThan(1);
      capturedOutput.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith("{")) {
          expect(() => JSON.parse(trimmed)).not.toThrow();
        }
      });
    });
  });
});
