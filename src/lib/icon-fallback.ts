import { getCapabilities } from "./terminal-capabilities";

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
export const ICON_SETS = {
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
  thought: {
    nerd: '󰋚',
    unicode: '💭',
    ascii: '[THINK]',
  },
};

/**
 * Get icon for a tool by name with fallback.
 */
export function getToolIcon(toolName: string): string {
  const normalized = toolName.toLowerCase();
  const iconSet = ICON_SETS[normalized as keyof typeof ICON_SETS];
  
  if (iconSet) {
    return getIcon(iconSet);
  }
  
  // Generic tool icon
  return getIcon({
    nerd: '',
    unicode: '🔧',
    ascii: `[${toolName.toUpperCase()}]`,
  });
}
