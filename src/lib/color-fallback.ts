import { getCapabilities } from "./terminal-capabilities";

/**
 * Color mapping for different capability levels.
 */
export interface ColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  text: string;
  textMuted: string;
  background: string;
  backgroundElement: string;
}

/**
 * Tokyo Night inspired extended theme.
 */
const TRUECOLOR_PALETTE: ColorPalette = {
  primary: '#7aa2f7',      // Blue
  secondary: '#bb9af7',    // Purple
  accent: '#f7768e',       // Red/pink
  success: '#9ece6a',      // Green
  warning: '#e0af68',      // Yellow/orange
  error: '#f7768e',        // Red
  info: '#7dcfff',         // Cyan
  text: '#c0caf5',         // White-ish
  textMuted: '#565f89',    // Gray
  background: '#1a1b26',   // Dark background
  backgroundElement: '#24283b',
};

/**
 * 256-color palette (ANSI).
 */
const PALETTE_256: ColorPalette = {
  primary: '#5f87ff',      // 63 - Blue
  secondary: '#af87ff',    // 141 - Purple
  accent: '#ff5f87',       // 203 - Pink
  success: '#87ff5f',      // 120 - Green
  warning: '#ffaf5f',      // 215 - Orange
  error: '#ff5f5f',        // 203 - Red
  info: '#5fd7ff',         // 81 - Cyan
  text: '#ffffff',         // 255 - White
  textMuted: '#808080',    // 244 - Gray
  background: '#1e1e1e',   // 234 - Dark gray
  backgroundElement: '#2e2e2e',
};

/**
 * 16-color palette (standard ANSI).
 */
const COLORS_PALETTE: ColorPalette = {
  primary: 'blue',
  secondary: 'magenta',
  accent: 'red',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'cyan',
  text: 'white',
  textMuted: 'gray',
  background: 'black',
  backgroundElement: 'black',
};

/**
 * Basic (no color) palette.
 */
const BASIC_PALETTE: ColorPalette = {
  primary: '',             // No styling
  secondary: '',
  accent: '',
  success: '',
  warning: '',
  error: '',
  info: '',
  text: '',
  textMuted: '',
  background: '',
  backgroundElement: '',
};

/**
 * Get color palette for the current terminal capability.
 */
export function getColorPalette(): ColorPalette {
  const caps = getCapabilities();

  switch (caps.level) {
    case 'basic':
      return BASIC_PALETTE;
    case 'colors':
      return COLORS_PALETTE;
    case '256':
      return PALETTE_256;
    case 'truecolor':
    default:
      return TRUECOLOR_PALETTE;
  }
}
