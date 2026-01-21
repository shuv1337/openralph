/**
 * Terminal capability levels for fallback decisions.
 */
export type CapabilityLevel = 
  | 'basic'      // Plain text, no colors
  | 'colors'     // 8-16 colors
  | '256'        // 256 colors (ANSI)
  | 'truecolor'; // 24-bit true color

/**
 * Detected terminal capabilities.
 */
export interface TerminalCapabilities {
  level: CapabilityLevel;
  supportsUnicode: boolean;
  supportsAnimation: boolean;
  supportsTrueColor: boolean;
  supportsKeyboardEnhancement: boolean;  // Kitty keyboard protocol support
  isWindowsLegacy: boolean;  // Windows CMD without ANSI support
  // Platform detection
  isMacOS: boolean;
  isWindows: boolean;
  isLinux: boolean;
  // macOS terminal detection
  isTerminalApp: boolean;    // Apple Terminal.app (limited capabilities)
  isITerm2: boolean;         // iTerm2 (full capabilities)
  isAlacritty: boolean;
  isWezTerm: boolean;
  isGhostty: boolean;
  // Windows terminal detection
  isWindowsTerminal: boolean;
  isVscodeTerminal: boolean;
  terminalName?: string;
  colorLimit?: number;
}

/**
 * Detect terminal capabilities.
 */
export function detectCapabilities(): TerminalCapabilities {
  // Platform detection
  const isWindows = process.platform === 'win32';
  const isMacOS = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  // Terminal program detection
  const termProgram = process.env.TERM_PROGRAM || '';

  // Windows terminal detection
  const isWindowsTerminal = !!process.env.WT_SESSION;
  const isVscodeTerminal = termProgram === 'vscode';
  const isLegacyWindows = isWindows && !isWindowsTerminal && !isVscodeTerminal && !process.env.ANSICON && !process.env.ConEmuANSI;

  // macOS terminal detection
  const isTerminalApp = termProgram === 'Apple_Terminal';
  const isITerm2 = termProgram === 'iTerm.app';
  const isAlacritty = termProgram === 'Alacritty';
  const isWezTerm = termProgram === 'WezTerm';
  const isGhostty = termProgram === 'ghostty' || process.env.GHOSTTY_RESOURCES_DIR !== undefined;

  // Check for ANSI support
  const supportsColors = process.env.TERM !== 'dumb' && !isLegacyWindows;

  // Check for Unicode
  // Most modern terminals support Unicode. On Windows, it depends on the code page,
  // but usually Windows Terminal handles it fine.
  const supportsUnicode = !isLegacyWindows || !!process.env.LANG?.includes('UTF-8');

  // Check for True Color (24-bit)
  // Terminal.app supports 256 colors but not always true color reliably
  const supportsTrueColor = supportsColors && !isTerminalApp && (
    process.env.COLORTERM === 'truecolor' ||
    process.env.COLORTERM === '24bit' ||
    isWindowsTerminal ||
    isVscodeTerminal ||
    isITerm2 ||
    isAlacritty ||
    isWezTerm ||
    isGhostty
  );

  // Check for Kitty keyboard protocol support
  // Terminal.app does NOT support Kitty protocol
  const supportsKeyboardEnhancement = !isTerminalApp && !isLegacyWindows && (
    isITerm2 ||
    isAlacritty ||
    isWezTerm ||
    isGhostty ||
    isWindowsTerminal ||
    isVscodeTerminal ||
    // Fallback: assume modern terminals support it if not explicitly known
    (supportsColors && !!process.env.TERM?.includes('xterm'))
  );

  // Detect color support level
  let level: CapabilityLevel = 'basic';
  if (supportsTrueColor) {
    level = 'truecolor';
  } else if (supportsColors) {
    // Check for 256 color support
    const term = process.env.TERM || '';
    if (term.includes('256') || term.includes('xterm') || isTerminalApp) {
      level = '256';  // Terminal.app supports 256 colors
    } else {
      level = 'colors';
    }
  }

  // Check for animation support
  // Modern terminals support animations (frequent redraws)
  const supportsAnimation = supportsColors && 
    !isLegacyWindows && 
    process.env.TERM !== 'dumb';

  return {
    level,
    supportsUnicode,
    supportsAnimation,
    supportsTrueColor,
    supportsKeyboardEnhancement,
    isWindowsLegacy: isLegacyWindows,
    // Platform flags
    isMacOS,
    isWindows,
    isLinux,
    // macOS terminal flags
    isTerminalApp,
    isITerm2,
    isAlacritty,
    isWezTerm,
    isGhostty,
    // Windows terminal flags
    isWindowsTerminal,
    isVscodeTerminal,
    terminalName: process.env.TERM || termProgram,
  };
}

/**
 * Get the current terminal capabilities (cached).
 */
let cachedCapabilities: TerminalCapabilities | null = null;

export function getCapabilities(): TerminalCapabilities {
  if (!cachedCapabilities) {
    cachedCapabilities = detectCapabilities();
  }
  return cachedCapabilities;
}

/**
 * Reset the capabilities cache (for testing only).
 */
export function _resetCapabilitiesCache(): void {
  cachedCapabilities = null;
}
