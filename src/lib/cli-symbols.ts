/**
 * CLI Symbols Module
 *
 * Provides proper terminal-native symbols for CLI output following best practices
 * from established developer tools (Git, npm, Jest, GitHub CLI).
 *
 * Key principles:
 * - Uses UTF-8 monospace symbols, NOT emojis
 * - Consistent character width for alignment
 * - Fallback to ASCII for legacy terminals
 * - ANSI color differentiation for visual hierarchy
 *
 * Symbol categories:
 * - Status indicators (tick, cross, warning, info)
 * - Navigation/flow (arrow, pointer, bullet)
 * - Box-drawing characters for structure
 * - Block elements for progress
 *
 * References:
 * - GitHub CLI design: ✓ success, ✗ failure, - neutral, ! alert
 * - npm/figures package: Cross-platform symbol fallbacks
 * - log-symbols: Colored status indicators
 */

import { getCapabilities } from "./terminal-capabilities";

// =============================================================================
// Types
// =============================================================================

/**
 * Symbol style based on terminal capabilities.
 */
export type SymbolStyle = "unicode" | "ascii";

/**
 * Symbol set with unicode and ASCII fallbacks.
 */
export interface SymbolSet {
  /** Unicode symbol (monospace-compatible) */
  readonly unicode: string;
  /** ASCII fallback for legacy terminals */
  readonly ascii: string;
}

// =============================================================================
// Core Symbol Definitions
// =============================================================================

/**
 * Status indicator symbols following GitHub CLI conventions.
 */
export const STATUS_SYMBOLS: Record<string, SymbolSet> = {
  // Primary status indicators
  success: { unicode: "✓", ascii: "+" },
  error: { unicode: "✗", ascii: "x" },
  warning: { unicode: "!", ascii: "!" },
  info: { unicode: "i", ascii: "i" },
  neutral: { unicode: "-", ascii: "-" },

  // State indicators
  running: { unicode: "●", ascii: "*" },
  pending: { unicode: "○", ascii: "o" },
  paused: { unicode: "◆", ascii: "#" },
  complete: { unicode: "✓", ascii: "+" },
  stopped: { unicode: "■", ascii: "#" },

  // Progress states
  active: { unicode: "▶", ascii: ">" },
  waiting: { unicode: "◌", ascii: "." },
};

/**
 * Arrow and pointer symbols for navigation/flow.
 */
export const ARROW_SYMBOLS: Record<string, SymbolSet> = {
  right: { unicode: "→", ascii: "->" },
  left: { unicode: "←", ascii: "<-" },
  up: { unicode: "↑", ascii: "^" },
  down: { unicode: "↓", ascii: "v" },
  pointer: { unicode: "❯", ascii: ">" },
  pointerSmall: { unicode: "›", ascii: ">" },
  bullet: { unicode: "•", ascii: "*" },
  dot: { unicode: "·", ascii: "." },
};

/**
 * Box-drawing characters for structure.
 */
export const BOX_SYMBOLS: Record<string, SymbolSet> = {
  horizontal: { unicode: "─", ascii: "-" },
  vertical: { unicode: "│", ascii: "|" },
  topLeft: { unicode: "┌", ascii: "+" },
  topRight: { unicode: "┐", ascii: "+" },
  bottomLeft: { unicode: "└", ascii: "+" },
  bottomRight: { unicode: "┘", ascii: "+" },
  teeRight: { unicode: "├", ascii: "+" },
  teeLeft: { unicode: "┤", ascii: "+" },
  teeDown: { unicode: "┬", ascii: "+" },
  teeUp: { unicode: "┴", ascii: "+" },
  cross: { unicode: "┼", ascii: "+" },
  // Double-line variants
  horizontalDouble: { unicode: "═", ascii: "=" },
  verticalDouble: { unicode: "║", ascii: "|" },
};

/**
 * Block elements for progress bars and visual emphasis.
 */
export const BLOCK_SYMBOLS: Record<string, SymbolSet> = {
  full: { unicode: "█", ascii: "#" },
  light: { unicode: "░", ascii: "." },
  medium: { unicode: "▒", ascii: ":" },
  dark: { unicode: "▓", ascii: "=" },
  leftHalf: { unicode: "▌", ascii: "[" },
  rightHalf: { unicode: "▐", ascii: "]" },
  topHalf: { unicode: "▀", ascii: "^" },
  bottomHalf: { unicode: "▄", ascii: "_" },
};

