import { Show, For, createMemo } from "solid-js";
import { useTheme } from "../context/ThemeContext";
import { renderMarkdownBold } from "../lib/text-utils";
import { formatViewMode, taskStatusIndicators, getTaskStatusColor } from "./tui-theme";
import type { DetailsViewMode, TaskStatus, UiTask } from "./tui-types";
import type { ToolEvent } from "../state";
import { Log } from "./log";
import { TerminalPane } from "./terminal-pane";

// =====================================================
// ACCEPTANCE CRITERIA PARSING
// =====================================================

export type AcceptanceCriteriaItem = {
  text: string;
  checked: boolean;
};

/**
 * Parse acceptance criteria from description, dedicated field, or metadata array.
 * Looks for markdown checklist items (- [ ] or - [x])
 */
function parseAcceptanceCriteria(
  description?: string,
  acceptanceCriteria?: string
): AcceptanceCriteriaItem[] {
  const content = acceptanceCriteria || description || "";
  const lines = content.split("\n");
  const criteria: AcceptanceCriteriaItem[] = [];

  let inCriteriaSection = false;

  for (const line of lines) {
    // Check for section header
    if (line.toLowerCase().includes("acceptance criteria")) {
      inCriteriaSection = true;
      continue;
    }

    // Parse checklist items
    const checkboxMatch = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
    if (checkboxMatch) {
      criteria.push({
        checked: checkboxMatch[1].toLowerCase() === "x",
        text: checkboxMatch[2].trim(),
      });
    }

    // Accept bullet points in criteria section
    if (inCriteriaSection) {
      const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
      if (bulletMatch && !checkboxMatch) {
        criteria.push({
          checked: false,
          text: bulletMatch[1].trim(),
        });
      }
    }
  }

  return criteria;
}

// =====================================================
// PRIORITY DISPLAY
// =====================================================

const priorityLabels: Record<number, string> = {
  0: "P0 - Critical",
  1: "P1 - High",
  2: "P2 - Medium",
  3: "P3 - Low",
  4: "P4 - Backlog",
};

function getPriorityColor(priority: number, theme: ReturnType<typeof useTheme>["theme"]): string {
  const t = theme();
  switch (priority) {
    case 0: return t.error;      // Critical - red
    case 1: return t.warning;    // High - orange
    case 2: return t.primary;    // Medium - blue
    case 3: return t.secondary;  // Low - purple
    case 4: return t.textMuted;  // Backlog - gray
    default: return t.textMuted;
  }
}

export type RightPanelProps = {
  selectedTask: UiTask | null;
  viewMode: DetailsViewMode;
  adapterMode: "sdk" | "pty";
  events: ToolEvent[];
  isIdle: boolean;
  errorRetryAt?: number;
  terminalBuffer?: string;
  terminalCols: number;
  terminalRows: number;
};

// =====================================================
// STATUS COLOR WITH FULL STATUS SUPPORT
// =====================================================

function getStatusColorFromTheme(status: TaskStatus, theme: ReturnType<typeof useTheme>["theme"]): string {
  const t = theme();
  switch (status) {
    case "done":
      return t.success;
    case "active":
      return t.primary;
    case "actionable":
      return t.success;
    case "blocked":
      return t.error;
    case "error":
      return t.error;
    case "closed":
      return t.textMuted;
    case "pending":
    default:
      return t.textMuted;
  }
}

function NoSelection() {
  const { theme } = useTheme();
  const t = () => theme();

  return (
    <box flexGrow={1} flexDirection="column" padding={2}>
      <box marginBottom={1}>
        <text fg={t().text}>Getting Started</text>
      </box>
      <box marginBottom={2}>
        <text fg={t().textMuted}>
          No tasks available. Run `ralph init` or add tasks to your plan.
        </text>
      </box>
      <text fg={t().textMuted}>Press q to quit</text>
    </box>
  );
}

// =====================================================
// ACCEPTANCE CRITERIA LIST COMPONENT
// =====================================================

function AcceptanceCriteriaList(props: { 
  task: UiTask; 
}) {
  const { theme } = useTheme();
  const t = () => theme();
  
  const criteria = createMemo(() => 
    parseAcceptanceCriteria(
      props.task.description, 
      props.task.acceptanceCriteria
    )
  );

  return (
    <Show when={criteria().length > 0}>
      <box flexDirection="column" marginTop={1}>
        <box marginBottom={1}>
          <text fg={t().primary}>Acceptance Criteria</text>
        </box>
        <For each={criteria()}>
          {(item) => (
            <box flexDirection="row" paddingLeft={1}>
              <text fg={item.checked ? t().success : t().textMuted}>
                {item.checked ? "✓" : "○"}
              </text>
              <text fg={item.checked ? t().textMuted : t().text}> {item.text}</text>
            </box>
          )}
        </For>
      </box>
    </Show>
  );
}

// =====================================================
// PRIORITY DISPLAY COMPONENT
// =====================================================

