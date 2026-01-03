import { render, useKeyboard } from "@opentui/solid";
import { createSignal, onCleanup } from "solid-js";
import { Header } from "./components/header";
import { Log } from "./components/log";
import { Footer } from "./components/footer";
import { PausedOverlay } from "./components/paused";
import type { LoopState, LoopOptions, PersistedState, ToolEvent } from "./state";
import { colors } from "./components/colors";
import { calculateEta } from "./util/time";

type AppProps = {
  options: LoopOptions;
  persistedState: PersistedState;
  onQuit: () => void;
};

/**
 * Main App component with state signals.
 * Manages LoopState and elapsed time, rendering the full TUI layout.
 */
export function App(props: AppProps) {
  // State signal for loop state
  const [state, setState] = createSignal<LoopState>({
    status: "starting",
    iteration: props.persistedState.iterationTimes.length,
    tasksComplete: 0,
    totalTasks: 0,
    commits: 0,
    events: [],
  });

  // Track elapsed time from the persisted start time
  const [elapsed, setElapsed] = createSignal(
    Date.now() - props.persistedState.startTime
  );

  // Update elapsed time periodically
  const elapsedInterval = setInterval(() => {
    setElapsed(Date.now() - props.persistedState.startTime);
  }, 1000);

  onCleanup(() => {
    clearInterval(elapsedInterval);
  });

  // Calculate ETA based on iteration times and remaining tasks
  const eta = () => {
    const currentState = state();
    const remainingTasks = currentState.totalTasks - currentState.tasksComplete;
    return calculateEta(props.persistedState.iterationTimes, remainingTasks);
  };

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={colors.bgDark}
    >
      <Header
        status={state().status}
        iteration={state().iteration}
        tasksComplete={state().tasksComplete}
        totalTasks={state().totalTasks}
        eta={eta()}
      />
      <Log events={state().events} />
      <Footer
        commits={state().commits}
        elapsed={elapsed()}
        paused={state().status === "paused"}
      />
      <PausedOverlay visible={state().status === "paused"} />
    </box>
  );
}
