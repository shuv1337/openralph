import { For, Show, createEffect, createMemo } from "solid-js";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useTheme } from "../context/ThemeContext";
import { RenderMarkdownSegments, stripMarkdownBold } from "../lib/text-utils";
import { taskStatusIndicators, getTaskStatusColor } from "./tui-theme";
import type { TaskStatus, UiTask } from "./tui-types";

// =====================================================
// LEFT PANEL PROPS WITH HIERARCHY SUPPORT
// =====================================================

export type LeftPanelProps = {
  tasks: UiTask[];
  selectedIndex: number;
  width: number;
  /** Panel height - used to trigger scroll recalculation on terminal resize */
  height: number;
  /** Total number of tasks (including completed) - used to show "all completed" message */
  totalTasks?: number;
  /** Whether completed tasks are currently being shown */
  showingCompleted?: boolean;
  /** Callback when a task is clicked/selected */
  onSelect?: (index: number) => void;
};

// =====================================================
// HIERARCHY SUPPORT UTILITIES
// =====================================================

/**
 * Build a map of parent IDs to determine indentation levels.
 * Tasks with a parentId that exists in the task list are indented.
 */
function buildIndentMap(tasks: UiTask[]): Map<string, number> {
  // Create a set of all task IDs for quick lookup
  const taskIds = new Set(tasks.map((t) => t.id));
  const indentMap = new Map<string, number>();

  for (const task of tasks) {
    // If task has a parent that exists in our list, it's indented
    if (task.parentId && taskIds.has(task.parentId)) {
      indentMap.set(task.id, 1);
    } else {
      indentMap.set(task.id, 0);
    }
  }

  return indentMap;
}

function truncateText(text: string, maxWidth: number): string {
  // Use plain text for length calculation to handle markdown properly
  const plainText = stripMarkdownBold(text);
  if (plainText.length <= maxWidth) return text;
  
  if (maxWidth <= 3) return plainText.slice(0, maxWidth);
  
  // For simplicity and to avoid broken markdown markers, 
  // we return truncated plain text when truncation is necessary.
  const targetLength = maxWidth - 1; // Leave room for ellipsis
  return plainText.slice(0, targetLength) + "…";
}

// Fixed width for task ID column alignment
const ID_COLUMN_WIDTH = 10;

/**
 * Get status color from theme using the new semantic color mappings.
 * Falls back to textMuted for unknown statuses.
 */
function getStatusColorFromTheme(status: TaskStatus, theme: ReturnType<typeof useTheme>["theme"]): string {
  const t = theme();
  switch (status) {
    case "done":
      return t.success;      // green
    case "active":
      return t.primary;      // blue (currently working)
    case "actionable":
      return t.primary;      // blue (ready to work)
    case "pending":
      return t.textMuted;    // gray
    case "blocked":
      return t.error;        // red
    case "error":
      return t.error;        // red
    case "closed":
      return t.textMuted;    // greyed out
    default:
      return t.textMuted;
  }
}

// =====================================================
// ENHANCED TASK ROW WITH HIERARCHY AND CLOSED STYLING
// =====================================================

/**
 * Single task item row with hierarchy support.
 * Shows: [indent][status indicator] [task ID] [task title (truncated)]
 */
function TaskRow(props: {
  task: UiTask;
  isSelected: boolean;
  maxWidth: number;
  index: number;
  /** Indentation level (0 = root, 1 = child of root) */
  indentLevel?: number;
  onSelect?: () => void;
}) {
  const { theme } = useTheme();
  const t = () => theme();

  const statusColor = () => getStatusColorFromTheme(props.task.status, theme);
  const statusIndicator = () => taskStatusIndicators[props.task.status] || taskStatusIndicators.pending;

  const indentLevel = () => props.indentLevel ?? 0;
  const indent = () => "  ".repeat(indentLevel());
  const indentWidth = () => indentLevel() * 2;

  const paddedId = () => props.task.id.padEnd(ID_COLUMN_WIDTH).slice(0, ID_COLUMN_WIDTH);
  const titleWidth = () => Math.max(10, props.maxWidth - ID_COLUMN_WIDTH - 5 - indentWidth());

  const rowBg = () => {
    if (props.isSelected) return t().primary;
    return props.index % 2 === 0 ? t().background : t().backgroundPanel;
  };

  const isClosed = () => props.task.status === "closed";

  const textColor = () => {
    if (props.isSelected) return t().background;
    if (props.task.status === "done" || isClosed()) return t().textMuted;
    return t().text;
  };

  const boldColor = () => {
    if (props.isSelected) return t().background;
    return t().accent;
  };

  const idColor = () => {
    if (props.isSelected) return t().background;
    return t().textMuted;
  };

  return (
    <box
      width="100%"
      height={1}
      flexDirection="row"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={rowBg()}
      onMouseDown={props.onSelect}
    >
      <text>
        {/* Render all elements inline in a single text component for perfect layout alignment */}
        <span style={{ fg: t().textMuted }}>{indent()}</span>
        <span style={{ fg: statusColor() }}>{statusIndicator()}</span>
        <span style={{ fg: idColor() }}> {paddedId()}</span>
        <span style={{ fg: textColor() }}> </span>
        <RenderMarkdownSegments
          text={truncateText(props.task.title, titleWidth())}
          normalColor={textColor()}
          boldColor={boldColor()}
          tagColor={t().secondary}
        />
      </text>
    </box>
  );
}

