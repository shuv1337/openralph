/**
 * @file HeadlessRunner - Orchestrates headless mode execution
 * @description Class-based architecture for headless mode with proper lifecycle management,
 *              signal handling, and event emitter pattern for extensibility.
 *
 * @version 2.1.0
 * @see docs/architecture/HEADLESS_ARCHITECTURE.md
 */

import type {
  HeadlessConfig,
  HeadlessState,
  HeadlessStats,
  HeadlessEvent,
  HeadlessEventType,
  HeadlessExitCode,
  HeadlessCallbacks,
} from "./types";
import { HeadlessExitCodes } from "./types";
import { createHeadlessOutput, type HeadlessOutput } from "../cli-output";
import { runLoop as defaultRunLoop, type LoopCallbacks } from "../loop";
import {
  saveState,
  type LoopOptions,
  type PersistedState,
  type ToolEvent,
} from "../state";
import {
  cleanupAllSessions,
  forceTerminateDescendants,
} from "../lib/process-cleanup";
import { log } from "../lib/log";
import {
  createHeadlessInputController,
  type HeadlessInputController,
  type InputEvent,
} from "../lib/headless-input";
import {
  createSpinner,
  type SpinnerController,
} from "../lib/spinner";
import {
  createInterruptMenu,
  InterruptMenuChoice,
  type InterruptMenuController,
} from "../lib/interrupt-menu";
import {
  validateRequirements,
  formatRequirementsError,
} from "../lib/requirements";
import { writeFile, unlink } from "node:fs/promises";
import {
  detectInstalledTerminals,
  launchTerminal,
  getAttachCommand,
} from "../lib/terminal-launcher";
import { TerminalService } from "../lib/terminal-service";
import { loadConfig } from "../lib/config";

/**
 * Event handler function type
 */
type EventHandler = (event: HeadlessEvent) => void;

/**
 * Signal handler function type
 */
type SignalHandler = (signal: NodeJS.Signals) => void;

/**
 * Options for running the HeadlessRunner
 */
export interface HeadlessRunnerOptions {
  /** Loop configuration options */
  readonly loopOptions: LoopOptions;
  /** Persisted state from previous runs */
  readonly persistedState: PersistedState;
  /** Function to run the loop (defaults to runLoop from loop.ts) */
  readonly runLoop?: typeof defaultRunLoop;
}

/**
 * HeadlessRunner - Orchestrates headless mode execution with proper lifecycle management.
 *
 * @remarks
 * This class provides:
 * - Clean class-based architecture
 * - Proper signal handling (SIGINT, SIGTERM)
 * - Max iterations and max time limits
 * - State persistence on each iteration
 * - Graceful shutdown with cleanup
 * - Event emitter pattern for extensibility
 *
 * @example
 * ```typescript
 * const config: HeadlessConfig = {
 *   format: "text",
 *   timestamps: true,
 *   limits: { maxIterations: 10, maxTime: 3600 },
 * };
 *
 * const runner = new HeadlessRunner(config);
 *
 * runner.on("tool", (event) => console.log("Tool:", event));
 * runner.on("error", (event) => console.error("Error:", event));
 *
 * const exitCode = await runner.run({ loopOptions, persistedState });
 * ```
 */
export class HeadlessRunner {
  private config: HeadlessConfig;
  private state: HeadlessState;
  private abortController: AbortController;
  private output: HeadlessOutput | null = null;
  private stats: HeadlessStats;

  // Lifecycle management
  private running = false;
  private limitTimer: ReturnType<typeof setTimeout> | undefined;
  private signalHandlerUnregisters: Array<() => void> = [];
  
  // Input handling for keybinds
  private inputController: HeadlessInputController | null = null;
  
  // Loading spinner for active loop state
  private spinner: SpinnerController | null = null;

  // Terminal service for buffer management
  private terminalService: TerminalService;

  // Interrupt menu for user choices
  private interruptMenu: InterruptMenuController | null = null;
  private isMenuActive = false;

  // Stats deduplication
  private lastStatsJson: string = "{}";

  // Event emitter pattern
  private eventHandlers: Map<HeadlessEventType, Set<EventHandler>> = new Map();

