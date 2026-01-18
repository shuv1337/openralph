import { createMemo } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { useTheme } from "../context/ThemeContext";
import { renderMarkdownBold, stripMarkdownBold } from "../lib/text-utils";
import { formatElapsedTime, layout, statusIndicators } from "./tui-theme";
import type { RalphStatus, UiTask, RateLimitState, ActiveAgentState, SandboxConfig } from "./tui-types";
import { formatEta } from "../lib/time";

// =====================================================
// ENHANCED HEADER PROPS (With Ralph TUI Features)
// =====================================================

export type HeaderProps = {
  status: RalphStatus;
  iteration: number;
  tasksComplete: number;
  totalTasks: number;
  elapsedMs: number;
  eta: number | null;
  planError?: string;
  selectedTask?: UiTask | null;
  agentName?: string;
  adapterName?: string;
  debug?: boolean;
  // NEW PROPERTIES from Ralph TUI
  /** Current model in provider/model format (e.g., "anthropic/claude-opus-4") */
  currentModel?: string;
  /** Active tracker plugin name */
  trackerName?: string;
  /** Sandbox configuration for display */
  sandboxConfig?: SandboxConfig;
  /** Active agent state (includes fallback info) */
  activeAgentState?: ActiveAgentState;
  /** Rate limit state for fallback display */
  rateLimitState?: RateLimitState;
  /** Maximum iterations (for iteration counter display) */
  maxIterations?: number;
};

function truncateText(text: string, maxWidth: number): string {
  // Strip markdown to get actual display length
  const plainText = stripMarkdownBold(text);
  if (plainText.length <= maxWidth) return text;
  if (maxWidth <= 3) return plainText.slice(0, maxWidth);
  
  // Need to truncate - work with plain text for length calculation
  const targetLength = maxWidth - 1; // Leave room for ellipsis
  let plainIndex = 0;
  let originalIndex = 0;
  
  while (plainIndex < targetLength && originalIndex < text.length) {
    // Skip ** markers
    if (text.slice(originalIndex, originalIndex + 2) === "**") {
      originalIndex += 2;
      continue;
    }
    plainIndex++;
    originalIndex++;
  }
  
  return stripMarkdownBold(text.slice(0, originalIndex)) + "…";
}

// =====================================================
// STATUS DISPLAY HELPERS
// =====================================================

/**
 * Get compact status display for the current Ralph status.
 * Returns a short, scannable label optimized for the compact header.
 * Supports all enhanced status types from Ralph TUI.
 */
function getStatusDisplay(status: RalphStatus, theme: ReturnType<typeof useTheme>["theme"]) {
  const t = theme();
  
  // Status configuration with indicator, color, and label for each state
  const statusConfig: Record<RalphStatus, { indicator: string; color: string; label: string }> = {
    ready: { indicator: statusIndicators.ready, color: t.info, label: "Ready" },
    running: { indicator: statusIndicators.running, color: t.success, label: "Running" },
    selecting: { indicator: statusIndicators.selecting, color: t.info, label: "Selecting" },
    executing: { indicator: statusIndicators.executing, color: t.success, label: "Executing" },
    pausing: { indicator: statusIndicators.pausing, color: t.warning, label: "Pausing" },
    paused: { indicator: statusIndicators.paused, color: t.warning, label: "Paused" },
    stopped: { indicator: statusIndicators.stopped, color: t.textMuted, label: "Stopped" },
    complete: { indicator: statusIndicators.complete, color: t.success, label: "Complete" },
    idle: { indicator: statusIndicators.idle, color: t.textMuted, label: "Idle" },
    error: { indicator: statusIndicators.error, color: t.error, label: "Error" },
    starting: { indicator: statusIndicators.starting, color: t.textMuted, label: "Starting" },
  };
  
  return statusConfig[status] || statusConfig.starting;
}

/**
 * Get the display name and styling for the active agent.
 * Shows fallback indicator when on fallback agent with different color.
 */
