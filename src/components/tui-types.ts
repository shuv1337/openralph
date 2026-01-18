/**
 * Ralph execution status types.
 * Adopted from Ralph TUI with additional granularity for UI feedback.
 * 
 * - 'starting': Application initializing
 * - 'ready': Waiting for user to start execution (interactive mode)
 * - 'running': Actively executing iterations (generic running state)
 * - 'selecting': Selecting next task to work on
 * - 'executing': Executing agent on current task
 * - 'pausing': Pause requested, waiting for current iteration to complete
 * - 'paused': Paused, waiting to resume
 * - 'stopped': Not running (generic)
 * - 'complete': All tasks finished successfully
 * - 'idle': Stopped, no more tasks available
 * - 'error': Stopped due to error
 */
export type RalphStatus =
  | "starting"
  | "ready"
  | "running"
  | "selecting"
  | "executing"
  | "pausing"
  | "paused"
  | "stopped"
  | "complete"
  | "idle"
  | "error";

/**
 * Task status types matching Ralph TUI acceptance criteria.
 * Provides 7 distinct states for granular task lifecycle tracking.
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

export type DetailsViewMode = "details" | "output" | "prompt";

/**
 * UI representation of a task with optional hierarchy and metadata.
 */
export type UiTask = {
  id: string;
  title: string;
  status: TaskStatus;
  line?: number;
  description?: string;
  /** Parent task ID for hierarchical display (child tasks are indented) */
  parentId?: string;
  /** Task priority (0-4, where 0 is Critical and 4 is Backlog) */
  priority?: number;
  /** Task category for grouping/tags */
  category?: string;
  /** Acceptance criteria items parsed from description */
  acceptanceCriteria?: string;
};

/**
 * Rate limit state for agent fallback display.
 */
export type RateLimitState = {
  /** Timestamp when rate limited (undefined if not limited) */
  limitedAt?: number;
  /** Name of the primary agent that was rate limited */
  primaryAgent?: string;
  /** Name of the fallback agent being used */
  fallbackAgent?: string;
};

/**
 * Active agent state for header display.
 */
export type ActiveAgentState = {
  /** Current agent plugin name */
  plugin: string;
  /** Reason for using this agent ('primary' or 'fallback') */
  reason?: "primary" | "fallback";
};

/**
 * Sandbox configuration for header display.
 */
export type SandboxConfig = {
  /** Whether sandbox is enabled */
  enabled?: boolean;
  /** Sandbox mode (e.g., 'auto', 'on', 'off') */
  mode?: string;
  /** Whether network access is enabled */
  network?: boolean;
};
