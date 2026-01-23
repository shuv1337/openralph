/**
 * Interactive Interrupt Menu Module
 *
 * Displays an interactive text-based menu when the user interrupts
 * the headless process (Ctrl+C, SIGINT). Provides options for
 * force quit, pause, or resume.
 *
 * Features:
 * - Cross-platform support (Windows, macOS, Linux)
 * - Single-key input handling (q/Q, p/P, r/R)
 * - ANSI escape codes for clearing and positioning
 * - Colored output with terminal capability detection
 * - Promise-based API returning user choice
 */

import { getCapabilities } from "./terminal-capabilities";
import { colorize, ANSI_COLORS } from "./text-renderer";
import { getSymbol, STATUS_SYMBOLS } from "./cli-symbols";

// =============================================================================
// Types
// =============================================================================

/**
 * Available menu choices when interrupt is received.
 */
export enum InterruptMenuChoice {
  /** Exit immediately without cleanup */
  FORCE_QUIT = "FORCE_QUIT",
  /** Pause the current session */
  PAUSE = "PAUSE",
  /** Continue execution */
  RESUME = "RESUME",
}

/**
 * Configuration options for the interrupt menu.
 */
export interface InterruptMenuOptions {
  /** Custom write function for output (defaults to process.stdout.write) */
  write?: (text: string) => void;
  /** Whether to use colors (auto-detected if not specified) */
  colors?: boolean;
  /** Timeout in milliseconds before auto-resuming (0 = no timeout) */
  timeout?: number;
  /** Custom prompt message */
  promptMessage?: string;
}

/**
 * Controller interface for the interrupt menu.
 */
export interface InterruptMenuController {
  /**
   * Show the interrupt menu and wait for user choice.
   * Returns a Promise that resolves to the user's selection.
   */
  show(): Promise<InterruptMenuChoice>;

  /**
   * Programmatically dismiss the menu with a specific choice.
   * Useful for external timeout or signal handling.
   */
  dismiss(choice: InterruptMenuChoice): void;

  /**
   * Check if the menu is currently displayed.
   */
  isVisible(): boolean;

  /**
   * Clean up any resources (stdin handlers, etc.)
   */
  destroy(): void;
}

// =============================================================================
// ANSI Escape Codes
// =============================================================================

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  // Colors
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  white: "\x1b[37m",
  // Cursor control
  cursorHide: "\x1b[?25l",
  cursorShow: "\x1b[?25h",
  // Line control
  clearLine: "\x1b[2K",
  cursorToStart: "\x1b[0G",
  cursorUp: "\x1b[1A",
  saveCursor: "\x1b7",
  restoreCursor: "\x1b8",
} as const;

// =============================================================================
// Key Codes
// =============================================================================

const KEY_CODES = {
  CTRL_C: "\x03",
  ESCAPE: "\x1b",
  Q_LOWER: "q",
  Q_UPPER: "Q",
  P_LOWER: "p",
  P_UPPER: "P",
  R_LOWER: "r",
  R_UPPER: "R",
} as const;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create an interrupt menu controller.
 *
 * @param options - Configuration options
 * @returns InterruptMenuController instance
 */