function getAgentDisplay(
  agentName: string | undefined,
  activeAgentState: ActiveAgentState | undefined,
  rateLimitState: RateLimitState | undefined,
  theme: ReturnType<typeof useTheme>["theme"]
): { displayName: string; color: string; showRateLimitIcon: boolean; statusLine: string | null } {
  const t = theme();
  
  // Use active agent from engine state if available, otherwise fall back to config
  const activeAgent = agentName || activeAgentState?.plugin;
  const isOnFallback = activeAgentState?.reason === "fallback";
  const isPrimaryRateLimited = rateLimitState?.limitedAt !== undefined;
  const primaryAgent = rateLimitState?.primaryAgent;

  if (!activeAgent) {
    return { displayName: "", color: t.secondary, showRateLimitIcon: false, statusLine: null };
  }

  if (isOnFallback && isPrimaryRateLimited && primaryAgent) {
    // On fallback agent due to rate limit - show with indicator and status message
    return {
      displayName: `agent: ${activeAgent} (fallback)`,
      color: t.warning,
      showRateLimitIcon: true,
      statusLine: `Primary (${primaryAgent}) rate limited, using fallback`,
    };
  }

  if (isOnFallback) {
    // On fallback agent for other reasons
    return {
      displayName: `agent: ${activeAgent} (fallback)`,
      color: t.warning,
      showRateLimitIcon: false,
      statusLine: null,
    };
  }

  return {
    displayName: `agent: ${activeAgent}`,
    color: t.accent,
    showRateLimitIcon: false,
    statusLine: null,
  };
}

/**
 * Get the sandbox display string.
 * Returns null if sandbox is disabled, otherwise returns mode with optional (no-net) suffix.
 */
function getSandboxDisplay(sandboxConfig: SandboxConfig | undefined): string | null {
  if (!sandboxConfig?.enabled) return null;
  
  const mode = sandboxConfig.mode ?? "auto";
  if (mode === "off") return null;
  
  const networkSuffix = sandboxConfig.network === false ? " (no-net)" : "";
  return `${mode}${networkSuffix}`;
}

/**
 * Parse model info for display (provider/model format).
 */
function parseModelDisplay(model: string | undefined): { provider: string; model: string; display: string } | null {
  if (!model) return null;
  const parts = model.split("/");
  if (parts.length >= 2) {
    const [provider, ...rest] = parts;
    const modelName = rest.join("/");
    return { provider, model: modelName, display: `${provider}/${modelName}` };
  }
  return { provider: "", model, display: model };
}

function MiniProgressBar(props: {
  completed: number;
  total: number;
  width: number;
  filledColor: string;
  emptyColor: string;
}) {
  const percentage = () => (props.total > 0 ? Math.round((props.completed / props.total) * 100) : 0);
  const filledWidth = () => Math.floor((percentage() / 100) * props.width);
  const emptyWidth = () => props.width - filledWidth();

  return (
    <box flexDirection="row">
      <text fg={props.filledColor}>{"▓".repeat(filledWidth())}</text>
      <text fg={props.emptyColor}>{"░".repeat(emptyWidth())}</text>
    </box>
  );
}

