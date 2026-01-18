import type { Theme } from "./theme-resolver";

/**
 * Extended color palette with new semantic colors.
 */
export interface ExtendedTheme extends Theme {
  // New semantic colors for tools
  toolRead: string;       // File read operations
  toolWrite: string;      // File write operations
  toolSearch: string;     // Search operations
  toolExecute: string;    // Shell execution
  toolWeb: string;        // Web operations
  toolReasoning: string;  // Thought/reasoning
  toolPlanning: string;   // Planning tools
  toolSystem: string;     // System/LSP tools
  
  // UI element enhancements
  iteration: string;      // Iteration headers
  duration: string;       // Duration indicators
  commit: string;         // Commit indicators
}

/**
 * Semantic color mappings for common themes.
 * Keys are normalized theme names (lowercase, no special chars).
 */
export const EXTENDED_THEME_MAPPINGS: Record<string, Partial<ExtendedTheme>> = {
  tokyonight: {
    toolRead: '#7aa2f7',      // Blue
    toolWrite: '#9ece6a',     // Green
    toolSearch: '#e0af68',    // Yellow/orange
    toolExecute: '#565f89',   // Gray
    toolWeb: '#7dcfff',       // Cyan
    toolReasoning: '#bb9af7', // Purple
    toolPlanning: '#c0caf5',  // Text
    toolSystem: '#414868',    // Dim
    iteration: '#414868',
    duration: '#9ece6a',
    commit: '#7aa2f7',
  },
  
  nightowl: {
    toolRead: '#82aaff',      // Light blue
    toolWrite: '#addb67',     // Green
    toolSearch: '#ecc48d',    // Peach
    toolExecute: '#5f7e97',   // Slate
    toolWeb: '#7fdbca',       // Teal
    toolReasoning: '#c792ea', // Mauve
    toolPlanning: '#d6deeb',  // Text
    toolSystem: '#4b6479',    // Dim
    iteration: '#4b6479',
    duration: '#addb67',
    commit: '#82aaff',
  },

  gruvbox: {
    toolRead: '#458588',      // Blue
    toolWrite: '#98971a',     // Green
    toolSearch: '#d79921',    // Yellow
    toolExecute: '#928374',   // Gray
    toolWeb: '#83a598',       // Cyan
    toolReasoning: '#b16286', // Purple
    toolPlanning: '#ebdbb2',
    toolSystem: '#665c54',
    iteration: '#3c3836',
    duration: '#98971a',
    commit: '#458588',
  },
  
  dracula: {
    toolRead: '#8be9fd',      // Cyan
    toolWrite: '#50fa7b',     // Green
    toolSearch: '#f1fa8c',    // Yellow
    toolExecute: '#6272a4',   // Muted blue
    toolWeb: '#bd93f9',       // Purple
    toolReasoning: '#ff79c6', // Pink
    toolPlanning: '#f8f8f2',
    toolSystem: '#44475a',
    iteration: '#44475a',
    duration: '#50fa7b',
    commit: '#8be9fd',
  },

  catppuccin: {
    toolRead: '#89b4fa',      // Blue
    toolWrite: '#a6e3a1',     // Green
    toolSearch: '#f9e2af',    // Yellow
    toolExecute: '#6c7086',   // Overlay
    toolWeb: '#89dceb',       // Sky
    toolReasoning: '#cba6f7', // Mauve
    toolPlanning: '#cdd6f4',  // Text
    toolSystem: '#585b70',    // Surface2
    iteration: '#45475a',     // Surface1
    duration: '#a6e3a1',
    commit: '#89b4fa',
  },
};

/**
 * Get extended theme with semantic colors.
 * Maps base theme properties to extended properties if no specific mapping exists.
 */
export function getExtendedTheme(baseTheme: Theme, name: string = 'nightowl'): ExtendedTheme {
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Find best match in mappings
  let mapping: Partial<ExtendedTheme> = {};
  for (const [key, val] of Object.entries(EXTENDED_THEME_MAPPINGS)) {
    if (normalizedName.includes(key)) {
      mapping = val;
      break;
    }
  }
  
  // Create extended theme by merging base theme and mapping
  const extended: ExtendedTheme = {
    ...baseTheme,
    // Provide robust defaults for semantic colors based on base theme
    toolRead: mapping.toolRead || baseTheme.info || baseTheme.primary,
    toolWrite: mapping.toolWrite || baseTheme.success || baseTheme.accent,
    toolSearch: mapping.toolSearch || baseTheme.warning || baseTheme.secondary,
    toolExecute: mapping.toolExecute || baseTheme.textMuted || baseTheme.border,
    toolWeb: mapping.toolWeb || baseTheme.secondary || baseTheme.info,
    toolReasoning: mapping.toolReasoning || baseTheme.warning || baseTheme.accent,
    toolPlanning: mapping.toolPlanning || baseTheme.text,
    toolSystem: mapping.toolSystem || baseTheme.textMuted,
    iteration: mapping.iteration || baseTheme.textMuted,
    duration: mapping.duration || baseTheme.success,
    commit: mapping.commit || baseTheme.info,
    ...mapping,
  };
  
  return extended;
}
