/**
 * Task status types matching Ralph TUI acceptance criteria.
 * Provides granular task lifecycle tracking.
 * 
 * - 'done': Task completed in current session (green checkmark)
 * - 'active': Task currently being worked on (blue arrow)
 * - 'actionable': Task ready to work on with no blocking dependencies (green arrow)
 * - 'pending': Task waiting to be worked on (grey circle)
 * - 'blocked': Task blocked by dependencies (red symbol)
 * - 'error': Task execution failed (red X)
 * - 'closed': Previously completed task (greyed out checkmark for historical tasks)
 */
export type TaskStatus =
  | "done"
  | "active"
  | "actionable"
  | "pending"
  | "blocked"
  | "error"
  | "closed";
