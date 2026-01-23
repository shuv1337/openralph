/**
 * Terminal capabilities detection module.
 * 
 * Provides comprehensive cross-platform terminal capability detection
 * for adaptive rendering decisions (colors, Unicode, animations, etc.)
 * 
 * Features:
 * - Respects NO_COLOR (RFC 3972) and FORCE_COLOR environment variables
 * - Detects CI environments (GitHub Actions, GitLab CI, etc.)
 * - Distinguishes Windows cmd.exe vs Windows Terminal
 * - Identifies macOS terminals (Terminal.app, iTerm2, Ghostty)
 * - TTL-based memoization (supports runtime environment changes)
 */

/**
 * Terminal capability levels for color support decisions.
 */
export type CapabilityLevel = 
  | 'basic'      // Plain text, no colors
  | 'colors'     // 8-16 colors
  | '256'        // 256 colors (ANSI)
  | 'truecolor'; // 24-bit true color

/**
 * Terminal tier enumeration for banner rendering and fallback decisions.
 * Based on ASCII Banner Spec - Section 3.1.
 */
export type TerminalTier = 
  | 'legacy_windows'  // cmd.exe without ANSI support
  | 'basic_ansi'      // 8-16 colors, no Unicode
  | 'ansi_256'        // 256 colors, Unicode support
  | 'truecolor'       // 24-bit color, block characters
  | 'full_feature';   // All features including animation

/**
 * Detected terminal capabilities.
 */
export interface TerminalCapabilities {
  /** Color capability level */
  level: CapabilityLevel;
  /** Terminal tier for rendering decisions */
  tier: TerminalTier;
  /** Whether terminal supports color output */
  supportsColor: boolean;
  /** Whether Unicode characters are supported */
  supportsUnicode: boolean;
  /** Whether animations (frequent redraws) are supported */
  supportsAnimation: boolean;
  /** Whether 24-bit true color is supported */
  supportsTrueColor: boolean;
  /** Whether Kitty keyboard protocol is supported */
  supportsKeyboardEnhancement: boolean;
  /** Whether block characters (█▓▒░) are supported */
  supportsBlockCharacters: boolean;
  /** Whether output is to an interactive terminal */
  isInteractive: boolean;
  /** Windows CMD without ANSI support */
  isWindowsLegacy: boolean;
  /** Color level as numeric value (0-3) */
  colorLevel: number;
  
  // Platform detection
  isMacOS: boolean;
  isWindows: boolean;
  isLinux: boolean;
  
  // CI/CD environment detection
  isCI: boolean;
  ciPlatform?: string;
  
  // macOS terminal detection
  isTerminalApp: boolean;    // Apple Terminal.app (limited capabilities)
  isITerm2: boolean;         // iTerm2 (full capabilities)
  isAlacritty: boolean;
  isWezTerm: boolean;
  isGhostty: boolean;
  
  // Windows terminal detection
  isWindowsTerminal: boolean;
  isVscodeTerminal: boolean;
  isConEmu: boolean;
  
  /** Terminal program name */
  terminalName?: string;
  /** Specific color limit if known */
  colorLimit?: number;
}

/**
 * CI platform detection result.
 */
interface CIDetectionResult {
  isCI: boolean;
  platform?: string;
}

/**
 * Detect if running in a CI/CD environment.
 * 
 * Checks common CI environment variables.
 */
function detectCIEnvironment(): CIDetectionResult {
  const env = process.env;
  
  // GitHub Actions
  if (env.GITHUB_ACTIONS === 'true') {
    return { isCI: true, platform: 'github_actions' };
  }
  
  // GitLab CI
  if (env.GITLAB_CI === 'true') {
    return { isCI: true, platform: 'gitlab_ci' };
  }
  
  // CircleCI
  if (env.CIRCLECI === 'true') {
    return { isCI: true, platform: 'circleci' };
  }
  
  // Travis CI
  if (env.TRAVIS === 'true') {
    return { isCI: true, platform: 'travis' };
  }
  
  // Jenkins
  if (env.JENKINS_URL !== undefined) {
    return { isCI: true, platform: 'jenkins' };
  }
  
  // Azure Pipelines
  if (env.TF_BUILD === 'True') {
    return { isCI: true, platform: 'azure_pipelines' };
  }
  
  // Bitbucket Pipelines
  if (env.BITBUCKET_BUILD_NUMBER !== undefined) {
    return { isCI: true, platform: 'bitbucket' };
  }
  
  // AWS CodeBuild
  if (env.CODEBUILD_BUILD_ID !== undefined) {
    return { isCI: true, platform: 'codebuild' };
  }
  
  // Buildkite
  if (env.BUILDKITE === 'true') {
    return { isCI: true, platform: 'buildkite' };
  }
  
  // Drone CI
  if (env.DRONE === 'true') {
    return { isCI: true, platform: 'drone' };
  }
  
  // Generic CI check
  if (env.CI === 'true' || env.CI === '1' || env.CONTINUOUS_INTEGRATION === 'true') {
    return { isCI: true, platform: 'unknown' };
  }
  
  return { isCI: false };
}

