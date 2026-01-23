import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { HeadlessRunner, HeadlessExitCodes } from "../../src/headless";
import * as RequirementsModule from "../../src/lib/requirements";
import * as InterruptMenuModule from "../../src/lib/interrupt-menu";
import * as TerminalLauncherModule from "../../src/lib/terminal-launcher";
import { InterruptMenuChoice } from "../../src/lib/interrupt-menu";
import { resetCapabilitiesCache } from "../../src/lib/terminal-capabilities";

/**
 * Headless Features Regression Tests
 * 
 * Verifies the new headless features (requirements validation, interrupt menu, 
 * and terminal keybinds) work correctly and integrate with HeadlessRunner.
 */
describe("Regression: Headless Features", () => {
  const mockLoopOptions = {
    planFile: "prd.json",
    progressFile: "progress.json",
    model: "test-model",
    prompt: "test prompt",
  };

  const mockPersistedState = {
    startTime: Date.now(),
    initialCommitHash: "abc1234",
    iterationTimes: [],
    planFile: "prd.json",
    totalPausedMs: 0,
    lastSaveTime: Date.now(),
  };

  let writeOutput = "";
  const mockWrite = (text: string) => { writeOutput += text; };

  beforeEach(() => {
    writeOutput = "";
    resetCapabilitiesCache();
    // Ensure we don't actually launch terminals or touch files
    spyOn(TerminalLauncherModule, "launchTerminal").mockResolvedValue({ success: true });
    spyOn(TerminalLauncherModule, "detectInstalledTerminals").mockResolvedValue([{ 
      name: "iTerm2", 
      command: "open", 
      args: ["-a", "iTerm", "{cmd}"], 
      platforms: ["darwin"] 
    }]);
  });

  afterEach(() => {
    mock.restore();
  });

  describe("Requirements Validation", () => {
    it("should block start when requirements are not met", async () => {
      // Mock requirements validation to fail
      const validateSpy = spyOn(RequirementsModule, "validateRequirements").mockResolvedValue({
        valid: false,
        missing: ["prd.json"],
        message: "Missing prd.json"
      });

      // Mock stdin to simulate pressing 'q' to quit at the prompt
      const originalStdin = process.stdin;
      let dataCallback: any;
      const mockStdin = {
        isTTY: true,
        isRaw: false,
        setRawMode: mock(() => {}),
        resume: mock(() => {}),
        pause: mock(() => {}),
        on: mock((event, cb) => {
          if (event === "data") dataCallback = cb;
        }),
        removeListener: mock((event, cb) => {
          if (event === "data" && dataCallback === cb) dataCallback = null;
        }),
        removeAllListeners: mock(() => {}),
      } as any;
      
      Object.defineProperty(process, "stdin", { value: mockStdin, configurable: true });

      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: {},
        write: mockWrite,
        autoStart: false, // Force it to wait for start
      });

      const runPromise = runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop: async () => {} // Should not even get here
      });

      // Wait for it to set up listener, then emit 'q'
      await new Promise(r => setTimeout(r, 10));
      if (dataCallback) dataCallback(Buffer.from("q"));

      const exitCode = await runPromise;

      expect(validateSpy).toHaveBeenCalled();
      expect(writeOutput).toContain("Cannot start: missing prerequisites");
      expect(exitCode).toBe(HeadlessExitCodes.INTERRUPTED);

      // Restore stdin
      Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
    });

    it("should allow start when requirements are met", async () => {
      // Mock requirements validation to pass
      spyOn(RequirementsModule, "validateRequirements").mockResolvedValue({
        valid: true,
        missing: [],
        message: "All good"
      });

      // Mock stdin to simulate pressing 'p' to start
      const originalStdin = process.stdin;
      let dataCallback: any;
      const mockStdin = {
        isTTY: true,
        isRaw: false,
        setRawMode: mock(() => {}),
        resume: mock(() => {}),
        pause: mock(() => {}),
        on: mock((event, cb) => {
          if (event === "data") dataCallback = cb;
        }),
        removeListener: mock((event, cb) => {
          if (event === "data" && dataCallback === cb) dataCallback = null;
        }),
        removeAllListeners: mock(() => {}),
      } as any;
      
      Object.defineProperty(process, "stdin", { value: mockStdin, configurable: true });

      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: {},
        write: mockWrite,
        autoStart: false,
      });

      // Start run in background
      const runPromise = runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop: async (opts, state, callbacks) => {
          callbacks.onComplete();
        }
      });

      // Wait for it to set up listener, then emit 'p'
      await new Promise(r => setTimeout(r, 10));
      if (dataCallback) dataCallback(Buffer.from("p"));

      const exitCode = await runPromise;

      expect(exitCode).toBe(HeadlessExitCodes.SUCCESS);
      expect(writeOutput).toContain("Starting...");

      Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
    });
  });

  describe("Interrupt Menu", () => {
    it("should show interrupt menu on SIGINT and handle FORCE_QUIT", async () => {
      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: {},
        write: mockWrite,
        autoStart: true,
      });

      // Mock the menu controller
      const mockMenuController = {
        show: mock(() => Promise.resolve(InterruptMenuChoice.FORCE_QUIT)),
        dismiss: mock(() => {}),
        isVisible: mock(() => false),
        destroy: mock(() => {}),
      };
      const createMenuSpy = spyOn(InterruptMenuModule, "createInterruptMenu").mockReturnValue(mockMenuController as any);

      const runLoop = async (opts, state, callbacks, signal) => {
        // Trigger SIGINT via process.emit (since we registered handlers)
        process.emit("SIGINT", "SIGINT");
        
        // Wait a bit for the async show() to be called and resolved
        await new Promise(r => setTimeout(r, 50));
      };

      const exitCode = await runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop: runLoop as any
      });

      expect(createMenuSpy).toHaveBeenCalled();
      expect(mockMenuController.show).toHaveBeenCalled();
      expect(exitCode).toBe(HeadlessExitCodes.INTERRUPTED);
    });

    it("should resume execution when menu choice is RESUME", async () => {
      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: {},
        write: mockWrite,
        autoStart: true,
      });

      const mockMenuController = {
        show: mock(() => Promise.resolve(InterruptMenuChoice.RESUME)),
        dismiss: mock(() => {}),
        isVisible: mock(() => false),
        destroy: mock(() => {}),
      };
      spyOn(InterruptMenuModule, "createInterruptMenu").mockReturnValue(mockMenuController as any);

      let loopFinished = false;
      const runLoop = async (opts, state, callbacks) => {
        process.emit("SIGINT", "SIGINT");
        await new Promise(r => setTimeout(r, 50));
        loopFinished = true;
        callbacks.onComplete();
      };

      const exitCode = await runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop: runLoop as any
      });

      expect(loopFinished).toBe(true);
      expect(exitCode).toBe(HeadlessExitCodes.SUCCESS);
    });
  });

  describe("Terminal Keybind Integration", () => {
    it("should launch terminal when 't' key is pressed", async () => {
      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: {},
        write: mockWrite,
        autoStart: true,
      });

      // Capture the data handler from stdin to trigger 't' manually
      let stdinDataHandler: any;
      const originalStdin = process.stdin;
      const mockStdin = {
        isTTY: true,
        isRaw: false,
        setRawMode: mock(() => {}),
        resume: mock(() => {}),
        pause: mock(() => {}),
        on: mock((event, cb) => {
          if (event === "data") stdinDataHandler = cb;
        }),
        off: mock(() => {}),
        removeListener: mock(() => {}),
        removeAllListeners: mock(() => {}),
      } as any;
      Object.defineProperty(process, "stdin", { value: mockStdin, configurable: true });

      const runLoop = async (opts, state, callbacks) => {
        // Set mock state to allow terminal launch (needs sessionId)
        callbacks.onSessionCreated({ sessionId: "test-session", serverUrl: "http://localhost:1234", attached: false });
        
        // Wait for stdinDataHandler to be set (by setupInputController)
        await new Promise(r => setTimeout(r, 10));

        // Trigger 't' key
        if (stdinDataHandler) {
          stdinDataHandler(Buffer.from("t"));
        }
        
        // Wait for terminal launch processing
        await new Promise(r => setTimeout(r, 50));
        callbacks.onComplete();
      };

      await runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop: runLoop as any
      });

      expect(TerminalLauncherModule.launchTerminal).toHaveBeenCalled();
      expect(writeOutput).toContain("Opened iTerm2 with session");

      Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
    });
  });

  describe("Runner Integration", () => {
    it("should initialize input controller during run and stop it on cleanup", async () => {
      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: {},
        write: mockWrite,
        autoStart: true,
      });

      const runLoop = async (opts, state, callbacks) => {
        callbacks.onComplete();
      };

      await runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop: runLoop as any
      });

      // Cleanup happens at the end of run()
      expect(writeOutput).toContain("Session terminated.");
    });

    it("should handle platform-specific signals correctly", async () => {
      const originalPlatform = process.platform;
      
      // Mock platform as win32
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      
      const onSpy = spyOn(process, "on");
      
      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: {},
        write: mockWrite,
        autoStart: true,
      });

      const runLoop = async (opts, state, callbacks) => {
        callbacks.onComplete();
      };

      await runner.run({
        loopOptions: mockLoopOptions as any,
        persistedState: mockPersistedState as any,
        runLoop: runLoop as any
      });

      // Verify SIGHUP was NOT registered on Windows
      const registeredSignals = onSpy.mock.calls.map(call => call[0]);
      expect(registeredSignals).not.toContain("SIGHUP");

      // Restore platform
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });
  });
});
