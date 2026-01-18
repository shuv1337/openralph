import { useTheme } from "../context/ThemeContext";
import { layout, statusIndicators } from "./tui-theme";
import type { RalphStatus, SandboxConfig } from "./tui-types";

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

function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + "…";
}

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

  const statusDisplay = () => getStatusDisplay(props.status, theme, props.currentTaskId);

  const taskDisplay = () => {
    if (!props.currentTaskTitle) return null;
    if (props.status !== "running") return null;
    return truncateText(props.currentTaskTitle, 50);
  };

  const planLabel = () => (props.planName ? truncateText(props.planName, 30) : null);

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
          <text fg={statusDisplay().color}> {statusDisplay().label}</text>
          {planLabel() && <text fg={t().primary}>{planLabel()}</text>}
        </box>
        <box flexDirection="row" gap={1}>
          {props.currentModel && (
            <>
              <text fg={t().textMuted}>Model:</text>
              <text fg={t().accent}> {props.currentModel}</text>
              <text fg={t().textMuted}> │</text>
            </>
          )}
          {props.agentName && (
            <>
              <text fg={t().textMuted}>Agent:</text>
              <text fg={t().secondary}> {props.agentName}</text>
            </>
          )}
          {props.adapterName && (
            <>
              <text fg={t().textMuted}> Adapter:</text>
              <text fg={t().primary}> {props.adapterName}</text>
            </>
          )}
        </box>
      </box>

      <box flexDirection="row" justifyContent="space-between" marginTop={0}>
        <box flexDirection="row" gap={1}>
          {taskDisplay() && (
            <>
              <text fg={t().textMuted}>Working on:</text>
              {props.currentTaskId && <text fg={t().secondary}>{props.currentTaskId}</text>}
              <text fg={t().text}> {taskDisplay()}</text>
            </>
          )}
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={t().textMuted}>Sandbox:</text>
          <text fg={props.sandboxConfig?.enabled ? t().success : t().textMuted}> {sandboxLabel()}</text>
        </box>
      </box>
    </box>
  );
}