/**
 * Parse FORCE_COLOR environment variable.
 * 
 * @returns Color level (0-3) or null if not set/invalid
 */
function parseForceColor(): number | null {
  const forceColor = process.env.FORCE_COLOR;
  
  if (forceColor === undefined || forceColor === '') {
    return null;
  }
  
  // FORCE_COLOR without value means force colors on (level 1)
  if (forceColor === '') {
    return 1;
  }
  
  const level = parseInt(forceColor, 10);
  
  // Validate: 0 = disabled, 1 = basic, 2 = 256, 3 = truecolor
  if (!isNaN(level) && level >= 0 && level <= 3) {
    return level;
  }
  
  // Any truthy non-numeric value means level 1
  if (forceColor.toLowerCase() === 'true' || forceColor === '1') {
    return 1;
  }
  
  return null;
}

/**
 * Check if NO_COLOR environment variable is set.
 * 
 * Per RFC 3972 (https://no-color.org/), the presence of NO_COLOR
 * (regardless of value) should disable color output.
 */
function isNoColorSet(): boolean {
  return process.env.NO_COLOR !== undefined;
}

/**
 * Map CapabilityLevel to numeric color level.
 */
function levelToColorLevel(level: CapabilityLevel): number {
  switch (level) {
    case 'basic': return 0;
    case 'colors': return 1;
    case '256': return 2;
    case 'truecolor': return 3;
  }
}

/**
 * Map numeric color level to CapabilityLevel.
 */
function colorLevelToCapabilityLevel(level: number): CapabilityLevel {
  switch (level) {
    case 0: return 'basic';
    case 1: return 'colors';
    case 2: return '256';
    case 3: return 'truecolor';
    default: return level < 0 ? 'basic' : 'truecolor';
  }
}

/**
 * Determine terminal tier based on capabilities.
 */
function determineTerminalTier(
  level: CapabilityLevel,
  supportsUnicode: boolean,
  supportsAnimation: boolean,
  isWindowsLegacy: boolean
): TerminalTier {
  if (isWindowsLegacy) {
    return 'legacy_windows';
  }
  
  if (level === 'basic' || !supportsUnicode) {
    return 'basic_ansi';
  }
  
  if (level === 'colors') {
    return 'basic_ansi';
  }
  
  if (level === '256') {
    return 'ansi_256';
  }
  
  // Truecolor with animation = full feature
  if (level === 'truecolor' && supportsAnimation) {
    return 'full_feature';
  }
  
  return 'truecolor';
}

/**
 * Detect terminal capabilities.
 * 
 * This function performs fresh detection without caching.
 * Use `getCapabilities()` for cached access.
 */
