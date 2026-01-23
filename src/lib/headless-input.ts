/**
 * Headless Input Handler Module
 *
 * Provides cross-platform keyboard input handling for headless CLI mode.
 * Supports graceful termination via keyboard shortcuts and commands.
 *
 * Supported keybinds:
 * - Ctrl+C (SIGINT): Interrupt current operation / Exit
 * - Ctrl+D (EOF): Exit when input is empty (Unix/macOS)
 * - Ctrl+\ (SIGQUIT): Force quit (Unix/macOS)
 * - q/Q: Quick exit command
 * - p/P: Pause execution
 * - r/R: Resume execution
 * - t/T: Launch terminal attached to session
 * - /exit, /quit: Typed exit commands
 *
 * Features:
 * - Cross-platform support (Windows, Linux, macOS)
 * - Works with various terminal emulators
 * - Visual feedback on termination
 * - Graceful cleanup before exit
 */

import { getCapabilities } from "./terminal-capabilities";

// =============================================================================
// Types
// =============================================================================

/**
 * Input event types
 */
export type InputEventType =
  | "exit"        // User requested exit
  | "pause"       // User requested pause (p key)
  | "resume"      // User requested resume (r key)
  | "terminal"    // User requested terminal launch (t key)
  | "interrupt"   // Ctrl+C pressed
  | "force_quit"  // Ctrl+\ or force exit
  | "eof"         // Ctrl+D pressed
  | "command"     // User entered a command
  | "key";        // Generic key press

/**
 * Input event structure
 */
export interface InputEvent {
  readonly type: InputEventType;
  readonly key?: string;
  readonly command?: string;
  readonly rawBuffer?: Buffer;
}

/**
 * Input handler callback
 */
export type InputHandler = (event: InputEvent) => void;

/**
 * Headless input controller interface
 */
export interface HeadlessInputController {
  /**
   * Start listening for input
   */
  start(): void;

  /**
   * Stop listening for input
   */
  stop(): void;

  /**
   * Register an event handler
   */
  onInput(handler: InputHandler): void;

  /**
   * Remove an event handler
   */
  offInput(handler: InputHandler): void;

  /**
   * Check if currently listening
   */
  isListening(): boolean;

  /**
   * Display visual feedback for termination
   */
  showTerminationFeedback(message?: string): void;
}

/**
 * Options for creating input controller
 */
export interface HeadlessInputOptions {
  /** Custom write function for output */
  write?: (text: string) => void;
  /** Whether to show visual feedback on termination */
  showFeedback?: boolean;
  /** Whether to handle signals (SIGINT, etc.) */
  handleSignals?: boolean;
}

// =============================================================================
// Key Codes
// =============================================================================

/**
 * Special key code constants
 */
export const KEY_CODES = {
  CTRL_C: "\x03",      // ETX (End of Text) - Ctrl+C
  CTRL_D: "\x04",      // EOT (End of Transmission) - Ctrl+D
  CTRL_BACKSLASH: "\x1c", // FS (File Separator) - Ctrl+\
  CTRL_Z: "\x1a",      // SUB (Substitute) - Ctrl+Z
  ESCAPE: "\x1b",      // ESC - Escape
  ENTER: "\r",         // CR - Enter/Return
  NEWLINE: "\n",       // LF - Newline
} as const;

// =============================================================================
// ANSI Codes for Feedback
// =============================================================================

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  cursorHide: "\x1b[?25l",
  cursorShow: "\x1b[?25h",
  clearLine: "\x1b[2K",
  cursorToStart: "\x1b[0G",
} as const;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a headless input controller
 *
 * @param options - Configuration options
 * @returns HeadlessInputController instance
 */