function PriorityDisplay(props: { 
  priority?: number; 
}) {
  const { theme } = useTheme();
  const t = () => theme();
  const priorityValue = () => props.priority ?? 2; // Default to P2

  const priorityLabel = createMemo(() => priorityLabels[priorityValue()] || "P2 - Medium");
  const priorityColor = createMemo(() => getPriorityColor(priorityValue(), theme));

  return (
    <box marginBottom={1}>
      <text fg={t().textMuted}>Priority: </text>
      <text fg={priorityColor()}>{priorityLabel()}</text>
    </box>
  );
}

// =====================================================
// ENHANCED TASK DETAILS COMPONENT
// =====================================================

function TaskDetails(props: { task: UiTask }) {
  const { theme } = useTheme();
  const t = () => theme();

  const statusColor = () => getStatusColorFromTheme(props.task.status, theme);
  const statusIndicator = () => taskStatusIndicators[props.task.status] || taskStatusIndicators.pending;

  // Render title and description with markdown bold parsing
  const renderedTitle = () => renderMarkdownBold(
    props.task.title, 
    t().text, 
    t().accent,
    t().secondary // Use secondary color for [tags]
  );
  const renderedDescription = () => renderMarkdownBold(
    props.task.description ?? props.task.title,
    t().text,
    t().accent,
    t().secondary // Use secondary color for [tags]
  );

  // Check if description contains acceptance criteria
  const hasAcceptanceCriteria = createMemo(() => 
    props.task.description?.toLowerCase().includes("acceptance criteria") ||
    props.task.acceptanceCriteria !== undefined
  );

  return (
    <box flexDirection="column" padding={1} flexGrow={1}>
      <scrollbox flexGrow={1}>
        <box marginBottom={1}>
          <text fg={statusColor()}>{statusIndicator()}</text>
          <text fg={t().text}> </text>
          {renderedTitle()}
          <text fg={t().textMuted}> ({props.task.id})</text>
        </box>

        <box marginBottom={1}>
          <text fg={t().textMuted}>Status: </text>
          <text fg={statusColor()}>{props.task.status}</text>
        </box>

        {/* NEW: Priority display */}
        <Show when={props.task.priority !== undefined}>
          <PriorityDisplay priority={props.task.priority} />
        </Show>

        <Show when={props.task.line !== undefined}>
          <box marginBottom={1}>
            <text fg={t().textMuted}>Plan line: </text>
            <text fg={t().text}>{props.task.line}</text>
          </box>
        </Show>

        <box marginBottom={1}>
          <text fg={t().primary}>Description</text>
        </box>
        <box
          padding={1}
          border
          borderColor={t().borderSubtle}
          backgroundColor={t().backgroundElement}
        >
          {renderedDescription()}
        </box>

        {/* NEW: Acceptance criteria */}
        <Show when={hasAcceptanceCriteria()}>
          <AcceptanceCriteriaList task={props.task} />
        </Show>
      </scrollbox>

      {/* Keybind hints */}
      <box flexDirection="row" gap={2} marginTop={1}>
        <text fg={t().textMuted}>[Shift+C] Show completed</text>
        <text fg={t().textMuted}>[↑↓] Navigate</text>
        <text fg={t().textMuted}>[?] Help</text>
      </box>
    </box>
  );
}

function OutputView(props: {
  adapterMode: "sdk" | "pty";
  events: ToolEvent[];
  isIdle: boolean;
  errorRetryAt?: number;
  terminalBuffer?: string;
  terminalCols: number;
  terminalRows: number;
}) {
  return (
    <box flexGrow={1} flexDirection="column">
      <Show
        when={props.adapterMode === "pty"}
        fallback={
          <Log
            events={props.events}
            isIdle={props.isIdle}
            errorRetryAt={props.errorRetryAt}
          />
        }
      >
        <TerminalPane
          buffer={props.terminalBuffer || ""}
          cols={props.terminalCols}
          rows={props.terminalRows}
        />
      </Show>
    </box>
  );
}

export function RightPanel(props: RightPanelProps) {
  const { theme } = useTheme();
  const t = () => theme();

  const title = () => `Details ${formatViewMode(props.viewMode)}`;

  return (
    <box
      title={title()}
      flexGrow={2}
      flexShrink={1}
      minWidth={40}
      flexDirection="column"
      backgroundColor={t().background}
      border
      borderColor={t().border}
    >
      <Show
        when={props.viewMode === "output"}
        fallback={
          <Show when={props.selectedTask} fallback={<NoSelection />}>
            {(task) => <TaskDetails task={task()} />}
          </Show>
        }
      >
        <OutputView
          adapterMode={props.adapterMode}
          events={props.events}
          isIdle={props.isIdle}
          errorRetryAt={props.errorRetryAt}
          terminalBuffer={props.terminalBuffer}
          terminalCols={props.terminalCols}
          terminalRows={props.terminalRows}
        />
      </Show>
    </box>
  );
}
