/**
 * Fallback color palette for the TUI (Night Owl theme).
 * 
 * These values serve as fallback colors when:
 * - Theme context is not yet available (during initialization)
 * - Components haven't been migrated to use ThemeContext
 * - Theme resolution fails for any reason
 * 
 * For new components, prefer using `useTheme()` from ThemeContext.
 * These values map to the following theme properties:
 * - bg/bgDark/bgHighlight/bgPanel -> background/backgroundPanel/backgroundElement
 * - fg/fgDark/fgMuted -> text/textMuted
 * - green -> success
 * - red -> error
 * - yellow -> warning
 * - blue -> info
 * - purple -> accent
 * - cyan -> secondary
 * - border -> border
 * - orange -> (custom, use warning or accent as fallback)
 * 
 * @deprecated For new code, use `useTheme()` hook from ThemeContext instead.
 */
export const colors = {
  bg: "#011627",
  bgDark: "#010e17",
  bgHighlight: "#1d3b53",
  bgPanel: "#0b2942",
  fg: "#d6deeb",
  fgDark: "#5f7e97",
  fgMuted: "#b2ccd6",
  green: "#addb67",
  red: "#ef5350",
  yellow: "#ecc48d",
  blue: "#82aaff",
  purple: "#c792ea",
  cyan: "#7fdbca",
  border: "#1d3b53",
  orange: "#f78c6c",
};

/**
 * Icons for different tool types displayed in the event log
 */
export const TOOL_ICONS: Record<string, string> = {
  read: "󰈞", // Read icon
  write: "󰏫", // Write icon
  edit: "󰛓", // Edit icon
  glob: "center", // Glob icon
  grep: "󰱽", // Grep icon
  bash: "󰆍", // Bash icon
  task: "󰙨", // Task icon
  webfetch: "󰖟",
  websearch: "󰖟",
  codesearch: "󰖟",
  todowrite: "󰗡",
  todoread: "󰗡",
  thought: "󰋚", // Reasoning/Thought icon
};
