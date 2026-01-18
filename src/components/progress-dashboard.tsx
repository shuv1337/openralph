import { useTheme } from "../context/ThemeContext";
import { layout, statusIndicators } from "./tui-theme";
import { truncateText } from "../lib/text-utils";
import type { RalphStatus, SandboxConfig } from "./tui-types";
import { useTerminalDimensions } from "@opentui/solid";
import { createMemo } from "solid-js";

export type ProgressDashboardProps = {
  status: RalphStatus;
  agentName?: string;
  adapterName?: string;
  planName?: string;
  currentTaskId?: string;
  currentTaskTitle?: string;
  /** Current model in provider/model format (e.g., "anthropic/claude-opus-4") */
  currentModel?: string;
  /** Sandbox configuration for display */
  sandboxConfig?: SandboxConfig;
};

function getStatusDisplay(status: RalphStatus, theme: ReturnType<typeof useTheme>["theme"], taskId?: string) {
  const t = theme();
  switch (status) {
    case "ready":
      return { label: "Ready - press p to start", color: t.info, indicator: statusIndicators.ready };
    case "running":
      return { label: "Running", color: t.success, indicator: statusIndicators.running };
    case "paused":
      return { label: "Paused - press p to resume", color: t.warning, indicator: statusIndicators.paused };
    case "complete":
      return { label: "All tasks complete!", color: t.success, indicator: statusIndicators.complete };
    case "error":
      return { label: "Error - check logs", color: t.error, indicator: statusIndicators.error };
    case "starting":
    default: {
      const suffix = taskId ? ` (${taskId})` : "";
      return { label: `Starting${suffix}`, color: t.textMuted, indicator: statusIndicators.starting };
    }
  }
}

/**
 * Get the sandbox display string.
 */
function getSandboxDisplay(sandboxConfig: SandboxConfig | undefined): string | null {
  if (!sandboxConfig?.enabled) return "Disabled";
  
  const mode = sandboxConfig.mode ?? "auto";
  if (mode === "off") return "Off";
  
  const networkSuffix = sandboxConfig.network === false ? " (no-net)" : "";
  return `${mode}${networkSuffix}`;
}

export function ProgressDashboard(props: ProgressDashboardProps) {
  const { theme } = useTheme();
  const t = () => theme();
  const terminalDimensions = useTerminalDimensions();

  const layoutMetrics = createMemo(() => {
    const width = terminalDimensions().width;
    const isCompact = width < 80;
    const isWide = width > 120;
    
    // Calculate available widths based on terminal size
    const leftColMax = Math.max(20, Math.floor(width * (isWide ? 0.5 : 0.4)));
    const rightColMax = Math.max(20, Math.floor(width * (isWide ? 0.4 : 0.5)));
    
    return {
      isCompact,
      isWide,
      leftColMax,
      rightColMax,
      // Dynamic max width for metadata items like Model, Agent, Adapter
      metaItemMax: Math.max(20, Math.floor(width * 0.25))
    };
  });

  const statusDisplay = () => getStatusDisplay(props.status, theme, props.currentTaskId);

  const taskDisplay = () => {
    if (!props.currentTaskTitle) return null;
    if (props.status !== "running") return null;
    return truncateText(props.currentTaskTitle, layoutMetrics().leftColMax);
  };

  const planLabel = () => (props.planName ? truncateText(props.planName, layoutMetrics().leftColMax) : null);

  const sandboxLabel = () => getSandboxDisplay(props.sandboxConfig);

  return (
    <box
      width="100%"
      height={layout.progressDashboard.height}
      flexDirection="column"
      backgroundColor={t().backgroundPanel}
      padding={1}
      border
      borderColor={t().border}
      overflow="hidden"
    >
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row" gap={2} flexShrink={1}>
          <text fg={statusDisplay().color}>{statusDisplay().indicator}</text>
          <text fg={statusDisplay().color}> {truncateText(statusDisplay().label, layoutMetrics().leftColMax)}</text>
          {planLabel() && !layoutMetrics().isCompact && <text fg={t().primary}>{planLabel()}</text>}
        </box>
        <box flexDirection="row" gap={1} flexShrink={0}>
          {props.currentModel && (
            <>
              <text fg={t().textMuted}>Model:</text>
              <text fg={t().accent}> {truncateText(props.currentModel, layoutMetrics().metaItemMax)}</text>
              {!layoutMetrics().isCompact && <text fg={t().textMuted}> │</text>}
            </>
          )}
          {props.agentName && !layoutMetrics().isCompact && (
            <>
              <text fg={t().textMuted}>Agent:</text>
              <text fg={t().secondary}> {truncateText(props.agentName, layoutMetrics().metaItemMax)}</text>
            </>
          )}
          {props.adapterName && !layoutMetrics().isCompact && (
            <>
              <text fg={t().textMuted}> Adapter:</text>
              <text fg={t().primary}> {truncateText(props.adapterName, layoutMetrics().metaItemMax)}</text>
            </>
          )}
        </box>
      </box>

      <box flexDirection="row" justifyContent="space-between" marginTop={0}>
        <box flexDirection="row" gap={1} flexShrink={1}>
          {taskDisplay() && (
            <>
              <text fg={t().textMuted}>Working on:</text>
              {props.currentTaskId && <text fg={t().secondary}>{props.currentTaskId}</text>}
              <text fg={t().text}> {taskDisplay()}</text>
            </>
          )}
        </box>
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={t().textMuted}>Sandbox:</text>
          <text fg={props.sandboxConfig?.enabled ? t().success : t().textMuted}> {truncateText(sandboxLabel() || "", layoutMetrics().metaItemMax)}</text>
        </box>
      </box>
    </box>
  );
}