/**
 * Tool operation type symbols.
 * These are semantic symbols for different categories of operations.
 * Using typographic/geometric symbols, NOT emojis.
 */
export const TOOL_TYPE_SYMBOLS: Record<string, SymbolSet> = {
  // File operations
  read: { unicode: "◀", ascii: "<" }, // Input/read indicator
  write: { unicode: "▶", ascii: ">" }, // Output/write indicator
  edit: { unicode: "◇", ascii: "~" }, // Modification indicator

  // Execution
  bash: { unicode: "$", ascii: "$" }, // Shell prompt (universally recognized)
  exec: { unicode: "▷", ascii: ">" }, // Execution/play

  // Search operations
  search: { unicode: "/", ascii: "/" }, // Search/find
  glob: { unicode: "*", ascii: "*" }, // Pattern/wildcard
  grep: { unicode: "/", ascii: "/" }, // Search content

  // Task/planning
  task: { unicode: "▣", ascii: "[#]" }, // Task indicator (filled square)
  taskDone: { unicode: "☑", ascii: "[x]" }, // Checked task
  todo: { unicode: "▣", ascii: "[#]" }, // Todo item

  // Thinking/reasoning
  think: { unicode: "◈", ascii: "..." }, // Thinking/reasoning
  thought: { unicode: "◈", ascii: "..." },

  // System/integration
  lsp: { unicode: "◎", ascii: "@" }, // Language server
  mcp: { unicode: "⬡", ascii: "+" }, // MCP plugin
  plugin: { unicode: "⬡", ascii: "+" }, // Generic plugin

  // Web/external
  web: { unicode: "◉", ascii: "@" }, // Web/network
  fetch: { unicode: "↓", ascii: "v" }, // Download/fetch
  api: { unicode: "⬡", ascii: "+" }, // API call

  // Version control
  git: { unicode: "#", ascii: "#" }, // Git/branch
  github: { unicode: "#", ascii: "#" }, // GitHub

  // Generic
  tool: { unicode: "◆", ascii: "*" }, // Generic tool
  custom: { unicode: "◆", ascii: "*" }, // Custom tool
  skill: { unicode: "★", ascii: "*" }, // Skill/capability
};

/**
 * Miscellaneous symbols.
 */
export const MISC_SYMBOLS: Record<string, SymbolSet> = {
  ellipsis: { unicode: "…", ascii: "..." },
  separator: { unicode: "│", ascii: "|" },
  section: { unicode: "§", ascii: "#" },
  hash: { unicode: "#", ascii: "#" },
  at: { unicode: "@", ascii: "@" },
  plus: { unicode: "+", ascii: "+" },
  minus: { unicode: "-", ascii: "-" },
  star: { unicode: "★", ascii: "*" },
  starOutline: { unicode: "☆", ascii: "*" },
  heart: { unicode: "♥", ascii: "<3" },
  check: { unicode: "✓", ascii: "+" },
  checkBold: { unicode: "✔", ascii: "+" },
  crossBold: { unicode: "✖", ascii: "x" },
};

// =============================================================================
// Symbol Resolution
// =============================================================================

/**
 * Get the appropriate symbol style for the current terminal.
 */
export function getSymbolStyle(): SymbolStyle {
  const caps = getCapabilities();

  // Use ASCII for legacy Windows or terminals without Unicode support
  if (caps.isWindowsLegacy || !caps.supportsUnicode) {
    return "ascii";
  }

  return "unicode";
}

/**
 * Get a symbol with automatic fallback based on terminal capabilities.
 *
 * @param symbolSet - The symbol set with unicode and ascii variants
 * @param style - Optional override for symbol style
 * @returns The appropriate symbol string
 */
export function getSymbol(
  symbolSet: SymbolSet,
  style?: SymbolStyle
): string {
  const resolvedStyle = style ?? getSymbolStyle();
  return resolvedStyle === "unicode" ? symbolSet.unicode : symbolSet.ascii;
}

