/**
 * Tool execution state for visualization.
 */
export type ExecutionState = 
  | 'pending'     // Queued but not started
  | 'running'     // Currently executing
  | 'completed'   // Finished successfully
  | 'error'       // Failed
  | 'cancelled';  // User cancelled

/**
 * Execution state styling.
 */
export interface ExecutionStateStyle {
  icon: string;           // State indicator icon
  iconAnimated: boolean;  // Whether icon animates
  color: string;          // Theme color key
  pulse: boolean;         // Whether to pulse the indicator
  label: string;          // Human-readable label
}

/**
 * Execution state styles.
 */
export const EXECUTION_STATE_STYLES: Record<ExecutionState, ExecutionStateStyle> = {
  pending: {
    icon: '○',
    iconAnimated: false,
    color: 'textMuted',
    pulse: false,
    label: 'Pending',
  },
  running: {
    icon: '◉',
    iconAnimated: true,
    color: 'info',
    pulse: true,
    label: 'Running',
  },
  completed: {
    icon: '✓',
    iconAnimated: false,
    color: 'success',
    pulse: false,
    label: 'Done',
  },
  error: {
    icon: '✗',
    iconAnimated: false,
    color: 'error',
    pulse: true,
    label: 'Error',
  },
  cancelled: {
    icon: '⊘',
    iconAnimated: false,
    color: 'textMuted',
    pulse: false,
    label: 'Cancelled',
  },
};

/**
 * Tool execution event with full metadata.
 */
export interface ToolExecutionEvent {
  toolName: string;
  callId: string;
  state: ExecutionState;
  timestamp: number;
  duration?: number;       // ms when completed
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  iteration: number;
}
