import { For } from "solid-js";
import { colors } from "./colors";
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
  const checkbox = () => (props.task.done ? "[✓]" : "[ ]");
  const textColor = () => (props.task.done ? colors.fgMuted : colors.fg);
  const checkColor = () => (props.task.done ? colors.green : colors.fgDark);

  return (
    <box width="100%" flexDirection="row">
      <text fg={checkColor()}>{checkbox()}</text>
      <text fg={textColor()}> {props.task.text}</text>
    </box>
  );
}

/**
 * Tasks panel component displaying a scrollable list of tasks from the plan file.
 * Shows checkbox indicators with completed tasks grayed out.
 * Press ESC to close the panel.
 */
export function Tasks(props: TasksProps) {
  return (
    <scrollbox
      flexGrow={1}
      stickyScroll={false}
      rootOptions={{
        backgroundColor: colors.bgPanel,
      }}
      viewportOptions={{
        backgroundColor: colors.bgPanel,
      }}
      verticalScrollbarOptions={{
        visible: true,
        trackOptions: {
          backgroundColor: colors.border,
        },
      }}
    >
      <For each={props.tasks}>
        {(task) => <TaskItem task={task} />}
      </For>
    </scrollbox>
  );
}