export function createInterruptMenu(
  options: InterruptMenuOptions = {}
): InterruptMenuController {
  const caps = getCapabilities();
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const useColors = options.colors ?? caps.supportsColor;
  const timeout = options.timeout ?? 0;
  const promptMessage = options.promptMessage ?? "Interrupt received. Choose an action:";

  let visible = false;
  let resolvePromise: ((choice: InterruptMenuChoice) => void) | null = null;
  let wasRawMode = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let dataHandler: ((data: Buffer) => void) | null = null;

  /**
   * Apply color if colors are enabled
   */
  function applyColor(text: string, colorCode: string): string {
    if (!useColors) return text;
    return `${colorCode}${text}${ANSI.reset}`;
  }

  /**
   * Get the warning symbol based on terminal capabilities
   */
  function getWarningSymbol(): string {
    return getSymbol(STATUS_SYMBOLS.warning);
  }

  /**
   * Build the menu display string
   */
  function buildMenuDisplay(): string {
    const lines: string[] = [];
    
    // Clear line and show prompt
    const warningSymbol = getWarningSymbol();
    const prompt = applyColor(
      `[${warningSymbol}]`,
      ANSI.yellow + ANSI.bold
    );
    
    lines.push(`${ANSI.cursorToStart}${ANSI.clearLine}`);
    lines.push(`${prompt} ${promptMessage}`);
    lines.push("");
    
    // Menu options
    const quitLabel = applyColor("[Q]", ANSI.red + ANSI.bold);
    const quitDesc = applyColor("Force Quit", ANSI.red);
    lines.push(`    ${quitLabel} ${quitDesc} - Exit immediately`);
    
    const pauseLabel = applyColor("[P]", ANSI.yellow + ANSI.bold);
    const pauseDesc = applyColor("Pause", ANSI.yellow);
    lines.push(`    ${pauseLabel} ${pauseDesc} - Pause the session`);
    
    const resumeLabel = applyColor("[R]", ANSI.green + ANSI.bold);
    const resumeDesc = applyColor("Resume", ANSI.green);
    lines.push(`    ${resumeLabel} ${resumeDesc} - Continue execution`);
    
    lines.push("");
    
    return lines.join("\n");
  }

  /**
   * Clear the menu from display
   */
  function clearMenuDisplay(): void {
    if (!caps.supportsAnimation) return;
    
    // Move cursor up and clear each line (menu is 6 lines)
    const menuLines = 6;
    for (let i = 0; i < menuLines; i++) {
      write(`${ANSI.cursorUp}${ANSI.clearLine}`);
    }
    write(ANSI.cursorToStart);
  }

  /**
   * Handle keyboard input
   */
  function handleKeyPress(data: Buffer): void {
    if (!visible || !resolvePromise) return;

    const key = data.toString();

    // Handle quit (Q/q)
    if (key === KEY_CODES.Q_LOWER || key === KEY_CODES.Q_UPPER) {
      finishWithChoice(InterruptMenuChoice.FORCE_QUIT);
      return;
    }

    // Handle pause (P/p)
    if (key === KEY_CODES.P_LOWER || key === KEY_CODES.P_UPPER) {
      finishWithChoice(InterruptMenuChoice.PAUSE);
      return;
    }

    // Handle resume (R/r)
    if (key === KEY_CODES.R_LOWER || key === KEY_CODES.R_UPPER) {
      finishWithChoice(InterruptMenuChoice.RESUME);
      return;
    }

    // Handle Escape as resume
    if (key === KEY_CODES.ESCAPE) {
      finishWithChoice(InterruptMenuChoice.RESUME);
      return;
    }

    // Handle Ctrl+C as force quit when menu is visible
    if (key === KEY_CODES.CTRL_C) {
      finishWithChoice(InterruptMenuChoice.FORCE_QUIT);
      return;
    }
  }

  /**
   * Finish the menu interaction with a choice
   */
  function finishWithChoice(choice: InterruptMenuChoice): void {
    if (!resolvePromise) return;

    // Clean up timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    // Clear menu display
    clearMenuDisplay();

    // Restore terminal state
    cleanup();

    // Resolve the promise
    const resolve = resolvePromise;
    resolvePromise = null;
    visible = false;
    resolve(choice);
  }

  /**
   * Set up raw mode input handling
   */
  function setupRawInput(): void {
    if (!process.stdin.isTTY) {
      return;
    }

    try {
      wasRawMode = process.stdin.isRaw ?? false;
      process.stdin.setRawMode(true);
      process.stdin.resume();
      
      dataHandler = handleKeyPress;
      process.stdin.on("data", dataHandler);
    } catch {
      // Ignore errors - might not be a TTY
    }
  }

  /**
   * Restore terminal state
   */
  function cleanup(): void {
    if (!process.stdin.isTTY) {
      return;
    }

    try {
      if (dataHandler) {
        process.stdin.off("data", dataHandler);
        dataHandler = null;
      }
      process.stdin.setRawMode(wasRawMode);
      
      // Only pause stdin if we changed its state
      if (!wasRawMode) {
        process.stdin.pause();
      }
      
      // Show cursor
      write(ANSI.cursorShow);
    } catch {
      // Ignore errors
    }
  }

  return {
    show(): Promise<InterruptMenuChoice> {
      return new Promise((resolve) => {
        if (visible) {
          // Already showing, resolve with resume
          resolve(InterruptMenuChoice.RESUME);
          return;
        }

        visible = true;
        resolvePromise = resolve;

        // Hide cursor during menu display
        if (caps.supportsAnimation) {
          write(ANSI.cursorHide);
        }

        // Display the menu
        write(buildMenuDisplay());

        // Set up keyboard input
        setupRawInput();

        // Set up timeout if specified
        if (timeout > 0) {
          timeoutId = setTimeout(() => {
            finishWithChoice(InterruptMenuChoice.RESUME);
          }, timeout);
        }
      });
    },

    dismiss(choice: InterruptMenuChoice): void {
      if (visible && resolvePromise) {
        finishWithChoice(choice);
      }
    },

    isVisible(): boolean {
      return visible;
    },

    destroy(): void {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      cleanup();
      visible = false;
      resolvePromise = null;
    },
  };
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Show an interrupt menu and wait for user choice.
 * This is a convenience function that creates a temporary menu instance.
 *
 * @param options - Configuration options
 * @returns Promise resolving to user's choice
 */
export async function showInterruptMenu(
  options?: InterruptMenuOptions
): Promise<InterruptMenuChoice> {
  const menu = createInterruptMenu(options);
  try {
    return await menu.show();
  } finally {
    menu.destroy();
  }
}

/**
 * Format the menu choice as a human-readable string.
 */
export function formatMenuChoice(choice: InterruptMenuChoice): string {
  switch (choice) {
    case InterruptMenuChoice.FORCE_QUIT:
      return "Force Quit";
    case InterruptMenuChoice.PAUSE:
      return "Pause";
    case InterruptMenuChoice.RESUME:
      return "Resume";
  }
}