export function detectCapabilities(): TerminalCapabilities {
  const env = process.env;
  
  // Platform detection
  const isWindows = process.platform === 'win32';
  const isMacOS = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  // Terminal program detection
  const termProgram = env.TERM_PROGRAM || '';
  const term = env.TERM || '';

  // Windows terminal detection
  const isWindowsTerminal = !!env.WT_SESSION;
  const isVscodeTerminal = termProgram === 'vscode';
  const isConEmu = !!env.ConEmuANSI || !!env.ConEmuBuild;
  const hasAnsicon = !!env.ANSICON;
  
  // MSYS2/Git Bash detection (runs on Windows but provides Unix-like environment)
  // MSYSTEM is set to MINGW64, MINGW32, UCRT64, CLANG64, MSYS, etc.
  const isMsys2 = !!env.MSYSTEM;
  
  // Windows 10 1809+ and Windows 11 support VT sequences natively in cmd.exe
  // Even without WT_SESSION, modern Windows consoles support ANSI colors.
  // We detect this by checking if stdout is a TTY or if we're on Windows 10+.
  // Note: In compiled binaries, isTTY might be undefined but colors still work.
  const isModernWindowsVersion = isWindows && (() => {
    // Allow mocking for tests
    if (env.RALPH_MOCK_WINDOWS_VERSION === 'legacy') return false;
    if (env.RALPH_MOCK_WINDOWS_VERSION === 'modern') return true;
    
    // Check for Windows 10+ via OS release (build 10240+)
    // os.release() returns something like "10.0.22631" for Windows 11
    try {
      const release = require('os').release();
      const [major] = release.split('.').map(Number);
      return major >= 10;
    } catch {
      return false;
    }
  })();
  
  // Git Bash/MSYS2 with xterm-compatible TERM is NOT legacy Windows
  // It supports ANSI colors and Unicode
  const isModernTermOnWindows = isWindows && (
    isWindowsTerminal || 
    isVscodeTerminal || 
    hasAnsicon || 
    isConEmu ||
    // MSYS2/Git Bash with xterm-compatible terminal
    (isMsys2 && (term.includes('xterm') || term.includes('256color'))) ||
    // Windows 10+ with native VT support (fallback for compiled binaries)
    isModernWindowsVersion
  );
  
  const isLegacyWindows = isWindows && (!isModernTermOnWindows || env.TERM === 'dumb');

  // macOS terminal detection
  const isTerminalApp = termProgram === 'Apple_Terminal';
  const isITerm2 = termProgram === 'iTerm.app';
  const isAlacritty = termProgram === 'Alacritty';
  const isWezTerm = termProgram === 'WezTerm';
  const isGhostty = termProgram === 'ghostty' || env.GHOSTTY_RESOURCES_DIR !== undefined;

  // Linux terminal detection
  const isKitty = termProgram === 'kitty' || env.KITTY_WINDOW_ID !== undefined;
  
  // CI detection
  const ciResult = detectCIEnvironment();
  
  // Interactive terminal check
  // Windows Terminal and MSYS2/Git Bash are considered interactive even if isTTY is undefined/false
  const isInteractive = (process.stdout.isTTY === true || isWindowsTerminal || isMsys2) && !ciResult.isCI;
  
  // Check NO_COLOR first (RFC 3972 compliance)
  if (isNoColorSet()) {
    return {
      level: 'basic',
      tier: isLegacyWindows ? 'legacy_windows' : 'basic_ansi',
      supportsColor: false,
      supportsUnicode: !isLegacyWindows,
      supportsAnimation: false,
      supportsTrueColor: false,
      supportsKeyboardEnhancement: false,
      supportsBlockCharacters: false,
      isInteractive,
      isWindowsLegacy: isLegacyWindows,
      colorLevel: 0,
      isMacOS,
      isWindows,
      isLinux,
      isCI: ciResult.isCI,
      ciPlatform: ciResult.platform,
      isTerminalApp,
      isITerm2,
      isAlacritty,
      isWezTerm,
      isGhostty,
      isWindowsTerminal,
      isVscodeTerminal,
      isConEmu,
      terminalName: term || termProgram || undefined,
    };
  }
  
  // Check FORCE_COLOR override
  const forcedColorLevel = parseForceColor();
  
  // Determine base color support
  const isDumb = term === 'dumb';
  let supportsColors = !isDumb && !isLegacyWindows;
  let level: CapabilityLevel = 'basic';
  
  if (forcedColorLevel !== null) {
    // FORCE_COLOR overrides detection
    supportsColors = forcedColorLevel >= 1;
    level = colorLevelToCapabilityLevel(forcedColorLevel);
  } else if (supportsColors) {
    // Natural detection
    // Check for True Color (24-bit)
    // Terminal.app supports 256 colors but not always true color reliably
    const hasTrueColor = !isTerminalApp && (
      env.COLORTERM === 'truecolor' ||
      env.COLORTERM === '24bit' ||
      isWindowsTerminal ||
      isVscodeTerminal ||
      isITerm2 ||
      isAlacritty ||
      isWezTerm ||
      isGhostty ||
      isKitty
    );
    
    if (hasTrueColor) {
      level = 'truecolor';
    } else if (term.includes('256') || term.includes('xterm') || isTerminalApp || isModernWindowsVersion) {
      // Windows 10+ supports 256 colors natively in cmd.exe
      // Terminal.app also supports 256 colors
      level = '256';
    } else {
      level = 'colors';
    }
  }
  
  const supportsTrueColor = level === 'truecolor';
  const colorLevel = levelToColorLevel(level);
  
  // Check for Unicode support
  // Most modern terminals support Unicode. On Windows, it depends on the terminal.
  const supportsUnicode = !isLegacyWindows || !!env.LANG?.includes('UTF-8');
  
  // Block characters require Unicode + decent color support
  const supportsBlockCharacters = supportsUnicode && colorLevel >= 2;
  
  // Check for Kitty keyboard protocol support
  // Terminal.app does NOT support Kitty protocol
  const supportsKeyboardEnhancement = !isTerminalApp && !isLegacyWindows && !isDumb && (
    isITerm2 ||
    isAlacritty ||
    isWezTerm ||
    isGhostty ||
    isKitty ||
    isWindowsTerminal ||
    isVscodeTerminal ||
    // Fallback: assume modern terminals support it if xterm-compatible
    term.includes('xterm')
  );

  // Check for animation support
  // Windows Terminal supports animation even if isTTY might be undefined
  const supportsAnimation = supportsColors && 
    !isLegacyWindows && 
    !isDumb &&
    (isInteractive || isWindowsTerminal);

  // Determine terminal tier
  const tier = determineTerminalTier(level, supportsUnicode, supportsAnimation, isLegacyWindows);

  return {
    level,
    tier,
    supportsColor: supportsColors,
    supportsUnicode,
    supportsAnimation,
    supportsTrueColor,
    supportsKeyboardEnhancement,
    supportsBlockCharacters,
    isInteractive,
    isWindowsLegacy: isLegacyWindows,
    colorLevel,
    // Platform flags
    isMacOS,
    isWindows,
    isLinux,
    // CI detection
    isCI: ciResult.isCI,
    ciPlatform: ciResult.platform,
    // macOS terminal flags
    isTerminalApp,
    isITerm2,
    isAlacritty,
    isWezTerm,
    isGhostty,
    // Windows terminal flags
    isWindowsTerminal,
    isVscodeTerminal,
    isConEmu,
    terminalName: term || termProgram || undefined,
  };
}