export function LeftPanel(props: LeftPanelProps) {
  const { theme } = useTheme();
  const t = () => theme();
  let scrollboxRef: ScrollBoxRenderable | undefined;

  const maxRowWidth = () => Math.max(20, props.width - 4);

  const indentMap = createMemo(() => buildIndentMap(props.tasks));

  const emptyMessage = createMemo(() => {
    const totalTasks = props.totalTasks ?? 0;
    const showingCompleted = props.showingCompleted ?? false;
    
    if (totalTasks > 0 && !showingCompleted) {
      return `All ${totalTasks} tasks completed! 🎉`;
    }
    
    return "No tasks loaded";
  });

  const taskCount = createMemo(() => props.tasks.length);

  createEffect(() => {
    const selectedIndex = props.selectedIndex;
    const count = taskCount();
    const _height = props.height;

    if (!scrollboxRef || count === 0) {
      if (scrollboxRef) {
        scrollboxRef.scrollTop = 0;
      }
      return;
    }

    // Jump Scrolling Logic:
    // Instead of scrolling 1-to-1, we implement a significant "jump" when the selection 
    // hits the edges of the visible viewport. This fulfills the user's request for 
    // an increased jump (2x dashboard height = 12 lines) and ensures rows align perfectly.
    const updateScroll = () => {
      if (!scrollboxRef) return;

      const currentTop = scrollboxRef.scrollTop;
      const dashboardHeight = 6; 
      const jumpAmount = 2 * dashboardHeight; // 12 lines
      
      // Estimated viewport height (Total panel height minus title and borders)
      const viewportHeight = Math.max(5, props.height - 2);
      const bottomThreshold = viewportHeight - 2;

      if (selectedIndex >= currentTop + bottomThreshold) {
        // Selection hit bottom edge -> jump down by jumpAmount
        scrollboxRef.scrollTop = currentTop + jumpAmount;
        scrollboxRef.requestRender();
      } else if (selectedIndex < currentTop + 1) {
        // Selection hit top edge -> jump up by jumpAmount
        scrollboxRef.scrollTop = Math.max(0, currentTop - jumpAmount);
        scrollboxRef.requestRender();
      }
    };

    queueMicrotask(() => updateScroll());
  });

  return (
    <box
      title="Tasks"
      flexGrow={1}
      flexShrink={1}
      minWidth={30}
      maxWidth={50}
      flexDirection="column"
      backgroundColor={t().background}
      border
      borderColor={t().border}
    >
      <scrollbox
        ref={(el) => {
          scrollboxRef = el;
        }}
        flexGrow={1}
        width="100%"
        stickyScroll={false}
        rootOptions={{
          backgroundColor: t().background,
        }}
        viewportOptions={{
          backgroundColor: t().background,
        }}
        verticalScrollbarOptions={{
          visible: true,
          trackOptions: {
            backgroundColor: t().border,
          },
        }}
      >
        <Show
          when={taskCount() > 0}
          fallback={
            <box padding={1} flexDirection="column">
              <text fg={t().success}>{emptyMessage()}</text>
              <Show when={(props.totalTasks ?? 0) > 0 && !(props.showingCompleted ?? false)}>
                <text fg={t().textMuted}>Press Shift+C to show completed</text>
              </Show>
            </box>
          }
        >
          <For each={props.tasks}>
            {(task, index) => (
              <TaskRow
                task={task}
                isSelected={index() === props.selectedIndex}
                maxWidth={maxRowWidth()}
                index={index()}
                indentLevel={indentMap().get(task.id) ?? 0}
                onSelect={() => props.onSelect?.(index())}
              />
            )}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}
