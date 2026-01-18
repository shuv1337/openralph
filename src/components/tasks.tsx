import { For } from "solid-js";
import { useTheme } from "../context/ThemeContext";
import { renderMarkdownBold } from "../lib/text-utils";
import type { Task } from "../plan";

export type TasksProps = {
  /** Array of parsed tasks from the plan file */
  tasks: Task[];
  /** Callback when user closes the panel */
  onClose: () => void;
};

/**
 * Single task item renderer.
 * Format: [✓] or [ ] followed by task text.
 * Completed tasks are displayed with muted (grayed out) text.
 */
function TaskItem(props: { task: Task }) {
  const { theme } = useTheme();
  const t = () => theme();

  const checkbox = () => (props.task.done ? "[✓]" : "[ ]");
  const textColor = () => (props.task.done ? t().textMuted : t().text);
  const checkColor = () => (props.task.done ? t().success : t().textMuted);
  const boldColor = () => (props.task.done ? t().textMuted : t().accent);

  return (
    <box width="100%" flexDirection="row">
      <text fg={checkColor()}>{checkbox()}</text>
      <text fg={textColor()}> </text>
      {renderMarkdownBold(props.task.text, textColor(), boldColor())}
    </box>
  );
}

/**
 * Tasks panel component displaying a scrollable list of tasks from the plan file.
 * Shows checkbox indicators with completed tasks grayed out.
 * Press ESC to close the panel.
 */
export function Tasks(props: TasksProps) {
  const { theme } = useTheme();
  const t = () => theme();

  return (
    <scrollbox
      flexGrow={1}
      stickyScroll={false}
      rootOptions={{
        backgroundColor: t().backgroundPanel,
      }}
      viewportOptions={{
        backgroundColor: t().backgroundPanel,
      }}
      verticalScrollbarOptions={{
        visible: true,
        trackOptions: {
          backgroundColor: t().border,
        },
      }}
    >
      <For each={props.tasks}>
        {(task) => <TaskItem task={task} />}
      </For>
    </scrollbox>
  );
}