/**
 * Get a status symbol.
 */
export function getStatusSymbol(
  name: keyof typeof STATUS_SYMBOLS,
  style?: SymbolStyle
): string {
  const symbolSet = STATUS_SYMBOLS[name];
  return symbolSet ? getSymbol(symbolSet, style) : name;
}

/**
 * Get a tool type symbol.
 */
export function getToolTypeSymbol(
  name: string,
  style?: SymbolStyle
): string {
  const normalized = name.toLowerCase();
  const symbolSet = TOOL_TYPE_SYMBOLS[normalized];
  return symbolSet ? getSymbol(symbolSet, style) : getSymbol(TOOL_TYPE_SYMBOLS.tool, style);
}

/**
 * Get an arrow symbol.
 */
export function getArrowSymbol(
  name: keyof typeof ARROW_SYMBOLS,
  style?: SymbolStyle
): string {
  const symbolSet = ARROW_SYMBOLS[name];
  return symbolSet ? getSymbol(symbolSet, style) : name;
}

/**
 * Get a box-drawing symbol.
 */
export function getBoxSymbol(
  name: keyof typeof BOX_SYMBOLS,
  style?: SymbolStyle
): string {
  const symbolSet = BOX_SYMBOLS[name];
  return symbolSet ? getSymbol(symbolSet, style) : name;
}

/**
 * Get a block symbol.
 */
export function getBlockSymbol(
  name: keyof typeof BLOCK_SYMBOLS,
  style?: SymbolStyle
): string {
  const symbolSet = BLOCK_SYMBOLS[name];
  return symbolSet ? getSymbol(symbolSet, style) : name;
}

// =============================================================================
// Formatted Symbol Helpers
// =============================================================================

/**
 * Format a tool invocation prefix.
 * Returns format like "[$] Bash" or "[◀] Read"
 *
 * @param toolName - The tool name (e.g., "read", "bash", "tavily_search")
 * @param style - Optional symbol style override
 * @returns Formatted prefix string
 */
export function formatToolPrefix(toolName: string, style?: SymbolStyle): string {
  const normalized = toolName.toLowerCase();

  // Handle MCP tool patterns (server_action format)
  const mcpMatch = normalized.match(/^(\w+)_\w+$/);
  if (mcpMatch) {
    const serverName = mcpMatch[1];
    // First check TOOL_SYMBOLS for server-specific symbols
    const toolSymbol = TOOL_SYMBOLS[serverName];
    if (toolSymbol) {
      return `[${getSymbol(toolSymbol, style)}]`;
    }
    // Then check TOOL_TYPE_SYMBOLS
    const serverSymbol = TOOL_TYPE_SYMBOLS[serverName];
    if (serverSymbol) {
      return `[${getSymbol(serverSymbol, style)}]`;
    }
    // Fall back to MCP symbol for unknown servers
    return `[${getSymbol(TOOL_TYPE_SYMBOLS.mcp, style)}]`;
  }

  // Direct tool lookup - first check TOOL_SYMBOLS
  const toolSymbol = TOOL_SYMBOLS[normalized];
  if (toolSymbol) {
    return `[${getSymbol(toolSymbol, style)}]`;
  }

  // Then check TOOL_TYPE_SYMBOLS
  const symbolSet = TOOL_TYPE_SYMBOLS[normalized];
  if (symbolSet) {
    return `[${getSymbol(symbolSet, style)}]`;
  }

  // Fallback to generic tool symbol
  return `[${getSymbol(TOOL_TYPE_SYMBOLS.tool, style)}]`;
}

/**
 * Format a status indicator.
 *
 * @param status - Status type
 * @param style - Optional symbol style override
 * @returns Formatted status string like "[✓]" or "[+]"
 */
export function formatStatusIndicator(
  status: keyof typeof STATUS_SYMBOLS,
  style?: SymbolStyle
): string {
  return `[${getStatusSymbol(status, style)}]`;
}

/**
 * Format a progress bar using block symbols.
 *
 * @param progress - Progress value 0-1
 * @param width - Width of the progress bar in characters
 * @param style - Optional symbol style override
 * @returns Progress bar string like "[████░░░░░░]"
 */
