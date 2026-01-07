import { createMemo } from "solid-js";
import { useTheme } from "../context/ThemeContext";
import { formatEta } from "../util/time";

export type HeaderProps = {
  status: "starting" | "running" | "paused" | "complete" | "error" | "idle";
  iteration: number;
  tasksComplete: number;
  totalTasks: number;
  eta: number | null;
  debug?: boolean;
};

/**
 * Header component displaying status, iteration, tasks, and ETA.
 * Compact single-line layout for log-centric view.
 */
export function Header(props: HeaderProps) {
  const { theme } = useTheme();
  
  // Status indicator with appropriate icon and color
  const getStatusDisplay = () => {
    const t = theme();
    switch (props.status) {
      case "running":
        return { icon: "●", color: t.success };
      case "paused":
        return { icon: "⏸", color: t.warning };
      case "complete":
        return { icon: "✓", color: t.success };
      case "error":
        return { icon: "✗", color: t.error };
      case "idle":
        return { icon: "○", color: t.info };
      case "starting":
      default:
        return { icon: "◌", color: t.textMuted };
    }
  };

  const statusDisplay = getStatusDisplay();

  // Memoize progress bar strings - only recompute when tasksComplete or totalTasks change
  const filledCount = createMemo(() =>
    props.totalTasks > 0
      ? Math.round((props.tasksComplete / props.totalTasks) * 8)
      : 0
  );
  const filledBar = createMemo(() => "█".repeat(filledCount()));
  const emptyBar = createMemo(() => "░".repeat(8 - filledCount()));

  const t = theme();
  
  return (
    <box
      flexDirection="row"
      width="100%"
      height={1}
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={t.backgroundPanel}
    >
      {/* Debug mode badge */}
      {props.debug && (
        <>
          <text fg={t.warning}>[DEBUG]</text>
          <text fg={t.borderSubtle}>{" "}</text>
        </>
      )}

      {/* Status indicator */}
      <text fg={statusDisplay.color}>{statusDisplay.icon}</text>
      <text fg={t.text}> {props.status}</text>

      {/* Separator */}
      <text fg={t.borderSubtle}>{" │ "}</text>

      {/* Iteration display */}
      <text fg={t.textMuted}>iter </text>
      <text fg={t.text}>{props.iteration}</text>

      {/* Separator */}
      <text fg={t.borderSubtle}>{" │ "}</text>

      {/* Task progress with inline progress bar */}
      <text fg={t.textMuted}>{filledBar()}</text>
      <text fg={t.borderSubtle}>{emptyBar()}</text>
      <text fg={t.text}> {props.tasksComplete}/{props.totalTasks}</text>

      {/* Separator */}
      <text fg={t.borderSubtle}>{" │ "}</text>

      {/* ETA display */}
      <text fg={t.textMuted}>{formatEta(props.eta)}</text>
    </box>
  );
}