export function createHeadlessInputController(
  options: HeadlessInputOptions = {}
): HeadlessInputController {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const showFeedback = options.showFeedback ?? true;
  const handleSignals = options.handleSignals ?? true;

  const handlers = new Set<InputHandler>();
  let listening = false;
  let wasRawMode = false;
  let inputBuffer = "";

  // Signal handlers for cleanup
  const signalHandlers: Array<{ signal: NodeJS.Signals; handler: () => void }> = [];

  /**
   * Emit event to all handlers
   */
  function emit(event: InputEvent): void {
    handlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        // Ignore handler errors to prevent input loop from breaking
      }
    });
  }

  /**
   * Parse input data and emit appropriate events
   */
  function handleData(data: Buffer): void {
    const key = data.toString();
    const rawBuffer = data;

    // Handle Ctrl+C (SIGINT equivalent in raw mode)
    // CRITICAL: In raw mode, the OS does NOT send SIGINT - we MUST handle it here!
    // When stdin is in raw mode, control characters are passed as data, not interpreted.
    if (key === KEY_CODES.CTRL_C) {
      if (showFeedback) {
        write(`\n${ANSI.yellow}${ANSI.bold}[INTERRUPT]${ANSI.reset} Ctrl+C received, terminating...\n`);
      }
      emit({ type: "interrupt", key, rawBuffer });
      return;
    }

    // Handle Ctrl+D (EOF)
    if (key === KEY_CODES.CTRL_D) {
      if (inputBuffer.length === 0) {
        if (showFeedback) {
          write(`\n${ANSI.cyan}[EOF]${ANSI.reset} Ctrl+D received, exiting...\n`);
        }
        emit({ type: "eof", key, rawBuffer });
      }
      return;
    }

    // Handle Ctrl+\ (SIGQUIT equivalent in raw mode)
    // CRITICAL: Same as Ctrl+C - raw mode prevents OS from sending SIGQUIT
    if (key === KEY_CODES.CTRL_BACKSLASH) {
      if (showFeedback) {
        write(`\n${ANSI.red}${ANSI.bold}[FORCE QUIT]${ANSI.reset} Ctrl+\\ received, forcing exit...\n`);
      }
      emit({ type: "force_quit", key, rawBuffer });
      return;
    }

    // Handle Escape (abort current operation)
    if (key === KEY_CODES.ESCAPE) {
      inputBuffer = "";
      return;
    }

    // Handle Enter (process command buffer)
    if (key === KEY_CODES.ENTER || key === KEY_CODES.NEWLINE) {
      const command = inputBuffer.trim().toLowerCase();
      inputBuffer = "";

      if (command === "/exit" || command === "/quit" || command === "exit" || command === "quit") {
        if (showFeedback) {
          write(`\n${ANSI.cyan}[EXIT]${ANSI.reset} Exit command received, shutting down...\n`);
        }
        emit({ type: "exit", command, key, rawBuffer });
        return;
      }

      if (command.length > 0) {
        emit({ type: "command", command, key, rawBuffer });
      }
      return;
    }

    // Handle single-character shortcuts
    if (key.length === 1) {
      const char = key.toLowerCase();

      // Quick exit with 'q' (only if buffer is empty - not mid-command)
      if (char === "q" && inputBuffer.length === 0) {
        if (showFeedback) {
          write(`\n${ANSI.cyan}[EXIT]${ANSI.reset} Quick exit (q), shutting down...\n`);
        }
        emit({ type: "exit", key, rawBuffer });
        return;
      }

      // Pause with 'p'
      if (char === "p" && inputBuffer.length === 0) {
        emit({ type: "pause", key, rawBuffer });
        return;
      }

      // Resume with 'r'
      if (char === "r" && inputBuffer.length === 0) {
        emit({ type: "resume", key, rawBuffer });
        return;
      }

      // Terminal launch with 't'
      if (char === "t" && inputBuffer.length === 0) {
        emit({ type: "terminal", key, rawBuffer });
        return;
      }

      // Build command buffer for /exit, /quit commands
      if (char === "/" || inputBuffer.startsWith("/")) {
        inputBuffer += key;
      }

      // Emit generic key event
      emit({ type: "key", key, rawBuffer });
    }
  }

  /**
   * Set up signal handlers
   */
  function setupSignals(): void {
    if (!handleSignals) return;

    const caps = getCapabilities();

    // SIGINT is universal
    const sigintHandler = () => {
      if (showFeedback) {
        write(`\n${ANSI.yellow}${ANSI.bold}[SIGINT]${ANSI.reset} Interrupt signal received...\n`);
      }
      emit({ type: "interrupt" });
    };
    process.on("SIGINT", sigintHandler);
    signalHandlers.push({ signal: "SIGINT", handler: sigintHandler });

    // SIGTERM is universal
    const sigtermHandler = () => {
      if (showFeedback) {
        write(`\n${ANSI.yellow}${ANSI.bold}[SIGTERM]${ANSI.reset} Termination signal received...\n`);
      }
      emit({ type: "exit" });
    };
    process.on("SIGTERM", sigtermHandler);
    signalHandlers.push({ signal: "SIGTERM", handler: sigtermHandler });

    // SIGQUIT and SIGHUP are Unix-only
    if (!caps.isWindows) {
      const sigquitHandler = () => {
        if (showFeedback) {
          write(`\n${ANSI.red}${ANSI.bold}[SIGQUIT]${ANSI.reset} Quit signal received...\n`);
        }
        emit({ type: "force_quit" });
      };
      process.on("SIGQUIT", sigquitHandler);
      signalHandlers.push({ signal: "SIGQUIT", handler: sigquitHandler });

      const sighupHandler = () => {
        if (showFeedback) {
          write(`\n${ANSI.yellow}[SIGHUP]${ANSI.reset} Hangup signal received...\n`);
        }
        emit({ type: "exit" });
      };
      process.on("SIGHUP", sighupHandler);
      signalHandlers.push({ signal: "SIGHUP", handler: sighupHandler });
    }
  }

  /**
   * Clean up signal handlers
   */
  function cleanupSignals(): void {
    for (const { signal, handler } of signalHandlers) {
      process.off(signal, handler);
    }
    signalHandlers.length = 0;
  }

  /**
   * Start raw input handling
   */
  function startRawInput(): void {
    if (!process.stdin.isTTY) {
      return;
    }

    try {
      wasRawMode = process.stdin.isRaw ?? false;
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", handleData);
    } catch (error) {
      // Ignore errors - might not be a TTY
    }
  }

  /**
   * Stop raw input handling
   */
  function stopRawInput(): void {
    if (!process.stdin.isTTY) {
      return;
    }

    try {
      process.stdin.off("data", handleData);
      process.stdin.pause();
      process.stdin.setRawMode(wasRawMode);
    } catch (error) {
      // Ignore errors
    }
  }

  return {
    start(): void {
      if (listening) return;
      listening = true;
      setupSignals();
      startRawInput();
    },

    stop(): void {
      if (!listening) return;
      listening = false;
      cleanupSignals();
      stopRawInput();
    },

    onInput(handler: InputHandler): void {
      handlers.add(handler);
    },

    offInput(handler: InputHandler): void {
      handlers.delete(handler);
    },

    isListening(): boolean {
      return listening;
    },

    showTerminationFeedback(message?: string): void {
      const msg = message ?? "Goodbye!";
      const caps = getCapabilities();

      if (caps.supportsColor) {
        write(`\n${ANSI.cyan}${ANSI.bold}▶${ANSI.reset} ${msg}\n`);
      } else {
        write(`\n> ${msg}\n`);
      }
    },
  };
}

/**
 * Default input controller instance
 */
let defaultController: HeadlessInputController | null = null;

/**
 * Get the default headless input controller (lazily created)
 */
export function getHeadlessInputController(): HeadlessInputController {
  if (!defaultController) {
    defaultController = createHeadlessInputController();
  }
  return defaultController;
}

/**
 * Reset the default headless input controller (useful for testing)
 */
export function resetHeadlessInputController(): void {
  if (defaultController) {
    defaultController.stop();
    defaultController = null;
  }
}
