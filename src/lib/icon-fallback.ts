import { getCapabilities } from "./terminal-capabilities";
import { getToolClassification, parseMcpToolName } from "./tool-classification";

/**
 * Icon style based on terminal capabilities.
 */
export type IconStyle = 'nerd' | 'unicode' | 'ascii';

/**
 * Get the appropriate icon style for the terminal.
 */
export function getIconStyle(): IconStyle {
  const caps = getCapabilities();
  
  if (caps.level === 'basic' || !caps.supportsUnicode) {
    return 'ascii';
  }
  
  if (caps.isWindowsLegacy) {
    return 'ascii';
  }
  
  // Nerd font support is often a user preference, but we can assume it for modern TUIs
  // and provide unicode as a secondary fallback if needed.
  // For now, let's default to nerd if unicode is supported.
  return 'nerd';
}

/**
 * Icon set with fallbacks for each style.
 */
export interface IconSet {
  nerd: string;      // Nerd Font glyph
  unicode: string;   // Standard Unicode
  ascii: string;     // ASCII/text representation
}

/**
 * Get icon with fallback based on terminal capabilities.
 */
export function getIcon(iconSet: IconSet): string {
  const style = getIconStyle();
  
  switch (style) {
    case 'nerd':
      return iconSet.nerd;
    case 'unicode':
      return iconSet.unicode || iconSet.ascii;
    case 'ascii':
    default:
      return iconSet.ascii;
  }
}

/**
 * Common icon sets for tools and states.
 */
export const ICON_SETS: Record<string, IconSet> = {
  read: {
    nerd: '󰈞',
    unicode: '📖',
    ascii: '[READ]',
  },
  write: {
    nerd: '󰏫',
    unicode: '📝',
    ascii: '[WRITE]',
  },
  edit: {
    nerd: '󰛓',
    unicode: '✏️',
    ascii: '[EDIT]',
  },
  bash: {
    nerd: '󱆃',
    unicode: '💻',
    ascii: '[BASH]',
  },
  glob: {
    nerd: '',
    unicode: '📁',
    ascii: '[GLOB]',
  },
  grep: {
    nerd: '󰱽',
    unicode: '🔍',
    ascii: '[GREP]',
  },
  task: {
    nerd: '󰙨',
    unicode: '📋',
    ascii: '[TASK]',
  },
  todowrite: {
    nerd: '󰗡',
    unicode: '☑️',
    ascii: '[TODO]',
  },
  todoread: {
    nerd: '󰗡',
    unicode: '📃',
    ascii: '[TODO]',
  },
  thought: {
    nerd: '󰋚',
    unicode: '💭',
    ascii: '[THINK]',
  },
  lsp: {
    nerd: '󰅥',
    unicode: '⚙️',
    ascii: '[LSP]',
  },
  websearch: {
    nerd: '󰖟',
    unicode: '🌐',
    ascii: '[WEB]',
  },
  webfetch: {
    nerd: '󰖟',
    unicode: '🌐',
    ascii: '[FETCH]',
  },
  codesearch: {
    nerd: '󰖟',
    unicode: '🔎',
    ascii: '[CODE]',
  },
  // MCP-specific icons
  mcp: {
    nerd: '󰌘',     // Nerd Font plug icon
    unicode: '🔌',  // Plug emoji
    ascii: '[MCP]',
  },
  // Well-known MCP server icons
  tavily: {
    nerd: '󰖟',
    unicode: '🌐',
    ascii: '[TAVILY]',
  },
  context7: {
    nerd: '󰈙',     // Nerd Font document
    unicode: '📚',
    ascii: '[C7]',
  },
  exa: {
    nerd: '󰖟',
    unicode: '🔍',
    ascii: '[EXA]',
  },
  gh: {
    nerd: '',
    unicode: '🐙',
    ascii: '[GH]',
  },
  github: {
    nerd: '',
    unicode: '🐙',
    ascii: '[GH]',
  },
  brave: {
    nerd: '󰖟',
    unicode: '🦁',
    ascii: '[BRAVE]',
  },
  // Generic success/error icons
  success: {
    nerd: '✓',
    unicode: '✔',
    ascii: '[OK]',
  },
  error: {
    nerd: '✗',
    unicode: '✖',
    ascii: '[ERR]',
  },
  running: {
    nerd: '◉',
    unicode: '●',
    ascii: '[...]',
  },
  custom: {
    nerd: '󰏗',     // Package icon
    unicode: '📦',
    ascii: '[TOOL]',
  },
};

/**
 * Get icon for a tool by name with fallback.
 */
export function getToolIcon(toolName: string): string {
  const normalized = toolName.toLowerCase();
  const iconSet = ICON_SETS[normalized];
  
  if (iconSet) {
    return getIcon(iconSet);
  }
  
  // Generic tool icon
  return getIcon({
    nerd: '󰏗',
    unicode: '🔧',
    ascii: `[${toolName.toUpperCase()}]`,
  });
}

/**
 * Get icon for a tool with full terminal capability awareness.
 * This function uses the tool classification system to determine the best icon.
 * 
 * @param toolName - The name of the tool (e.g., "read", "tavily_search")
 * @returns The appropriate icon string for the current terminal
 */
export function getToolIconWithFallback(toolName: string): string {
  const style = getIconStyle();
  const classification = getToolClassification(toolName);
  
  // For built-in tools, use their specific icon sets
  const normalizedName = toolName.toLowerCase();
  const builtInSet = ICON_SETS[normalizedName];
  if (builtInSet) {
    return getIcon(builtInSet);
  }
  
  // For MCP tools, try to use the server's icon set
  const mcpInfo = parseMcpToolName(toolName);
  if (mcpInfo.isMcp && mcpInfo.serverName) {
    const serverSet = ICON_SETS[mcpInfo.serverName];
    if (serverSet) {
      return getIcon(serverSet);
    }
    // Fall back to generic MCP icon
    return getIcon(ICON_SETS.mcp);
  }
  
  // For custom tools, use classification icon based on style
  switch (style) {
    case 'nerd':
      return classification.icon;
    case 'unicode':
      // For unicode style, try to find a unicode representation
      const customSet = ICON_SETS.custom;
      return customSet?.unicode || classification.fallbackIcon;
    case 'ascii':
    default:
      return classification.fallbackIcon;
  }
}

/**
 * Get the icon set for a tool category.
 * This provides proper fallback icons based on terminal capabilities.
 * 
 * @param category - The tool category
 * @returns An IconSet with nerd, unicode, and ascii variants
 */
export function getCategoryIconSet(category: string): IconSet {
  switch (category) {
    case 'file':
      return ICON_SETS.read;
    case 'search':
      return ICON_SETS.grep;
    case 'execute':
      return ICON_SETS.bash;
    case 'web':
      return ICON_SETS.websearch;
    case 'planning':
      return ICON_SETS.task;
    case 'reasoning':
      return ICON_SETS.thought;
    case 'system':
      return ICON_SETS.lsp;
    case 'mcp':
      return ICON_SETS.mcp;
    case 'custom':
    default:
      return ICON_SETS.custom;
  }
}