/**
 * Detect terminal capabilities - alias for spec compliance.
 * 
 * This function is the primary export as specified in the architecture docs.
 */
export const detectTerminalCapabilities = detectCapabilities;

// Memoization with TTL support
let cachedCapabilities: TerminalCapabilities | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes - allows runtime changes

/**
 * Get the current terminal capabilities (memoized with TTL).
 * 
 * Uses a 5-minute TTL cache to balance performance with
 * the ability to detect runtime environment changes.
 */
export function getCapabilities(): TerminalCapabilities {
  const now = Date.now();
  
  if (!cachedCapabilities || (now - cacheTimestamp) > CACHE_TTL_MS) {
    cachedCapabilities = detectCapabilities();
    cacheTimestamp = now;
  }
  
  return cachedCapabilities;
}

/**
 * Reset the capabilities cache.
 * 
 * Use this after environment changes or for testing.
 */
export function resetCapabilitiesCache(): void {
  cachedCapabilities = null;
  cacheTimestamp = 0;
}

/**
 * @deprecated Use resetCapabilitiesCache() instead
 */
export function _resetCapabilitiesCache(): void {
  resetCapabilitiesCache();
}

/**
 * Check if terminal supports a specific color level.
 * 
 * @param requiredLevel - Minimum required color level
 * @returns True if terminal meets or exceeds the required level
 */
export function hasColorSupport(requiredLevel: CapabilityLevel = 'colors'): boolean {
  const caps = getCapabilities();
  const currentLevel = levelToColorLevel(caps.level);
  const requiredNumericLevel = levelToColorLevel(requiredLevel);
  
  return currentLevel >= requiredNumericLevel;
}

/**
 * Get a descriptive string of the terminal environment.
 * 
 * Useful for debugging and logging.
 */
export function getTerminalDescription(): string {
  const caps = getCapabilities();
  const parts: string[] = [];
  
  // Platform
  if (caps.isWindows) {
    parts.push('Windows');
    if (caps.isWindowsTerminal) parts.push('(Windows Terminal)');
    else if (caps.isWindowsLegacy) parts.push('(Legacy Console)');
    else if (caps.isConEmu) parts.push('(ConEmu)');
  } else if (caps.isMacOS) {
    parts.push('macOS');
    if (caps.isITerm2) parts.push('(iTerm2)');
    else if (caps.isTerminalApp) parts.push('(Terminal.app)');
    else if (caps.isAlacritty) parts.push('(Alacritty)');
    else if (caps.isWezTerm) parts.push('(WezTerm)');
    else if (caps.isGhostty) parts.push('(Ghostty)');
  } else if (caps.isLinux) {
    parts.push('Linux');
    if (caps.terminalName) parts.push(`(${caps.terminalName})`);
  }
  
  // Capabilities
  parts.push(`[tier=${caps.tier}`);
  parts.push(`color=${caps.level}`);
  if (caps.supportsUnicode) parts.push('unicode');
  if (caps.supportsTrueColor) parts.push('truecolor');
  if (caps.supportsAnimation) parts.push('animation');
  parts.push(']');
  
  // CI
  if (caps.isCI) {
    parts.push(`CI:${caps.ciPlatform || 'unknown'}`);
  }
  
  return parts.join(' ');
}