export function formatProgressBar(
  progress: number,
  width: number = 10,
  style?: SymbolStyle
): string {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const filledCount = Math.round(clampedProgress * width);
  const emptyCount = width - filledCount;

  const fillChar = getSymbol(BLOCK_SYMBOLS.full, style);
  const emptyChar = getSymbol(BLOCK_SYMBOLS.light, style);

  return `[${fillChar.repeat(filledCount)}${emptyChar.repeat(emptyCount)}]`;
}

/**
 * Format a separator line.
 *
 * @param width - Width of the separator
 * @param text - Optional text to include in separator
 * @param style - Optional symbol style override
 * @returns Separator line like "──── Text ────"
 */
export function formatSeparator(
  width: number,
  text?: string,
  style?: SymbolStyle
): string {
  const lineChar = getSymbol(BOX_SYMBOLS.horizontal, style);

  if (!text) {
    return lineChar.repeat(width);
  }

  const textWithPadding = ` ${text} `;
  const prefixLen = 4;
  const remaining = width - prefixLen - textWithPadding.length;
  const suffix = lineChar.repeat(Math.max(0, remaining));

  return lineChar.repeat(prefixLen) + textWithPadding + suffix;
}

// =============================================================================
// Tool Name to Symbol Mapping (Comprehensive)
// =============================================================================

/**
 * Complete mapping of tool names to their symbol sets.
 * Includes all 21+ tools from the specification.
 */
export const TOOL_SYMBOLS: Record<string, SymbolSet> = {
  // File operations
  read: TOOL_TYPE_SYMBOLS.read,
  write: TOOL_TYPE_SYMBOLS.write,
  edit: TOOL_TYPE_SYMBOLS.edit,

  // Execution
  bash: TOOL_TYPE_SYMBOLS.bash,

  // Search
  glob: TOOL_TYPE_SYMBOLS.glob,
  grep: TOOL_TYPE_SYMBOLS.grep,
  codesearch: TOOL_TYPE_SYMBOLS.search,

  // Task management
  task: TOOL_TYPE_SYMBOLS.task,
  todowrite: TOOL_TYPE_SYMBOLS.todo,
  todoread: TOOL_TYPE_SYMBOLS.todo,

  // Thinking
  thought: TOOL_TYPE_SYMBOLS.thought,

  // System
  lsp: TOOL_TYPE_SYMBOLS.lsp,

  // Web/external
  websearch: TOOL_TYPE_SYMBOLS.web,
  webfetch: TOOL_TYPE_SYMBOLS.fetch,

  // MCP/plugins
  mcp: TOOL_TYPE_SYMBOLS.mcp,
  tavily: TOOL_TYPE_SYMBOLS.web,
  context7: TOOL_TYPE_SYMBOLS.api,
  exa: TOOL_TYPE_SYMBOLS.search,
  brave: TOOL_TYPE_SYMBOLS.web,

  // Version control
  gh: TOOL_TYPE_SYMBOLS.git,
  github: TOOL_TYPE_SYMBOLS.github,

  // Generic
  custom: TOOL_TYPE_SYMBOLS.custom,
  skill: TOOL_TYPE_SYMBOLS.skill,
};

/**
 * Get the symbol for a specific tool by name.
 *
 * @param toolName - The tool name
 * @param style - Optional symbol style override
 * @returns The appropriate symbol
 */
export function getToolSymbol(toolName: string, style?: SymbolStyle): string {
  const normalized = toolName.toLowerCase();

  // Handle MCP tool patterns
  const mcpMatch = normalized.match(/^(\w+)_\w+$/);
  if (mcpMatch) {
    const serverName = mcpMatch[1];
    const serverSymbol = TOOL_SYMBOLS[serverName];
    if (serverSymbol) {
      return getSymbol(serverSymbol, style);
    }
    return getSymbol(TOOL_TYPE_SYMBOLS.mcp, style);
  }

  // Direct lookup
  const symbolSet = TOOL_SYMBOLS[normalized];
  if (symbolSet) {
    return getSymbol(symbolSet, style);
  }

  // Fallback
  return getSymbol(TOOL_TYPE_SYMBOLS.tool, style);
}