export function Header(props: HeaderProps) {
  const { theme } = useTheme();
  const t = () => theme();
  const terminalDimensions = useTerminalDimensions();

  const statusDisplay = () => getStatusDisplay(props.status, theme);
  const elapsedSeconds = createMemo(() => Math.floor(props.elapsedMs / 1000));
  const formattedTime = createMemo(() => formatElapsedTime(elapsedSeconds()));
  const formattedEta = createMemo(() => formatEta(props.eta));
  const percentage = createMemo(() => 
    props.totalTasks > 0 ? Math.round((props.tasksComplete / props.totalTasks) * 100) : 0
  );

  // NEW: Iteration counter display with max iterations support
  const iterationDisplay = createMemo(() => {
    if (props.maxIterations !== undefined && props.maxIterations > 0) {
      return `iter: [${props.iteration}/${props.maxIterations}]`;
    }
    return `iter: [${props.iteration}/∞]`;
  });

  // NEW: Agent display with fallback status
  const agentDisplay = createMemo(() => 
    getAgentDisplay(props.agentName, props.activeAgentState, props.rateLimitState, theme)
  );

  // NEW: Model display parsing
  const modelDisplay = createMemo(() => parseModelDisplay(props.currentModel));

  // NEW: Check if agent display is just a duplicate of model display
  // Only hide if agent name was NOT explicitly provided and it matches the model
  const showAgentDisplay = createMemo(() => {
    if (!agentDisplay().displayName) return false;
    if (props.agentName) return true; // Always show if explicitly named
    if (props.activeAgentState?.reason === "fallback") return true; // Always show if fallback
    
    // Otherwise, check if it's just repeating the model name
    const model = modelDisplay()?.display;
    if (!model) return true;
    return !agentDisplay().displayName.includes(model);
  });

  // NEW: Sandbox display
  const sandboxDisplay = createMemo(() => getSandboxDisplay(props.sandboxConfig));

  // NEW: Check if header should be 2 rows (rate limit warning)
  const headerHeight = createMemo(() => 
    agentDisplay().statusLine ? 2 : layout.header.height
  );

  // Simple task title width calculation:
  // Terminal width minus fixed elements (right side ~90 chars, left side ~25 chars)
  // Clamped between 20 (minimum readable) and 120 (maximum useful)
  const taskMaxWidth = createMemo(() => {
    const termWidth = terminalDimensions().width;
    const fixedWidth = 115; // Approximate: right side (90) + left side (25)
    const available = termWidth - fixedWidth;
    return Math.max(20, Math.min(available, 120));
  });

  const taskDisplay = createMemo(() => {
    if (!props.selectedTask) return null;
    // Show task for more status states (including new ones)
    const showTaskStatuses = ["running", "paused", "executing", "selecting"];
    if (!showTaskStatuses.includes(props.status)) return null;
    return truncateText(props.selectedTask.title, taskMaxWidth());
  });

  const taskLabel = createMemo(() => taskDisplay());

  // Render task label with markdown bold parsing
  const renderedTaskLabel = createMemo(() => {
    const label = taskLabel();
    if (!label) return null;
    return renderMarkdownBold(
      label, 
      t().secondary, 
      t().accent,
      t().info // Use info color for tags in header
    );
  });

  return (
    <box
      width="100%"
      height={headerHeight()}
      flexDirection="column"
      backgroundColor={t().backgroundPanel}
    >
      {/* Main header row */}
      <box
        width="100%"
        height={1}
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        paddingLeft={1}
        paddingRight={1}
      >
        <box flexDirection="row" gap={1} flexShrink={1}>
          <text fg={t().primary}>◆ OpenRalph</text>
          <text fg={t().textMuted}>│</text>
          {props.debug && (
            <>
              <text fg={t().warning}>[DEBUG]</text>
              <text fg={t().textMuted}> </text>
            </>
          )}
          <text fg={statusDisplay().color}>{statusDisplay().indicator}</text>
          <text fg={statusDisplay().color}> {statusDisplay().label}</text>
          {taskLabel() && (
            <>
              <text fg={t().textMuted}> → </text>
              {renderedTaskLabel()}
            </>
          )}
        </box>

        <box flexDirection="row" gap={1} alignItems="center">
          {/* Agent display with rate limit icon */}
          {showAgentDisplay() && (
            <text fg={agentDisplay().color}>
              {agentDisplay().showRateLimitIcon && <span>⏳ </span>}
              {agentDisplay().displayName}
            </text>
          )}

          {/* NEW: Separator between Agent and Model if both present and distinct */}
          {showAgentDisplay() && modelDisplay() && (
            <text fg={t().textMuted}>│</text>
          )}

          {/* NEW: Model display */}
          {modelDisplay() && (
            <text fg={t().accent}>{modelDisplay()!.display}</text>
          )}

          {/* NEW: Tracker name */}
          {props.trackerName && (
            <text fg={t().secondary}>{props.trackerName}</text>
          )}

          {/* NEW: Sandbox indicator */}
          {sandboxDisplay() && (
            <text fg={t().info}>🔒 {sandboxDisplay()}</text>
          )}

          {/* Fallback to original agent/adapter display if new props not used */}
          {!agentDisplay().displayName && (props.agentName || props.adapterName) && (
            <box flexDirection="row" gap={1}>
              {props.agentName && <text fg={t().secondary}>{props.agentName}</text>}
              {props.agentName && props.adapterName && <text fg={t().textMuted}>/</text>}
              {props.adapterName && <text fg={t().primary}>{props.adapterName}</text>}
            </box>
          )}

          {/* Progress section */}
          <box flexDirection="row" gap={1} alignItems="center">
            {props.planError ? (
              <text fg={t().error}>⚠️ Plan Error</text>
            ) : (
              <>
                <MiniProgressBar
                  completed={props.tasksComplete}
                  total={props.totalTasks}
                  width={8}
                  filledColor={t().success}
                  emptyColor={t().textMuted}
                />
                <text fg={t().text}>
                  {props.tasksComplete}/{props.totalTasks} ({percentage()}%)
                </text>
              </>
            )}
          </box>

          {/* NEW: Enhanced iteration counter */}
          <text fg={t().textMuted}>{iterationDisplay()}</text>

          {/* Time and ETA */}
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={t().textMuted}>⏱</text>
            <text fg={t().text}>{formattedTime()}</text>
          </box>

          <text fg={t().textMuted}>{formattedEta()}</text>
        </box>
      </box>

      {/* NEW: Status line row - shown when primary agent is rate limited */}
      {agentDisplay().statusLine && (
        <box
          width="100%"
          height={1}
          flexDirection="row"
          justifyContent="center"
          alignItems="center"
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={t().warning}>
            <span>⏳ </span>
            <span>{agentDisplay().statusLine}</span>
          </text>
        </box>
      )}
    </box>
  );
}