  /**
   * Creates a new HeadlessRunner instance.
   *
   * @param config - Headless mode configuration
   */
  constructor(config: HeadlessConfig) {
    this.config = config;
    this.abortController = new AbortController();
    this.terminalService = new TerminalService(config.write);

    // Initialize state
    this.state = {
      status: "initializing",
      iteration: 0,
      isIdle: true,
      adapterMode: "sdk",
    };

    // Initialize stats
    this.stats = {
      startTime: Date.now(),
      tasksComplete: 0,
      totalTasks: 0,
      commits: 0,
      linesAdded: 0,
      linesRemoved: 0,
      iterations: 0,
    };
  }

  /**
   * Run headless mode execution.
   *
   * @param options - Runner options including loop configuration and persisted state
   * @returns Exit code indicating the result of execution
   */
  async run(options: HeadlessRunnerOptions): Promise<HeadlessExitCode> {
    if (this.running) {
      log("headless", "HeadlessRunner.run() called while already running");
      return HeadlessExitCodes.ERROR;
    }

    this.running = true;
    this.stats.startTime = Date.now();
    this.state.status = "running";
    this.abortController = new AbortController();
    this.signalHandlerUnregisters = [];

    const { loopOptions, persistedState, runLoop = defaultRunLoop } = options;

    // Create output coordinator
    this.output = createHeadlessOutput({
      format: this.config.format,
      timestamps: this.config.timestamps,
      startTime: this.stats.startTime,
      write: this.config.write,
      banner: this.config.banner,
    });

    // Clear terminal buffer at the start of execution (Phase 2, Task 4)
    this.clearBuffer();

    // Handle press-to-start feature
    try {
      const shouldWait = await this.shouldWaitForStart();
      if (shouldWait) {
        const startResult = await this.waitForStart(loopOptions.planFile);
        if (!startResult) {
          // User cancelled
          log("headless", "User cancelled at press-to-start prompt");
          await this.cleanup(HeadlessExitCodes.INTERRUPTED);
          return HeadlessExitCodes.INTERRUPTED;
        }
      }
    } catch (error) {
      log("headless", "Error in press-to-start", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue without waiting if there's an error (e.g., non-TTY)
    }
    
    // Explicitly emit start event via emitEvent to ensure handlers are called
    // AND it gets sent to the output/formatter
    this.emitEvent({ type: "start" });

    let exitCode: HeadlessExitCode = HeadlessExitCodes.SUCCESS;
    let completed = false;

    // Set up signal handlers
    this.setupSignalHandlers((code, message) => {
      exitCode = this.requestAbort(code, message, exitCode);
    });

    // Set up input controller for termination keybinds
    this.setupInputController((code, message) => {
      exitCode = this.requestAbort(code, message, exitCode);
    });

    // Set up loading spinner for active loop state
    this.setupSpinner();

    // Set up max time limit if configured
    if (
      this.config.limits.maxTime !== undefined &&
      this.config.limits.maxTime > 0
    ) {
      this.limitTimer = setTimeout(() => {
        exitCode = this.requestAbort(
          HeadlessExitCodes.LIMIT_REACHED,
          `max-time reached (${this.config.limits.maxTime}s)`,
          exitCode
        );
      }, this.config.limits.maxTime * 1000);
    }

    // Build callbacks that wrap output callbacks with additional logic
    const callbacks = this.buildCallbacks(
      persistedState,
      () => exitCode,
      (code, message) => {
        exitCode = this.requestAbort(code, message, exitCode);
      },
      () => {
        completed = true;
      }
    );

    try {
      await runLoop(
        loopOptions,
        persistedState,
        callbacks,
        this.abortController.signal
      );

      // Check for aborted state without explicit completion
      if (
        !completed &&
        exitCode === HeadlessExitCodes.SUCCESS &&
        this.abortController.signal.aborted
      ) {
        exitCode = HeadlessExitCodes.INTERRUPTED;
      }
    } catch (error) {
      log("headless", "Loop error", {
        error: error instanceof Error ? error.message : String(error),
      });
      if (exitCode === HeadlessExitCodes.SUCCESS) {
        exitCode = HeadlessExitCodes.ERROR;
        this.state.status = "error";
        this.state.error =
          error instanceof Error ? error.message : String(error);
      }
    } finally {
      await this.cleanup(exitCode);
    }

    return exitCode;
  }

  /**
   * Pause execution (sets state, but actual pause is handled by loop).
   *
   * @remarks
   * In headless mode, pause typically triggers an abort with INTERRUPTED exit code.
   * The actual pause behavior is controlled by the .ralph-pause file mechanism.
   */
  pause(): void {
    if (!this.running) return;

    log("headless", "Pause requested");
    this.state.status = "paused";
    this.emitEvent({ type: "pause" });
  }

  /**
   * Resume execution (sets state, but actual resume is handled by loop).
   *
   * @remarks
   * The actual resume behavior is controlled by removing the .ralph-pause file.
   */
  resume(): void {
    if (this.state.status !== "paused") return;

    log("headless", "Resume requested");
    this.state.status = "running";
    this.emitEvent({ type: "resume" });
  }

  /**
   * Abort execution with an optional exit code.
   *
   * @param exitCode - Exit code to use (defaults to INTERRUPTED)
   */
  abort(exitCode: HeadlessExitCode = HeadlessExitCodes.INTERRUPTED): void {
    log("headless", "Abort requested", { exitCode });
    this.abortController.abort();
    this.state.status = exitCode === HeadlessExitCodes.SUCCESS ? "complete" : "error";
  }

  /**
   * Get the current state of the runner.
   *
   * @returns Copy of the current state
   */
  getState(): HeadlessState {
    return { ...this.state };
  }

  /**
   * Get the current statistics.
   *
   * @returns Copy of the current stats
   */
  getStats(): HeadlessStats {
    return { ...this.stats };
  }

  /**
   * Register an event handler for a specific event type.
   *
   * @param event - Event type to listen for
   * @param handler - Handler function to call when event occurs
   */
  on(event: HeadlessEventType, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Unregister an event handler for a specific event type.
   *
   * @param event - Event type to stop listening for
   * @param handler - Handler function to remove
   */
  off(event: HeadlessEventType, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  // ===========================================================================
  // Press-to-Start Feature
  // ===========================================================================

  /**
   * Determine if we should wait for user to press a key to start.
   * 
   * @returns True if we should wait, false to start immediately
   */
  private async shouldWaitForStart(): Promise<boolean> {
    // If autoStart is explicitly set, use that value
    if (this.config.autoStart !== undefined) {
      return !this.config.autoStart;
    }

    // Auto-detect based on environment
    // In CI environments, always start immediately
    const isCI = !!(
      process.env.CI ||
      process.env.GITHUB_ACTIONS ||
      process.env.GITLAB_CI ||
      process.env.JENKINS_URL ||
      process.env.BUILDKITE ||
      process.env.CIRCLECI ||
      process.env.TRAVIS
    );

    if (isCI) {
      log("headless", "CI environment detected, auto-starting");
      return false;
    }

    // If stdin is a TTY, wait for keypress (interactive mode)
    if (process.stdin.isTTY) {
      log("headless", "Interactive terminal detected, waiting for keypress");
      return true;
    }

    // For non-TTY (piped input), start immediately
    log("headless", "Non-interactive input, auto-starting");
    return false;
  }

  /**
   * Wait for user to press P to start or Q to quit.
   * Validates requirements before allowing start.
   * 
   * @param planFile - Path to the plan file for requirements validation
   * @returns True if user pressed P/Enter to start, false if cancelled
   */
  private async waitForStart(planFile: string): Promise<boolean> {
    // Only works with TTY
    if (!process.stdin.isTTY) {
      return true;
    }

    const write = this.config.write ?? ((text: string) => process.stdout.write(text));
    
    // Validate requirements before allowing start
    const reqResult = await validateRequirements(planFile);
    
    if (!reqResult.valid) {
      // Requirements not met: show error and only allow Q to quit
      const errorMsg = formatRequirementsError(reqResult);
      write(`\n\x1b[1;31m✗ ${errorMsg}\x1b[0m\n\n`);
      write("\x1b[1;33m▶ Press [Q] to quit...\x1b[0m\n\n");
      
      return new Promise<boolean>((resolve) => {
        const wasRaw = process.stdin.isRaw;
        process.stdin.setRawMode(true);
        process.stdin.resume();

        const cleanup = () => {
          process.stdin.setRawMode(wasRaw ?? false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
        };

        const onData = (data: Buffer) => {
          const key = data.toString().toLowerCase();
          // Only allow quit keys when requirements are missing
          if (key === "q" || key === "\x03" || key === "\x1b") {
            cleanup();
            resolve(false);
          }
          // Ignore all other keys including P
        };

        process.stdin.on("data", onData);
      });
    }
    
    // Requirements met: show normal start prompt
    write("\n\x1b[1;36m▶ Press [P] to start or [Q] to quit...\x1b[0m\n\n");
    write("\x1b[2m(Tip: You can scroll up in your terminal to see previous output)\x1b[0m\n\n");

    return new Promise<boolean>((resolve) => {
      // Save original raw mode state
      const wasRaw = process.stdin.isRaw;
      
      process.stdin.setRawMode(true);
      process.stdin.resume();

      const cleanup = () => {
        process.stdin.setRawMode(wasRaw ?? false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
      };

      const onData = (data: Buffer) => {
        const key = data.toString().toLowerCase();
        
        // Handle quit keys: q, Q, Ctrl+C (0x03), Escape (0x1b)
        if (key === "q" || key === "\x03" || key === "\x1b") {
          cleanup();
          resolve(false);
          return;
        }

        // Handle start keys: p, P, Enter, Space
        if (key === "p" || key === "\r" || key === "\n" || key === " ") {
          cleanup();
          write("\x1b[1;32m▶ Starting...\x1b[0m\n\n");
          resolve(true);
          return;
        }

        // Ignore other keys
      };

      process.stdin.on("data", onData);
    });
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Set up signal handlers for SIGINT, SIGTERM, and SIGHUP.
   * SIGINT shows interrupt menu, SIGTERM force quits.
   */
  private setupSignalHandlers(
    onAbort: (code: HeadlessExitCode, message: string) => void
  ): void {
    // SIGINT shows the interrupt menu (user can choose)
    const sigintHandler: SignalHandler = () => {
      log("headless", "SIGINT received, showing interrupt menu");
      void this.showInterruptMenu(onAbort);
    };
    process.on("SIGINT", sigintHandler);
    this.signalHandlerUnregisters.push(() => {
      process.off("SIGINT", sigintHandler);
    });

    // SIGTERM force quits (typically system request)
    const sigtermHandler: SignalHandler = () => {
      log("headless", "SIGTERM received, forcing quit");
      onAbort(HeadlessExitCodes.INTERRUPTED, "Interrupted (SIGTERM)");
    };
    process.on("SIGTERM", sigtermHandler);
    this.signalHandlerUnregisters.push(() => {
      process.off("SIGTERM", sigtermHandler);
    });

    // SIGHUP is not available on Windows
    if (process.platform !== "win32") {
      const sighupHandler: SignalHandler = () => {
        log("headless", "SIGHUP received, showing interrupt menu");
        void this.showInterruptMenu(onAbort);
      };
      process.on("SIGHUP", sighupHandler);
      this.signalHandlerUnregisters.push(() => {
        process.off("SIGHUP", sighupHandler);
      });
    }

    log("headless", "Signal handlers registered");
  }

  /**
   * Set up input controller for termination keybinds.
   * Handles Ctrl+C, Ctrl+D, q, /exit, /quit commands.
   */
  private setupInputController(
    onAbort: (code: HeadlessExitCode, message: string) => void
  ): void {
    // Create input controller with configured write function
    this.inputController = createHeadlessInputController({
      write: this.config.write,
      showFeedback: true,
      handleSignals: false, // We handle signals separately via setupSignalHandlers
    });

    // Wire up input events to runner actions
    this.inputController.onInput((event: InputEvent) => {
      switch (event.type) {
        case "exit":
        case "eof":
          log("headless", `Exit requested via ${event.type}`, { 
            command: event.command, 
            key: event.key 
          });
          onAbort(HeadlessExitCodes.INTERRUPTED, `User exit (${event.type})`);
          break;

        case "interrupt":
          // Show interrupt menu instead of immediate abort
          log("headless", "Interrupt received from input handler, showing menu");
          void this.showInterruptMenu(onAbort);
          break;

        case "force_quit":
          log("headless", "Force quit received from input handler");
          onAbort(HeadlessExitCodes.INTERRUPTED, "User force quit");
          break;

        case "pause":
          // Show interrupt menu for pause option
          void this.showInterruptMenu(onAbort);
          break;

        case "resume":
          // Resume if paused, otherwise ignore
          if (this.state.status === "paused") {
            void this.resumeSession();
          }
          break;

        case "terminal":
          void this.launchAttachedTerminal();
          break;

        case "command":
          // Log unrecognized commands for debugging
          log("headless", "Unrecognized command", { command: event.command });
          break;

        case "key":
          // Ignore generic key presses
          break;
      }
    });

    // Start the input controller
    this.inputController.start();
    log("headless", "Input controller started");
  }

  /**
   * Set up loading spinner for active loop state.
   * Shows animated spinner when processing is active.
   */
  private setupSpinner(): void {
    this.spinner = createSpinner({
      write: this.config.write,
      text: "Looping...",
      hideCursor: true,
    });
    log("headless", "Spinner initialized");
  }

  /**
   * Start the spinner animation
   */
  private startSpinner(text?: string): void {
    if (this.spinner) {
      if (text) {
        this.spinner.setText(text);
      }
      this.spinner.start();
    }
  }

  /**
   * Stop the spinner animation
   */
  private stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop();
    }
  }

  /**
   * Show the interrupt menu and handle user choice.
   * Pauses spinner during menu display.
   */
  private async showInterruptMenu(
    onAbort: (code: HeadlessExitCode, message: string) => void
  ): Promise<void> {
    // Guard against showing menu multiple times or in terminal state
    if (this.isMenuActive) {
      log("headless", "Interrupt menu already active, ignoring");
      return;
    }
    if (!this.running || this.state.status === "complete" || this.state.status === "error") {
      log("headless", "Cannot show menu in terminal state", { status: this.state.status });
      onAbort(HeadlessExitCodes.INTERRUPTED, "Interrupted");
      return;
    }

    this.isMenuActive = true;

    // Pause spinner while menu is displayed
    this.spinner?.pause();

    // Ensure interrupt menu is created
    if (!this.interruptMenu) {
      this.interruptMenu = createInterruptMenu({
        write: this.config.write,
      });
    }

    try {
      // Show menu and wait for user choice
      const choice = await this.interruptMenu.show();

      log("headless", "Interrupt menu choice", { choice });

      this.isMenuActive = false;

      switch (choice) {
        case InterruptMenuChoice.FORCE_QUIT:
          onAbort(HeadlessExitCodes.INTERRUPTED, "User force quit");
          break;

        case InterruptMenuChoice.PAUSE:
          await this.pauseSession();
          break;

        case InterruptMenuChoice.RESUME:
          // Just resume spinner and continue
          this.spinner?.resume();
          break;
      }
    } catch (error) {
      log("headless", "Interrupt menu error", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.isMenuActive = false;
      // On error, default to resume
      this.spinner?.resume();
    }
  }

  /**
   * Pause the session by creating .ralph-pause file and updating state.
   */
  private async pauseSession(): Promise<void> {
    log("headless", "Pausing session");

    try {
      // Write .ralph-pause file with current PID
      const pauseData = JSON.stringify({
        pid: process.pid,
        pausedAt: Date.now(),
      });
      await writeFile(".ralph-pause", pauseData, "utf-8");
      log("headless", "Created .ralph-pause file");
    } catch (error) {
      log("headless", "Failed to create pause file", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Update state
    this.state.status = "paused";
    this.emitEvent({ type: "pause" });

    const write = this.config.write ?? ((text: string) => process.stdout.write(text));
    write("\n\x1b[1;33m⏸ Session paused.\x1b[0m Press [R] to resume.\n\n");
  }

  /**
   * Resume the session by removing .ralph-pause file and updating state.
   */
  private async resumeSession(): Promise<void> {
    if (this.state.status !== "paused") {
      return;
    }

    log("headless", "Resuming session");

    try {
      // Remove .ralph-pause file
      await unlink(".ralph-pause");
      log("headless", "Removed .ralph-pause file");
    } catch (error) {
      // File might not exist, that's ok
      log("headless", "Could not remove pause file", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Update state
    this.state.status = "running";
    this.emitEvent({ type: "resume" });

    // Resume spinner
    this.spinner?.resume();

    const write = this.config.write ?? ((text: string) => process.stdout.write(text));
    write("\n\x1b[1;32m▶ Session resumed.\x1b[0m\n\n");
  }

  /**
   * Launch an external terminal attached to the current session.
   * Uses terminal-launcher module with user's preferred terminal.
   */
  private async launchAttachedTerminal(): Promise<void> {
    const write = this.config.write ?? ((text: string) => process.stdout.write(text));

    // Check if in PTY mode (can't attach)
    if (this.state.adapterMode === "pty") {
      log("headless", "Cannot open terminal in PTY mode");
      write("[!] Cannot open terminal in PTY mode\n");
      return;
    }

    // Check if session exists
    if (!this.state.sessionId) {
      log("headless", "No active session to attach to");
      write("[!] No active session to attach to\n");
      return;
    }

    try {
      // Detect terminals
      const terminals = await detectInstalledTerminals();
      if (terminals.length === 0) {
        log("headless", "No supported terminal emulators found");
        write("[!] No supported terminal emulators found\n");
        return;
      }

      // Get preferred terminal or use first detected
      const config = loadConfig();
      let terminal = terminals[0];
      if (config.preferredTerminal) {
        const preferred = terminals.find(t => t.name === config.preferredTerminal);
        if (preferred) terminal = preferred;
      }

      // Generate attach command
      const serverUrl = this.state.serverUrl || "http://localhost:10101";
      const cmd = getAttachCommand(serverUrl, this.state.sessionId);

      // Launch terminal
      const result = await launchTerminal(terminal, cmd);
      if (result.success) {
        log("headless", "Opened terminal with session", { terminal: terminal.name });
        write(`[✓] Opened ${terminal.name} with session\n`);
      } else {
        log("headless", "Failed to open terminal", { error: result.error });
        write(`[!] Failed to open terminal: ${result.error}\n`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log("headless", "Terminal launch error", { error: errorMsg });
      write(`[!] Terminal launch error: ${errorMsg}\n`);
    }
  }

  /**
   * Build callbacks that wrap output callbacks with runner-specific logic.
   */
  private buildCallbacks(
    persistedState: PersistedState,
    getExitCode: () => HeadlessExitCode,
    requestAbort: (code: HeadlessExitCode, message: string) => void,
    onCompleted: () => void
  ): LoopCallbacks {
    return {
      // Core iteration callbacks
      onIterationStart: (iteration: number) => {
        this.state.iteration = iteration;
        this.stats.iterations = iteration;

        this.emitEvent({ type: "iteration_start", iteration });

        // Start spinner for this iteration
        this.startSpinner(`Iteration ${iteration} in progress...`);

        // Check max iterations limit
        if (
          this.config.limits.maxIterations !== undefined &&
          this.config.limits.maxIterations > 0 &&
          iteration > this.config.limits.maxIterations
        ) {
          requestAbort(
            HeadlessExitCodes.LIMIT_REACHED,
            `max-iterations reached (${this.config.limits.maxIterations})`
          );
        }
      },

      onEvent: (event: ToolEvent) => {
        if (event.type === "spinner" || event.type === "separator") return;
        
        if (event.type === "tool") {
          this.emitEvent({
            type: "tool",
            iteration: event.iteration,
            name: event.icon || "tool",
            title: event.text,
            detail: event.detail,
          });
        } else if (event.type === "reasoning") {
          this.emitEvent({
            type: "reasoning",
            iteration: event.iteration,
            text: event.text,
          });
        }
      },

      onIterationComplete: (
        iteration: number,
        duration: number,
        commits: number
      ) => {
        // Stop spinner when iteration completes
        this.stopSpinner();

        // Clear terminal buffer between iterations (Phase 2, Task 4)
        this.clearBuffer();

        this.emitEvent({
          type: "iteration_end",
          iteration,
          durationMs: duration,
          commits,
        });

        // Persist state after each iteration
        persistedState.iterationTimes.push(duration);
        persistedState.lastSaveTime = Date.now();
        void saveState(persistedState);
      },

      // Progress callbacks
      onTasksUpdated: (done: number, total: number, error?: string) => {
        this.stats.tasksComplete = done;
        this.stats.totalTasks = total;
        this.emitEvent({ type: "progress", done, total });
        if (error) {
          this.emitEvent({ type: "error", message: error });
        }
      },

      onCommitsUpdated: (commits: number) => {
        this.stats.commits = commits;
        this.emitStats();
      },

      onDiffUpdated: (added: number, removed: number) => {
        this.stats.linesAdded = added;
        this.stats.linesRemoved = removed;
        this.emitStats();
      },

      // State callbacks
      onPause: () => {
        this.state.status = "paused";
        this.emitEvent({ type: "pause" });

        // In headless mode, pause triggers abort
        requestAbort(HeadlessExitCodes.INTERRUPTED, "Paused in headless mode");
      },

      onResume: () => {
        this.state.status = "running";
        this.emitEvent({ type: "resume" });
      },

      onIdleChanged: (isIdle: boolean) => {
        this.state.isIdle = isIdle;
        this.emitEvent({ type: "idle", isIdle });
        
        // Control spinner based on idle state
        if (isIdle) {
          this.stopSpinner();
        } else {
          this.startSpinner("Processing...");
        }
      },

      onComplete: () => {
        this.stopSpinner();
        this.state.status = "complete";
        onCompleted();
        this.emitEvent({ type: "complete" });
      },

      onError: (error: string) => {
        this.stopSpinner();
        this.state.error = error;
        this.emitEvent({ type: "error", message: error });
      },

      // Raw output callback (for PTY mode)
      onRawOutput: (data: string) => {
        this.emitEvent({ type: "output", data });
      },

      // Optional callbacks
      onSessionCreated: (session) => {
        this.state.sessionId = session.sessionId;
        this.state.serverUrl = session.serverUrl;
        this.state.attached = session.attached;
        this.emitEvent({
          type: "session",
          action: "created",
          sessionId: session.sessionId,
          serverUrl: session.serverUrl,
        });
      },

      onSessionEnded: (sessionId: string) => {
        this.state.sessionId = undefined;
        this.state.serverUrl = undefined;
        this.state.attached = undefined;
        this.emitEvent({
          type: "session",
          action: "ended",
          sessionId,
        });
      },

      onBackoff: (backoffMs: number, retryAt: number) => {
        this.state.backoffMs = backoffMs;
        this.state.retryAt = retryAt;
        this.emitEvent({ type: "backoff", backoffMs, retryAt });
      },

      onBackoffCleared: () => {
        this.state.backoffMs = undefined;
        this.state.retryAt = undefined;
        this.emitEvent({ type: "backoff_cleared" });
      },

      onTokens: (tokens) => {
        this.state.tokens = tokens;
        this.emitEvent({
          type: "tokens",
          input: tokens.input,
          output: tokens.output,
          reasoning: tokens.reasoning,
          cacheRead: tokens.cacheRead,
          cacheWrite: tokens.cacheWrite,
        });
      },

      onModel: (model: string) => {
        this.state.model = model;
        this.emitEvent({ type: "model", model });
      },

      onSandbox: (sandbox) => {
        this.emitEvent({
          type: "sandbox",
          enabled: sandbox.enabled ?? false,
          mode: sandbox.mode,
          network: sandbox.network,
        });
      },

      onRateLimit: (state) => {
        this.state.rateLimit = state;
        if (state.fallbackAgent) {
          this.emitEvent({
            type: "rate_limit",
            primaryAgent: state.primaryAgent,
            fallbackAgent: state.fallbackAgent,
          });
        }
      },

      onActiveAgent: (state) => {
        this.state.activeAgent = state;
        this.emitEvent({
          type: "active_agent",
          plugin: state.plugin,
          reason: state.reason ?? "primary",
        });
      },

      onPrompt: (prompt: string) => {
        this.emitEvent({ type: "prompt", prompt });
      },

      onPlanFileModified: () => {
        this.emitEvent({ type: "plan_modified" });
      },

      onAdapterModeChanged: (mode: "sdk" | "pty") => {
        this.state.adapterMode = mode;
        this.emitEvent({ type: "adapter_mode", mode });
      },
    };
  }

  /**
   * Emit current statistics as an event.
   * Only emits if the stats have actually changed (Phase 2, Task 4).
   */
  private emitStats(): void {
    const currentStats = {
      commits: this.stats.commits,
      linesAdded: this.stats.linesAdded,
      linesRemoved: this.stats.linesRemoved,
    };
    
    const statsJson = JSON.stringify(currentStats);
    if (statsJson === this.lastStatsJson) {
      return; // Deduplicate
    }
    
    this.lastStatsJson = statsJson;
    this.emitEvent({
      type: "stats",
      ...currentStats,
    });
  }

  /**
   * Clear the terminal buffer if interactive (Phase 2, Task 4).
   * Re-shows the ASCII banner after clearing (Phase 2, Task 5).
   */
  private clearBuffer(): void {
    this.terminalService.clearBuffer(true);
    this.output?.showBanner();
  }

  /**
   * Request abortion of the execution.
   */
  private requestAbort(
    code: HeadlessExitCode,
    message: string,
    currentExitCode: HeadlessExitCode
  ): HeadlessExitCode {
    // Only update exit code if currently SUCCESS (first abort wins)
    const exitCode =
      currentExitCode === HeadlessExitCodes.SUCCESS ? code : currentExitCode;

    if (message) {
      this.output?.emit({ type: "error", message });
      this.emitEvent({ type: "error", message });
    }

    this.abortController.abort();
    return exitCode;
  }

  /**
   * Emit an event to all registered handlers.
   */
  private emitEvent(event: HeadlessEvent): void {
    // Add timestamp if configured
    if (this.config.timestamps && !event.timestamp) {
      event = { ...event, timestamp: Date.now() };
    }

    // Pause spinner before emitting visible output to prevent interference
    // Events that produce visible output should clear the spinner line first
    const visibleEvents: HeadlessEventType[] = [
      "tool", "reasoning", "error", "progress", "stats", "idle",
      "iteration_start", "iteration_end", "complete", "pause", "resume",
      "model", "sandbox", "active_agent", "adapter_mode",
      "session", "rate_limit", "backoff", "backoff_cleared", "prompt",
      "plan_modified",
    ];
    
    const wasSpinnerRunning = this.spinner?.isRunning() ?? false;
    if (wasSpinnerRunning && visibleEvents.includes(event.type)) {
      this.spinner?.pause();
    }

    // Emit to output if available
    this.output?.emit(event);

    // Emit to registered handlers
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          log("headless", "Event handler error", {
            type: event.type,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }

    // Resume spinner after emitting visible events (if it was running and we're still processing)
    if (wasSpinnerRunning && visibleEvents.includes(event.type) && !this.state.isIdle) {
      this.spinner?.resume();
    }
  }

  /**
   * Clean up resources on exit.
   */
  private async cleanup(exitCode: HeadlessExitCode): Promise<void> {
    log("headless", "Starting cleanup", { exitCode });

    // Clear limit timer if set
    if (this.limitTimer) {
      clearTimeout(this.limitTimer);
      this.limitTimer = undefined;
    }

    // Unregister signal handlers
    for (const unregister of this.signalHandlerUnregisters) {
      unregister();
    }
    this.signalHandlerUnregisters = [];

    // Stop input controller
    if (this.inputController) {
      this.inputController.showTerminationFeedback("Session terminated.");
      this.inputController.stop();
      this.inputController = null;
      log("headless", "Input controller stopped");
    }

    // Stop spinner
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
      log("headless", "Spinner stopped");
    }

    // Clean up interrupt menu
    if (this.interruptMenu) {
      this.interruptMenu.destroy();
      this.interruptMenu = null;
      log("headless", "Interrupt menu destroyed");
    }

    // Run cleanup if enabled
    if (this.config.cleanup?.enabled !== false) {
      const timeout = this.config.cleanup?.timeout ?? 3000;
      const force = this.config.cleanup?.force ?? true;

      try {
        // Clean up all sessions and spawned processes
        const result = await Promise.race([
          cleanupAllSessions(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout)),
        ]);

        if (result === null) {
          log("headless", "Cleanup timed out, forcing termination");
          if (force) {
            await forceTerminateDescendants();
          }
        } else {
          log("headless", "Cleanup completed", {
            terminatedPids: result.terminatedPids.length,
            errors: result.errors.length,
          });
        }
      } catch (error) {
        log("headless", "Cleanup error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Finalize output
    if (this.output) {
      this.output.finalize(exitCode);
    }

    // Update state
    this.running = false;
    this.state.status =
      exitCode === HeadlessExitCodes.SUCCESS ? "complete" : "error";

    log("headless", "Cleanup complete", { exitCode });
  }
}

/**
 * Create a HeadlessRunner with default configuration.
 *
 * @param overrides - Configuration overrides
 * @returns Configured HeadlessRunner instance
 */
export function createHeadlessRunner(
  overrides: Partial<HeadlessConfig> = {}
): HeadlessRunner {
  const defaultConfig: HeadlessConfig = {
    format: "text",
    timestamps: false,
    limits: {},
    ...overrides,
  };

  return new HeadlessRunner(defaultConfig);
}
