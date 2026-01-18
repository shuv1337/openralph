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
  isWindowsLegacy: boolean;  // Windows CMD without ANSI support
  terminalName?: string;
  colorLimit?: number;
}

/**
 * Detect terminal capabilities.
 */
export function detectCapabilities(): TerminalCapabilities {
  // Check for Windows legacy console
  // Modern Windows Terminal and newer CMD support ANSI
  const isWindows = process.platform === 'win32';
  const isWindowsTerminal = !!process.env.WT_SESSION;
  const isVscodeTerminal = process.env.TERM_PROGRAM === 'vscode';
  const isLegacyWindows = isWindows && !isWindowsTerminal && !isVscodeTerminal && !process.env.ANSICON && !process.env.ConEmuANSI;

  // Check for ANSI support
  const supportsColors = process.env.TERM !== 'dumb' && !isLegacyWindows;

  // Check for Unicode
  // Most modern terminals support Unicode. On Windows, it depends on the code page,
  // but usually Windows Terminal handles it fine.
  const supportsUnicode = !isLegacyWindows || !!process.env.LANG?.includes('UTF-8');

  // Check for True Color (24-bit)
  const supportsTrueColor = supportsColors && (
    process.env.COLORTERM === 'truecolor' ||
    process.env.COLORTERM === '24bit' ||
    isWindowsTerminal ||
    isVscodeTerminal
  );

  // Detect color support level
  let level: CapabilityLevel = 'basic';
  if (supportsTrueColor) {
    level = 'truecolor';
  } else if (supportsColors) {
    // Check for 256 color support
    const term = process.env.TERM || '';
    if (term.includes('256') || term.includes('xterm')) {
      level = '256';
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
    isWindowsLegacy: isLegacyWindows,
    terminalName: process.env.TERM || process.env.TERM_PROGRAM,
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
