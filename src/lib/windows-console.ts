/**
 * Windows Console API utilities for proper terminal support.
 * Provides VT mode detection, color support detection, and render optimization helpers.
 */

/**
 * Check if Virtual Terminal Processing is available and working.
 * On Windows 10 1809+ and Windows Terminal, ANSI escape sequences are supported.
 * 
 * @returns Promise<boolean> - true if VT processing is available
 */
export async function ensureVirtualTerminalProcessing(): Promise<boolean> {
  if (process.platform !== "win32") {
    return true; // Non-Windows platforms handle ANSI natively
  }

  // Check if running in Windows Terminal (always has VT support)
  if (process.env.WT_SESSION) {
    return true;
  }

  // Check TERM variable (set by some terminal emulators)
  const term = process.env.TERM || "";
  if (term.includes("xterm") || term.includes("256color")) {
    return true;
  }

  // For legacy cmd.exe/PowerShell, VT processing needs to be enabled
  // This is typically handled by Node.js/Bun automatically, but we can
  // force-enable color output
  if (!process.stdout.isTTY) {
    return false;
  }

  // Node.js/Bun automatically enables VT processing when stdout is a TTY
  // on Windows 10+. This function returns true if we believe it's working.
  
  // Test by checking if we can write/read escape sequences
  // (In practice, if OpenTUI renders correctly, VT processing is working)
  return true;
}

/**
 * Check if the current terminal supports truecolor (24-bit color).
 * 
 * @returns boolean - true if truecolor is supported
 */
export function supportsTruecolor(): boolean {
  // Windows Terminal and modern terminals support truecolor
  if (process.env.WT_SESSION) return true;
  if (process.env.COLORTERM === "truecolor") return true;
  if (process.env.TERM?.includes("24bit")) return true;
  
  // Alacritty, WezTerm, Kitty all support truecolor
  const termProgram = process.env.TERM_PROGRAM || "";
  if (["Alacritty", "WezTerm", "kitty"].some(t => termProgram.includes(t))) {
    return true;
  }
  
  return false;
}

/**
 * Get recommended render FPS for the current terminal.
 * Windows console may benefit from lower FPS to reduce CPU usage.
 * 
 * @returns number - recommended target FPS
 */
export function getRecommendedFps(): number {
  if (process.platform !== "win32") {
    return 30; // Default for Unix-like systems
  }
  
  // Windows Terminal is performant enough for 30fps
  if (process.env.WT_SESSION) {
    return 30;
  }
  
  // Legacy cmd.exe/PowerShell may be slower
  return 20;
}

/**
 * Get recommended debounce time for state updates.
 * Windows may benefit from higher debounce to reduce render load.
 * 
 * @returns number - debounce time in milliseconds
 */
export function getRecommendedDebounceMs(): number {
  if (process.platform !== "win32") {
    return 50; // Default for Unix-like systems
  }
  
  // Windows benefits from slightly higher debounce
  return 100;
}

/**
 * Check if the current terminal is Windows Terminal.
 * Windows Terminal provides the best terminal experience on Windows.
 * 
 * @returns boolean - true if running in Windows Terminal
 */
export function isWindowsTerminal(): boolean {
  return !!process.env.WT_SESSION;
}

/**
 * Check if the current terminal is a legacy console (cmd.exe, old PowerShell).
 * Legacy consoles may have reduced functionality.
 * 
 * @returns boolean - true if running in legacy console
 */
export function isLegacyConsole(): boolean {
  if (process.platform !== "win32") return false;
  
  // Windows Terminal sets WT_SESSION
  if (process.env.WT_SESSION) return false;
  
  // Modern terminal emulators set TERM_PROGRAM
  if (process.env.TERM_PROGRAM) return false;
  
  // Check for modern terminal indicators
  const term = process.env.TERM || "";
  if (term.includes("xterm") || term.includes("256color")) return false;
  
  // Likely legacy console
  return true;
}

/**
 * Get Windows-specific environment variables for PTY spawning.
 * These help ensure proper terminal emulation in child processes.
 * 
 * @returns Record<string, string> - environment variables to add
 */
export function getWindowsPtyEnv(): Record<string, string> {
  if (process.platform !== "win32") {
    return {};
  }

  return {
    // Enable VT processing for the child process
    TERM: "xterm-256color",
    // Windows Terminal detection
    WT_SESSION: process.env.WT_SESSION || "",
    // Force color output
    FORCE_COLOR: "1",
  };
}

/**
 * Send a minimal activity signal to keep Windows console active.
 * Uses cursor save/restore sequence which is invisible but counts as activity.
 * 
 * This helps prevent Windows from terminating the process due to inactivity.
 */
export function sendKeepaliveSignal(): void {
  if (process.platform !== "win32") return;
  if (!process.stdout.isTTY) return;
  
  // ESC 7 (save cursor) + ESC 8 (restore cursor)
  // This is invisible but counts as activity
  process.stdout.write("\x1b7\x1b8");
}
