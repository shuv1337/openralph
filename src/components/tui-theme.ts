import type { DetailsViewMode, TaskStatus, RalphStatus } from "./tui-types";

// =====================================================
// RALPH STATUS INDICATORS (Enhanced from Ralph TUI)
// =====================================================

/**
 * Status indicator symbols for Ralph execution states.
 * Provides visual feedback for the current execution status.
 */
export const statusIndicators = {
  ready: "◉",        // Ready to start - waiting for user action
  running: "▶",       // Actively executing
  selecting: "◐",     // Selecting next task (animated feel)
  executing: "⏵",     // Executing agent on task
  pausing: "◎",       // Pause requested
  paused: "⏸",        // Paused
  stopped: "■",       // Stopped
  complete: "✓",      // All done
  idle: "○",          // No more work available
  error: "✗",         // Error state
  starting: "○",      // Starting up
} as const;

// =====================================================
// TASK STATUS INDICATORS (Enhanced from Ralph TUI)
// =====================================================

/**
 * Status indicator symbols for task states.
 * Provides 7 distinct visual indicators for granular task lifecycle.
 */
export const taskStatusIndicators: Record<TaskStatus, string> = {
  done: "✓",          // Completed
  active: "▶",        // Currently being worked on
  actionable: "▶",    // Ready to work (green arrow)
  pending: "○",       // Waiting
  blocked: "⊘",       // Blocked by dependencies
  error: "✗",         // Failed/error
  closed: "✓",        // Historical (greyed out)
};

// =====================================================
// TASK STATUS COLORS (Semantic color mapping)
// =====================================================

/**
 * Color mappings for task statuses using Tokyo Night-inspired palette.
 * These are used for consistent task status styling across components.
 */
export const taskStatusColors: Record<TaskStatus, string> = {
  done: "#9ece6a",        // green - completed
  active: "#7aa2f7",      // blue - currently working
  actionable: "#9ece6a",  // green - ready to work
  pending: "#565f89",     // gray - waiting
  blocked: "#f7768e",     // red - blocked
  error: "#f7768e",       // red - error
  closed: "#414868",      // dim gray - historical
};

/**
 * Get the color for a given task status.
 * Falls back to pending color if status is unknown.
 */
export function getTaskStatusColor(status: TaskStatus): string {
  return taskStatusColors[status] || taskStatusColors.pending;
}

/**
 * Get the indicator symbol for a given task status.
 * Falls back to pending indicator if status is unknown.
 */
export function getTaskStatusIndicator(status: TaskStatus): string {
  return taskStatusIndicators[status] || taskStatusIndicators.pending;
}

export const layout = {
  header: {
    height: 1,
  },
  footer: {
    height: 3,
  },
  progressDashboard: {
    height: 6,
  },
  leftPanel: {
    minWidth: 30,
    maxWidth: 50,
    defaultWidthPercent: 35,
  },
  rightPanel: {
    minWidth: 40,
  },
  padding: {
    small: 1,
    medium: 2,
  },
} as const;

export type KeyboardShortcut = {
  key: string;
  description: string;
};

export type FullKeyboardShortcut = KeyboardShortcut & {
  category: string;
};

export const keyboardShortcuts: KeyboardShortcut[] = [
  { key: "q", description: "Quit" },
  { key: "p", description: "Pause/Resume" },
  { key: "c", description: "Commands" },
  { key: "C", description: "Completed" },
  { key: "t", description: "Terminal" },
  { key: "T", description: "Tasks" },
  { key: "o", description: "Details/Output" },
  { key: "d", description: "Dashboard" },
  { key: "h", description: "Toggle done" },
  { key: "↑↓", description: "Navigate" },
  { key: "?", description: "Help" },
];

export const fullKeyboardShortcuts: FullKeyboardShortcut[] = [
  // General
  { key: "?", description: "Show/hide this help", category: "General" },
  { key: "q", description: "Quit Ralph", category: "General" },
  { key: "Esc", description: "Hide tasks/help", category: "General" },
  { key: "c", description: "Open command palette", category: "General" },
  { key: "t", description: "Launch terminal", category: "General" },
  // Execution
  { key: "s", description: "Start execution", category: "Execution" },
  { key: "p", description: "Pause / Resume execution", category: "Execution" },
  { key: ":", description: "Steer active session", category: "Execution" },
  // Views
  { key: "o", description: "Toggle details / output view", category: "Views" },
  { key: "T", description: "Show / hide task list", category: "Views" },
  { key: "C", description: "Show / hide completed tasks", category: "Views" },
  { key: "d", description: "Toggle progress dashboard", category: "Views" },
  { key: "h", description: "Show / hide completed tasks", category: "Views" },
  // Navigation
  { key: "↑ / k", description: "Move selection up", category: "Navigation" },
  { key: "↓ / j", description: "Move selection down", category: "Navigation" },
  { key: "Enter", description: "Select task", category: "Navigation" },
];

export function formatElapsedTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export function formatViewMode(viewMode: DetailsViewMode): string {
  return viewMode === "details" ? "[Details]" : "[Output]";
}
