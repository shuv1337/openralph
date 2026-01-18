import { render, useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { createEffect, createMemo, createSignal, onCleanup, onMount, Setter, type Accessor } from "solid-js";
import { Header } from "./components/header";
import { Footer } from "./components/footer";
import { LeftPanel } from "./components/left-panel";
import { RightPanel } from "./components/right-panel";
import { ProgressDashboard } from "./components/progress-dashboard";
import { HelpOverlay } from "./components/help-overlay";
import { PausedOverlay } from "./components/paused";
import { SteeringOverlay } from "./components/steering";
import { DialogProvider, DialogStack, useDialog, useInputFocus } from "./context/DialogContext";
import { CommandProvider, useCommand, type CommandOption } from "./context/CommandContext";
import { ToastProvider, useToast } from "./context/ToastContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { ToastStack } from "./components/toast";
import { DialogSelect, type SelectOption } from "./ui/DialogSelect";
import { DialogAlert } from "./ui/DialogAlert";
import { DialogPrompt } from "./ui/DialogPrompt";
import { keymap, matchesKeybind } from "./lib/keymap";
import type { LoopState, LoopOptions, PersistedState } from "./state";
import { detectInstalledTerminals, launchTerminal, getAttachCommand as getAttachCmdFromTerminal, type KnownTerminal } from "./lib/terminal-launcher";
import { copyToClipboard, detectClipboardTool } from "./lib/clipboard";
import { loadConfig, setPreferredTerminal, getAllFallbackAgents, setFallbackAgent, removeFallbackAgent, updateConfig } from "./lib/config";

import { parsePlan, parsePlanTasks, type Task } from "./plan";
import { layout } from "./components/tui-theme";
import type { DetailsViewMode, UiTask } from "./components/tui-types";
import { isWindowsTerminal, isLegacyConsole } from "./lib/windows-console";
import { useKeyboardReliable } from "./hooks/useKeyboardReliable";


import { log } from "./lib/log";
import { addSteeringContext, createDebugSession } from "./loop";
import { createLoopState, type LoopStateStore } from "./hooks/useLoopState";
import { createLoopStats, type LoopStatsStore } from "./hooks/useLoopStats";

import { InterruptHandler } from "./lib/interrupt";

type AppProps = {
  options: LoopOptions;
  persistedState: PersistedState;
  onQuit: () => void;
  iterationTimesRef?: number[];
  onKeyboardEvent?: () => void; // Called when first keyboard event is received
  interruptHandler?: InterruptHandler;
};

/**
 * State setters returned from startApp to allow external state updates.
 */
export type AppStateSetters = {
  setState: Setter<LoopState>;
  updateIterationTimes: (times: number[]) => void;
  setSendMessage: (fn: ((message: string) => Promise<void>) | null) => void;
  /** Request a render update - call after session events or state changes */
  requestRender: () => void;
  /** Trigger immediate task list refresh (for real-time plan file updates) */
  triggerTaskRefresh: () => void;
};

/**
 * Result of starting the app - contains both the exit promise and state setters.
 */
export type StartAppResult = {
  exitPromise: Promise<void>;
  stateSetters: AppStateSetters;
};

// Module-level state setters that will be populated when App renders
let globalSetState: Setter<LoopState> | null = null;
let globalUpdateIterationTimes: ((times: number[]) => void) | null = null;
let globalSendMessage: ((message: string) => Promise<void>) | null = null;
let globalRenderer: ReturnType<typeof useRenderer> | null = null;
let globalTriggerTaskRefresh: (() => void) | null = null;
let rendererDestroyed = false;

export function destroyRenderer(): void {
  if (!globalRenderer || rendererDestroyed) {
    return;
  }
  rendererDestroyed = true;
  globalRenderer.setTerminalTitle("");
  globalRenderer.destroy();
}

/**
 * Main App component with state signals.
 * Manages LoopState and elapsed time, rendering the full TUI layout.
 */
/**
 * Props for starting the app, including optional keyboard detection callback.
 */

/**
 * Props for starting the app, including optional keyboard detection callback.
 */
export type StartAppProps = {
  options: LoopOptions;
  persistedState: PersistedState;
  onQuit: () => void;
  onKeyboardEvent?: () => void; // Called once when first keyboard event is received
  interruptHandler?: InterruptHandler;
};


/**
 * Starts the TUI application and returns a promise that resolves when the app exits,
 * along with state setters for external updates.
 *
 * @param props - The application props including options, persisted state, and quit handler
 * @returns Promise<StartAppResult> with exitPromise and stateSetters
 */
export async function startApp(props: StartAppProps): Promise<StartAppResult> {
  // Create a mutable reference to iteration times that can be updated externally
  let iterationTimesRef = [...props.persistedState.iterationTimes];
  
  // Create exit promise with resolver
  let exitResolve!: () => void;
  const exitPromise = new Promise<void>((resolve) => {
    exitResolve = resolve;
  });
  
  const onQuit = () => {
    log("app", "onQuit callback invoked");
    destroyRenderer();
    props.onQuit();
    exitResolve();
  };

  // Platform-specific render configuration
  const isWindowsPlatform = process.platform === "win32";
  
  // Await render to ensure CLI renderer is fully initialized
  await render(
    () => (
      <App
        options={props.options}
        persistedState={props.persistedState}
        onQuit={onQuit}
        iterationTimesRef={iterationTimesRef}
        onKeyboardEvent={props.onKeyboardEvent}
        interruptHandler={props.interruptHandler}
      />
    ),

    {
      // Lower FPS on Windows legacy consoles for better performance
      targetFps: isWindowsPlatform && !process.env.WT_SESSION ? 20 : 30,
      gatherStats: false, // Disable stats gathering for performance
      exitOnCtrlC: false,
      // Enable Kitty keyboard protocol for improved key event handling
      // Windows Terminal supports Kitty keyboard protocol since v1.18
      useKittyKeyboard: {},
      // Higher debounce delay on Windows to reduce rendering load
      debounceDelay: isWindowsPlatform ? 150 : 100,
    }
  );

  // State setters are set during App component body execution, so they're
  // available immediately after render() completes.
  if (!globalSetState || !globalUpdateIterationTimes) {
    throw new Error(
      "State setters not initialized after render. This indicates the App component did not execute."
    );
  }

  const stateSetters: AppStateSetters = {
    setState: globalSetState,
    updateIterationTimes: (times) => {
      iterationTimesRef.length = 0;
      iterationTimesRef.push(...times);
      // Guard against null - callback may be nullified during TUI cleanup
      // while loop iteration is still completing (race condition on quit)
      if (globalUpdateIterationTimes) {
        globalUpdateIterationTimes(times);
      }
    },
    setSendMessage: (fn) => {
      globalSendMessage = fn;
    },
    requestRender: () => {
      // Request a render from the global renderer if available
      globalRenderer?.requestRender?.();
    },
    triggerTaskRefresh: () => {
      // Trigger immediate task list refresh if available
      // Guard against null during TUI cleanup
      if (globalTriggerTaskRefresh) {
        globalTriggerTaskRefresh();
      }
    },
  };

  return { exitPromise, stateSetters };
}

export function App(props: AppProps) {
  // Get renderer for cleanup on quit
  const renderer = useRenderer();
  globalRenderer = renderer;
  rendererDestroyed = false;
  
  // Disable stdout interception to prevent OpenTUI from capturing stdout
  // which may interfere with logging and other output (matches OpenCode pattern).
  renderer.disableStdoutInterception();
  
  // Create loop state store using the hook architecture
  // This provides a reducer-based state management pattern with dispatch actions
  const initialAdapterMode = props.options.adapter && props.options.adapter !== "opencode-server" ? "pty" : "sdk";
  const loopStore = createLoopState({
    status: "starting",
    iteration: props.persistedState.iterationTimes.length + 1,
    tasksComplete: 0,
    totalTasks: 0,
    commits: 0,
    linesAdded: 0,
    linesRemoved: 0,
    events: [],
    isIdle: true,
    adapterMode: initialAdapterMode,
    terminalBuffer: "",
  });
  
  // Create loop stats store for tracking iteration timing and ETA
  const loopStats = createLoopStats();
  
  // Initialize loop stats with persisted state
  loopStats.initialize(
    props.persistedState.startTime,
    props.persistedState.iterationTimes
  );
  
  // State signal for loop state (legacy - being migrated to loopStore)
  // Initialize iteration to length + 1 since we're about to start the next iteration
  const [state, setState] = createSignal<LoopState>({
    status: "starting",
    iteration: props.persistedState.iterationTimes.length + 1,
    tasksComplete: 0,
    totalTasks: 0,
    commits: 0,
    linesAdded: 0,
    linesRemoved: 0,
    events: [],
    isIdle: true, // Starts idle, waiting for first LLM response
    adapterMode: initialAdapterMode,
    terminalBuffer: "",
  });

  const requestRender = () => {
    renderer.requestRender?.();
  };

  const setStateAndRender: Setter<LoopState> = (update) => {
    const result = setState(update);
    requestRender();
    return result;
  };

  // Steering mode state signals
  const [commandMode, setCommandMode] = createSignal(false);
  const [commandInput, setCommandInput] = createSignal("");

  // Tasks panel state signals
  const [showTasks, setShowTasks] = createSignal(true);
  const [tasks, setTasks] = createSignal<Task[]>([]);
  // Whether to show completed tasks in the task list (default: false for optimization)
  const [showCompletedTasks, setShowCompletedTasks] = createSignal(false);

  // Function to refresh tasks from plan file
  const refreshTasks = async () => {
    if (!props.options.planFile) {
      return;
    }

    const { done, total, error } = await parsePlan(props.options.planFile);
    const parsed = await parsePlanTasks(props.options.planFile);
    setTasks(parsed);

    setStateAndRender((prev) => {
      if (prev.tasksComplete === done && prev.totalTasks === total && prev.planError === error) {
        return prev;
      }
      return { ...prev, tasksComplete: done, totalTasks: total, planError: error };
    });

    const loopState = loopStore.state();
    if (loopState.tasksComplete !== done || loopState.totalTasks !== total) {
      loopStore.dispatch({ type: "SET_TASKS", complete: done, total });
    }
  };

  // Initialize tasks on mount and set up polling interval
  let tasksRefreshInterval: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    refreshTasks();
    // Poll for task updates every 2 seconds
    tasksRefreshInterval = setInterval(() => {
      refreshTasks();
    }, 2000);
    
    // Windows-specific: Force an initial render after a short delay
    // This helps ensure the TUI renders correctly on Windows Terminal
    if (process.platform === "win32") {
      setTimeout(() => {
        renderer.requestRender?.();
      }, 100);
    }
  });

  // Clean up tasks refresh interval on unmount
  onCleanup(() => {
    if (tasksRefreshInterval) {
      clearInterval(tasksRefreshInterval);
      tasksRefreshInterval = null;
    }
  });

  // Export wrapped state setter for external access. Calls requestRender()
  // after updates to ensure TUI refreshes on all platforms.
  globalSetState = (update) => setStateAndRender(update);
  // Update iteration times in loopStats (used for ETA calculation)
  globalUpdateIterationTimes = (times: number[]) => {
    // Re-initialize loopStats with the updated iteration times
    // This keeps the hook-based stats in sync with external updates
    loopStats.initialize(props.persistedState.startTime, times);
  };
  // Export refreshTasks for real-time plan file updates
  globalTriggerTaskRefresh = refreshTasks;

  // Update elapsed time and ETA periodically (5000ms to reduce render frequency)
  // Uses loopStats hook for pause-aware elapsed time tracking
  const elapsedInterval = setInterval(() => {
    const currentState = state();
    const status = currentState.status;
    // Only tick when actively running (not paused, ready, or idle)
    if (!currentState.isIdle && status !== "paused" && status !== "ready") {
      // Tick loopStats for pause-aware elapsed time (hook-based approach)
      loopStats.tick();
      // Update remaining tasks for ETA calculation
      const remainingTasks = currentState.totalTasks - currentState.tasksComplete;
      loopStats.setRemainingTasks(remainingTasks);
    }
  }, 5000);

  onCleanup(() => {
    clearInterval(elapsedInterval);
    destroyRenderer();
    // Clean up module-level references
    globalSetState = null;
    globalUpdateIterationTimes = null;
    globalTriggerTaskRefresh = null;
    globalRenderer = null;
  });

  // Pause file path
  const PAUSE_FILE = ".ralph-pause";

  // Toggle pause by creating/deleting .ralph-pause file
  const togglePause = async () => {
    const file = Bun.file(PAUSE_FILE);
    const exists = await file.exists();
    if (exists) {
      // Resume: delete pause file and update status via dispatch
      await Bun.write(PAUSE_FILE, ""); // Ensure file exists before unlinking
      const fs = await import("node:fs/promises");
      await fs.unlink(PAUSE_FILE);
      // Use dispatch as primary state update mechanism
      loopStore.dispatch({ type: "RESUME" });
      loopStats.resume();
      // Also update legacy state for external compatibility
      setStateAndRender((prev) => ({ ...prev, status: "running" }));
    } else {
      // Pause: create pause file and update status via dispatch
      await Bun.write(PAUSE_FILE, String(process.pid));
      // Use dispatch as primary state update mechanism
      loopStore.dispatch({ type: "PAUSE" });
      loopStats.pause();
      // Also update legacy state for external compatibility
      setStateAndRender((prev) => ({ ...prev, status: "paused" }));
    }
  };

  // Track if we've notified about keyboard events working (only notify once)
  const [keyboardEventNotified, setKeyboardEventNotified] = createSignal(false);

  /**
   * Show the command palette dialog.
   * Converts registered commands to SelectOptions for the dialog.
   */
  const showCommandPalette = () => {
    // This function will be passed to CommandProvider's onShowPalette callback
    // The actual implementation uses the dialog context inside AppContent
  };

  return (
    <ThemeProvider>
      <ToastProvider>
        <DialogProvider>
          <CommandProvider onShowPalette={showCommandPalette}>
              <AppContent
                state={state}
                setState={setStateAndRender}
                options={props.options}
              commandMode={commandMode}
              setCommandMode={setCommandMode}
              setCommandInput={setCommandInput}
              togglePause={togglePause}
              renderer={renderer}
              onQuit={props.onQuit}
              onKeyboardEvent={props.onKeyboardEvent}
              keyboardEventNotified={keyboardEventNotified}
              setKeyboardEventNotified={setKeyboardEventNotified}
              showTasks={showTasks}
              setShowTasks={setShowTasks}
              tasks={tasks}
              showCompletedTasks={showCompletedTasks}
              setShowCompletedTasks={setShowCompletedTasks}
              loopStore={loopStore}
              loopStats={loopStats}
              interruptHandler={props.interruptHandler}
            />
          </CommandProvider>

        </DialogProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

/**
 * Props for the inner AppContent component.
 */
type AppContentProps = {
  state: () => LoopState;
  setState: Setter<LoopState>;
  options: LoopOptions;
  commandMode: () => boolean;
  setCommandMode: (v: boolean) => void;
  setCommandInput: (v: string) => void;
  togglePause: () => Promise<void>;
  renderer: ReturnType<typeof useRenderer>;
  onQuit: () => void;
  onKeyboardEvent?: () => void;
  keyboardEventNotified: Accessor<boolean>;
  setKeyboardEventNotified: Setter<boolean>;
  showTasks: () => boolean;
  setShowTasks: (v: boolean) => void;
  tasks: () => Task[];
  showCompletedTasks: () => boolean;
  setShowCompletedTasks: (v: boolean) => void;
  // Hook-based state stores (for gradual migration)
  loopStore: LoopStateStore;
  loopStats: LoopStatsStore;
  interruptHandler?: InterruptHandler;
};


import { DialogConfirm } from "./ui/DialogConfirm";

/**
 * Inner component that uses context hooks for dialogs and commands.

 * Separated from App to be inside the context providers.
 */
function AppContent(props: AppContentProps) {
  const dialog = useDialog();
  const command = useCommand();
  const toast = useToast();
  const theme = useTheme();
  const { isInputFocused: dialogInputFocused } = useInputFocus();

  // Track shown milestones to avoid duplicate toasts
  const shownMilestones = new Set<number>();

  // Milestone celebration toasts at 25%, 50%, 75%, 100%
  createEffect(() => {
    const complete = props.state().tasksComplete;
    const total = props.state().totalTasks;
    if (total === 0) return;
    
    const pct = Math.floor((complete / total) * 100);
    const milestones = [25, 50, 75, 100];
    
    for (const milestone of milestones) {
      if (pct >= milestone && !shownMilestones.has(milestone)) {
        shownMilestones.add(milestone);
        toast.show({
          variant: "success",
          message: `🎉 ${milestone}% complete!`,
        });
        break; // Only show one toast at a time
      }
    }
  });

  // Get theme colors reactively - call theme.theme() to access the resolved theme
  const t = () => theme.theme();

  // Combined check for any input being focused
  const isInputFocused = () => props.commandMode() || dialogInputFocused();

  const terminalDimensions = useTerminalDimensions();
  
  // Windows-specific: Poll for terminal resize since SIGWINCH may not work reliably
  // This supplements the native resize event handling
  // IMPORTANT: Uses createEffect instead of onMount for reliable Windows initialization
  const isWindows = process.platform === "win32";
  let lastKnownWidth = 0;
  let lastKnownHeight = 0;
  let resizePollInterval: ReturnType<typeof setInterval> | null = null;
  
  // Use createEffect for immediate initialization (onMount is unreliable on Windows)
  createEffect(() => {
    if (!isWindows || resizePollInterval) return;
    
    // Initialize with current dimensions
    lastKnownWidth = process.stdout.columns || 80;
    lastKnownHeight = process.stdout.rows || 24;
    
    // Listen for native stdout resize event (works on Windows Terminal)
    const handleStdoutResize = () => {
      const currentWidth = process.stdout.columns || 80;
      const currentHeight = process.stdout.rows || 24;
      
      if (currentWidth !== lastKnownWidth || currentHeight !== lastKnownHeight) {
        lastKnownWidth = currentWidth;
        lastKnownHeight = currentHeight;
        log("app", "Windows resize detected via stdout event", { width: currentWidth, height: currentHeight });
        
        // Emit SIGWINCH to trigger OpenTUI's internal resize handler
        process.emit("SIGWINCH" as never);
        
        // Also request a render after a short delay to ensure layout updates
        setTimeout(() => props.renderer.requestRender?.(), 50);
      }
    };
    
    // Add stdout resize listener (primary mechanism for Windows Terminal)
    if (process.stdout.isTTY) {
      process.stdout.on("resize", handleStdoutResize);
    }
    
    // Poll for resize changes every 500ms as fallback for legacy consoles
    // PowerShell may not fire stdout resize events in all cases
    resizePollInterval = setInterval(() => {
      const currentWidth = process.stdout.columns || 80;
      const currentHeight = process.stdout.rows || 24;
      
      if (currentWidth !== lastKnownWidth || currentHeight !== lastKnownHeight) {
        lastKnownWidth = currentWidth;
        lastKnownHeight = currentHeight;
        log("app", "Windows resize detected via polling", { width: currentWidth, height: currentHeight });
        
        // Emit SIGWINCH to trigger OpenTUI's internal resize handler
        // This ensures the renderer properly recalculates layout
        process.emit("SIGWINCH" as never);
        
        // Request render after a short delay
        setTimeout(() => props.renderer.requestRender?.(), 50);
      }
    }, 500);
  });
  
  onCleanup(() => {
    if (resizePollInterval) {
      clearInterval(resizePollInterval);
      resizePollInterval = null;
    }
    // Note: We can't easily remove the stdout resize listener here
    // because the function reference isn't stored, but it will be
    // cleaned up when the process exits
  });
  
  const [selectedTaskIndex, setSelectedTaskIndex] = createSignal(0);
  const [detailsViewMode, setDetailsViewMode] = createSignal<DetailsViewMode>("output");
  const [showHelp, setShowHelp] = createSignal(false);
  const [showDashboard, setShowDashboard] = createSignal(false);
  
  // UI preference signals - initialized from persistent config
  const initialConfig = loadConfig();
  const [compactMode, setCompactMode] = createSignal(initialConfig.ui.compactMode);


  // All tasks converted to UiTask format
  const allUiTasks = createMemo<UiTask[]>(() =>
    props.tasks().map((task) => ({
      id: task.id,
      title: task.text,
      status: task.done ? "done" : "actionable",
      line: task.line,
      priority: task.priority,
      category: task.category,
    }))
  );


  // Filtered tasks based on showCompletedTasks setting (default: hide completed for optimization)
  const uiTasks = createMemo<UiTask[]>(() => {
    const all = allUiTasks();
    if (props.showCompletedTasks()) {
      return all;
    }
    return all.filter((task) => task.status !== "done");
  });

  const selectedTask = createMemo(() => {
    const list = uiTasks();
    if (list.length === 0) return null;
    return list[Math.min(selectedTaskIndex(), list.length - 1)];
  });

  const currentTask = createMemo(() => {
    const list = uiTasks();
    if (list.length === 0) return null;
    return list.find((task) => task.status !== "done") ?? list[0];
  });

  createEffect(() => {
    const list = uiTasks();
    if (list.length === 0) {
      setSelectedTaskIndex(0);
      return;
    }
    if (selectedTaskIndex() >= list.length) {
      setSelectedTaskIndex(list.length - 1);
    }
  });

  createEffect(() => {
    if (props.state().adapterMode === "pty" && detailsViewMode() === "details") {
      setDetailsViewMode("output");
    }
  });

  const isCompact = createMemo(() => terminalDimensions().width < 80);

  // Set up interrupt handler callbacks
  createEffect(() => {
    const ih = props.interruptHandler;
    if (!ih) return;

    ih.setOptions({
      onShowDialog: () => {
        dialog.show(() => (
          <DialogConfirm
            title="Quit Ralph?"
            message="Are you sure you want to stop the automation loop?"
            onConfirm={() => ih.confirm()}
            onCancel={() => ih.cancel()}
          />
        ));
      },
      onHideDialog: () => {
        // Dialog system handles hiding via pop() in onConfirm/onCancel
      },
      onConfirmed: async () => {
        props.onQuit();
      }
    });
  });

  const dashboardHeight = createMemo(() => (showDashboard() ? layout.progressDashboard.height : 0));

  const contentHeight = createMemo(() =>
    Math.max(
      1,
      terminalDimensions().height - layout.header.height - layout.footer.height - dashboardHeight()
    )
  );
  const leftPanelWidth = createMemo(() => {
    if (isCompact()) return terminalDimensions().width;
    const desired = Math.floor(
      (terminalDimensions().width * layout.leftPanel.defaultWidthPercent) / 100
    );
    return Math.min(layout.leftPanel.maxWidth, Math.max(layout.leftPanel.minWidth, desired));
  });
  const rightPanelWidth = createMemo(() => {
    if (isCompact()) return terminalDimensions().width;
    return props.showTasks()
      ? terminalDimensions().width - leftPanelWidth()
      : terminalDimensions().width;
  });
  const rightPanelRows = createMemo(() => {
    const baseHeight = contentHeight();
    const paneHeight = isCompact() && props.showTasks() ? Math.floor(baseHeight / 2) : baseHeight;
    return Math.max(4, paneHeight - 2);
  });
  const rightPanelCols = createMemo(() => Math.max(20, rightPanelWidth() - 2));

  /**
   * Get the attach command string for the current session.
   * Returns null if no session is active.
   */
  const getAttachCommand = (): string | null => {
    const currentState = props.state();
    if (currentState.adapterMode === "pty") return null;
    if (!currentState.sessionId) return null;
    
    const serverUrl = currentState.serverUrl || "http://localhost:10101";
    return `opencode attach ${serverUrl} --session ${currentState.sessionId}`;
  };

  /**
   * Show a dialog with the attach command for manual copying.
   * Used as fallback when clipboard is not available.
   */
  const showAttachCommandDialog = () => {
    const attachCmd = getAttachCommand();
    if (!attachCmd) {
      dialog.show(() => (
        <DialogAlert
          title="No Active Session"
          message="There is no active session to attach to."
          variant="warning"
        />
      ));
      return;
    }

    dialog.show(() => (
      <DialogAlert
        title="Attach Command"
        message={`Copy this command manually:\n\n${attachCmd}`}
        variant="info"
      />
    ));
  };

  /**
   * Copy the attach command to clipboard.
   * Falls back to showing a dialog if clipboard is unavailable.
   */
  const copyAttachCommand = async () => {
    const attachCmd = getAttachCommand();
    if (!attachCmd) {
      toast.show({
        variant: "warning",
        message: "No active session to copy attach command",
      });
      return;
    }

    // Check if clipboard tool is available
    const clipboardTool = await detectClipboardTool();
    if (!clipboardTool) {
      // No clipboard tool available - show dialog as fallback
      log("app", "No clipboard tool available, showing dialog fallback");
      showAttachCommandDialog();
      return;
    }

    // Attempt to copy to clipboard
    const result = await copyToClipboard(attachCmd);
    if (result.success) {
      toast.show({
        variant: "success",
        message: "Copied to clipboard",
      });
      log("app", "Attach command copied to clipboard");
    } else {
      toast.show({
        variant: "error",
        message: `Failed to copy: ${result.error || "Unknown error"}`,
      });
      log("app", "Failed to copy to clipboard", { error: result.error });
      // Fall back to dialog on error
      showAttachCommandDialog();
    }
  };

  // Register default commands on mount
  onMount(() => {
    // Register "Start/Pause/Resume" command
    command.register("togglePause", () => {
      const status = props.state().status;
      const title = status === "ready" ? "Start" : status === "paused" ? "Resume" : "Pause";
      const description = status === "ready" 
        ? "Start the automation loop"
        : status === "paused" 
          ? "Resume the automation loop" 
          : "Pause the automation loop";
      return [
        {
          title,
          value: "togglePause",
          description,
          keybind: keymap.togglePause.label,
          onSelect: () => {
            props.togglePause();
          },
        },
      ];
    });

    // Register "Copy attach command" action
    command.register("copyAttach", () => [
        {
          title: "Copy attach command",
          value: "copyAttach",
          description: "Copy attach command to clipboard",
          disabled: !props.state().sessionId || props.state().adapterMode === "pty",
          onSelect: () => {
            copyAttachCommand();
          },
        },
    ]);

    // Register "Choose default terminal" action
    command.register("terminalConfig", () => [
      {
        title: "Choose default terminal",
        value: "terminalConfig",
        description: "Select terminal for launching attach sessions",
        keybind: keymap.terminalConfig.label,
        onSelect: () => {
          showTerminalConfigDialog();
        },
      },
    ]);

    // Register "Toggle tasks panel" action
    command.register("toggleTasks", () => [
      {
        title: props.showTasks() ? "Hide task list" : "Show task list",
        value: "toggleTasks",
        description: "Show/hide the task list from the plan file",
        keybind: keymap.toggleTasks.label,
        onSelect: () => {
          log("app", "Tasks panel toggled via command palette");
          props.setShowTasks(!props.showTasks());
        },
      },
    ]);

    // Register "Toggle completed tasks" action
    command.register("toggleCompletedTasks", () => [
      {
        title: props.showCompletedTasks() ? "Hide completed tasks" : "Show completed tasks",
        value: "toggleCompletedTasks",
        description: "Show/hide completed tasks in the task list",
        onSelect: () => {
          log("app", "Completed tasks toggled via command palette", { showCompleted: !props.showCompletedTasks() });
          props.setShowCompletedTasks(!props.showCompletedTasks());
        },
      },
    ]);

    // Register "Switch theme" command
    command.register("switchTheme", () => [
      {
        title: "Switch theme",
        value: "switchTheme",
        description: `Change UI color theme (current: ${theme.themeName()})`,
        onSelect: () => {
          // Defer to next tick so command palette's pop() completes first
          queueMicrotask(() => showThemeDialog());
        },
      },
    ]);

    // Register "Toggle compact mode" command
    command.register("toggleCompactMode", () => [
      {
        title: compactMode() ? "Disable compact mode" : "Enable compact mode",
        value: "toggleCompactMode",
        description: "Switch between single-line and multi-line task layout",
        onSelect: () => {
          const newValue = !compactMode();
          setCompactMode(newValue);
          // Persist preference to config file
          try {
            const current = loadConfig();
            updateConfig({ ui: { ...current.ui, compactMode: newValue } });
            log("app", "Compact mode toggled", { compactMode: newValue });
            toast.show({
              variant: "info",
              message: newValue ? "Compact mode enabled (single-line)" : "Dense mode enabled (multi-line)",
            });
          } catch (err) {
            log("app", "Failed to persist compactMode config", { error: String(err) });
          }
        },
      },
    ]);

    // Register "Configure fallback agents" command
    command.register("fallbackAgents", () => [
      {
        title: "Configure fallback agents",
        value: "fallbackAgents",
        description: "Set fallback models for rate limit handling",
        onSelect: () => {
          queueMicrotask(() => showFallbackAgentDialog());
        },
      },
    ]);
  });

  /**
   * Show terminal configuration dialog.
   * Lists detected terminals and allows user to select one.
   */
  const showTerminalConfigDialog = async () => {
    // Detect installed terminals
    const terminals = await detectInstalledTerminals();

    if (terminals.length === 0) {
      dialog.show(() => (
        <DialogAlert
          title="No Terminals Found"
          message="No supported terminal emulators were detected on your system."
          variant="warning"
        />
      ));
      return;
    }

    // Convert terminals to SelectOption format
    const options: SelectOption[] = terminals.map((terminal: KnownTerminal) => ({
      title: terminal.name,
      value: terminal.command,
      description: `Command: ${terminal.command}`,
    }));

    dialog.show(() => (
      <DialogSelect
        title="Choose Default Terminal"
        placeholder="Type to search terminals..."
        options={options}
        onSelect={(opt) => {
          const selected = terminals.find((t: KnownTerminal) => t.command === opt.value);
          if (selected) {
            // Save to config
            setPreferredTerminal(selected.name);
            log("app", "Terminal preference saved", { terminal: selected.name });
            dialog.show(() => (
              <DialogAlert
                title="Terminal Selected"
                message={`Selected: ${selected.name}\n\nThis will be used when pressing 'T' to open a new terminal.`}
                variant="info"
              />
            ));
          }
        }}
        onCancel={() => {}}
        borderColor={t().secondary}
      />
    ));
  };

  /**
   * Show theme selection dialog.
   * Lists all available themes and allows user to switch.
   */
  const showThemeDialog = () => {
    const options: SelectOption[] = theme.themeNames.map((name) => ({
      title: name,
      value: name,
      description: name === theme.themeName() ? "(current)" : undefined,
    }));

    dialog.show(() => (
      <DialogSelect
        title="Switch Theme"
        placeholder="Type to search themes..."
        options={options}
        onSelect={(opt) => {
          theme.setThemeName(opt.value);
          log("app", "Theme changed", { theme: opt.value });
          toast.show({
            variant: "success",
            message: `Theme changed to ${opt.value}`,
          });
          // Force re-render after state updates propagate
          queueMicrotask(() => props.renderer.requestRender?.());
        }}
        onCancel={() => {}}
        borderColor={t().accent}
      />
    ));
    props.renderer.requestRender?.();
  };

  /**
   * Show fallback agent configuration dialog.
   * Allows users to add, view, or remove fallback agent mappings for rate limit handling.
   */
  const showFallbackAgentDialog = () => {
    const currentMappings = getAllFallbackAgents();
    const mappingEntries = Object.entries(currentMappings);

    // Build options list: existing mappings + "Add new" option
    const options: SelectOption[] = [
      {
        title: "➕ Add new fallback mapping",
        value: "__add_new__",
        description: "Configure a new primary → fallback agent mapping",
      },
      ...mappingEntries.map(([primary, fallback]) => ({
        title: `${primary} → ${fallback}`,
        value: primary,
        description: "Select to remove this mapping",
      })),
    ];

    if (mappingEntries.length === 0) {
      options.push({
        title: "(No fallback agents configured)",
        value: "__none__",
        description: "Add mappings to enable automatic fallback on rate limits",
        disabled: true,
      });
    }

    dialog.show(() => (
      <DialogSelect
        title="Configure Fallback Agents"
        placeholder="Select to add or remove mappings..."
        options={options}
        onSelect={(opt) => {
          if (opt.value === "__add_new__") {
            // Show prompt for primary agent
            queueMicrotask(() => showAddFallbackDialog());
          } else if (opt.value !== "__none__") {
            // Confirm removal
            const fallback = currentMappings[opt.value];
            dialog.show(() => (
              <DialogAlert
                title="Remove Fallback Mapping?"
                message={`Remove mapping:\n${opt.value} → ${fallback}\n\nThis agent will no longer have an automatic fallback.`}
                variant="warning"
                onDismiss={() => {
                  removeFallbackAgent(opt.value);
                  log("app", "Fallback agent removed", { primary: opt.value });
                  toast.show({
                    variant: "success",
                    message: `Removed fallback for ${opt.value}`,
                  });
                }}
              />
            ));
          }
        }}
        onCancel={() => {}}
        borderColor={t().info}
      />
    ));
  };

  /**
   * Show dialog to add a new fallback agent mapping.
   */
  const showAddFallbackDialog = () => {
    dialog.show(() => (
      <DialogPrompt
        title="Enter primary agent/model name (e.g., claude-opus-4):"
        placeholder="claude-opus-4"
        onSubmit={(primaryAgent) => {
          if (!primaryAgent.trim()) {
            toast.show({ variant: "error", message: "Primary agent name required" });
            return;
          }
          // Now prompt for fallback agent
          queueMicrotask(() => {
            dialog.show(() => (
              <DialogPrompt
                title={`Enter fallback agent for "${primaryAgent}":`}
                placeholder="claude-sonnet-4-20250501"
                onSubmit={(fallbackAgent) => {
                  if (!fallbackAgent.trim()) {
                    toast.show({ variant: "error", message: "Fallback agent name required" });
                    return;
                  }
                  setFallbackAgent(primaryAgent.trim(), fallbackAgent.trim());
                  log("app", "Fallback agent added", { primary: primaryAgent, fallback: fallbackAgent });
                  toast.show({
                    variant: "success",
                    message: `Added: ${primaryAgent} → ${fallbackAgent}`,
                  });
                }}
                onCancel={() => {}}
              />
            ));
          });
        }}
        onCancel={() => {}}
      />
    ));
  };

  /**
   * Handle N key press in debug mode: create a new session.
   * Only available in debug mode. Creates a session and stores it in state.
   */
  const handleDebugNewSession = async () => {
    // Only available in debug mode
    if (!props.options.debug) {
      return;
    }

    // Check if session already exists
    const currentState = props.state();
    const existingSessionId = currentState.sessionId;
    if (existingSessionId) {
      dialog.show(() => (
        <DialogAlert
          title="Session Exists"
          message={`A session is already active (${existingSessionId.slice(0, 8)}...).\n\nUse ':' to send messages to the existing session.`}
          variant="info"
        />
      ));
      return;
    }

    log("app", "Debug mode: creating new session via N key");

    try {
      const session = await createDebugSession({
        serverUrl: props.options.serverUrl,
        serverTimeoutMs: props.options.serverTimeoutMs,
        model: props.options.model,
        agent: props.options.agent,
      });

      // Update state via dispatch as primary mechanism
      props.loopStore.dispatch({
        type: "SET_SESSION",
        sessionId: session.sessionId,
        serverUrl: session.serverUrl,
        attached: session.attached,
      });
      props.loopStore.dispatch({ type: "SET_IDLE", isIdle: true });
      
      // Also update legacy state for external compatibility
      props.setState((prev) => ({
        ...prev,
        sessionId: session.sessionId,
        serverUrl: session.serverUrl,
        attached: session.attached,
        status: "ready", // Ready for input
      }));

      // Store sendMessage function for steering mode
      globalSendMessage = session.sendMessage;

      log("app", "Debug mode: session created successfully", { 
        sessionId: session.sessionId 
      });

      dialog.show(() => (
        <DialogAlert
          title="Session Created"
          message={`Session ID: ${session.sessionId.slice(0, 8)}...\n\nUse ':' to send messages to the session.`}
          variant="info"
        />
      ));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log("app", "Debug mode: failed to create session", { error: errorMsg });
      
      dialog.show(() => (
        <DialogAlert
          title="Session Creation Failed"
          message={`Failed to create session:\n\n${errorMsg}`}
          variant="error"
        />
      ));
    }
  };

  /**
   * Handle P key press in debug mode: open prompt dialog for manual input.
   * Only available in debug mode with an active session.
   */
  const handleDebugPromptInput = () => {
    // Only available in debug mode
    if (!props.options.debug) {
      return;
    }

    // Check for active session
    const currentState = props.state();
    if (!currentState.sessionId) {
      dialog.show(() => (
        <DialogAlert
          title="No Active Session"
          message="Create a session first by pressing 'N'."
          variant="warning"
        />
      ));
      return;
    }

    log("app", "Debug mode: opening prompt dialog via P key");

    dialog.show(() => (
      <DialogPrompt
        title="Send Prompt"
        placeholder="Enter your message..."
        onSubmit={async (value) => {
          if (!value.trim()) {
            return;
          }
          
          if (globalSendMessage) {
            log("app", "Debug mode: sending prompt", { message: value.slice(0, 50) });
            try {
              await globalSendMessage(value);
              // Update status via dispatch as primary mechanism
              props.loopStore.dispatch({ type: "START" });
              props.loopStore.dispatch({ type: "SET_IDLE", isIdle: false });
              // Also update legacy state for external compatibility
              props.setState((prev) => ({
                ...prev,
                status: "running",
                isIdle: false,
              }));
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              log("app", "Debug mode: failed to send prompt", { error: errorMsg });
              dialog.show(() => (
                <DialogAlert
                  title="Send Failed"
                  message={`Failed to send prompt:\n\n${errorMsg}`}
                  variant="error"
                />
              ));
            }
          } else {
            log("app", "Debug mode: no sendMessage function available");
            dialog.show(() => (
              <DialogAlert
                title="Session Not Ready"
                message="The session is not ready to receive messages yet."
                variant="warning"
              />
            ));
          }
        }}
        onCancel={() => {
          log("app", "Debug mode: prompt dialog cancelled");
        }}
        borderColor={t().accent}
      />
    ));
  };

  /**
   * Handle T key press: launch terminal with attach command or show config dialog.
   * Requires an active session. Uses preferred terminal if configured.
   */
  const handleTerminalLaunch = async () => {
    const currentState = props.state();

    if (currentState.adapterMode === "pty") {
      dialog.show(() => (
        <DialogAlert
          title="Attach Not Available"
          message="Attach commands are only available for OpenCode server sessions."
          variant="warning"
        />
      ));
      return;
    }
    
    // Check for active session
    if (!currentState.sessionId) {
      dialog.show(() => (
        <DialogAlert
          title="No Active Session"
          message="Cannot launch terminal: No active session to attach to."
          variant="warning"
        />
      ));
      return;
    }

    // Load config to check for preferred terminal
    const config = loadConfig();
    
    if (!config.preferredTerminal) {
      // No configured terminal: show config dialog
      log("app", "No preferred terminal configured, showing dialog");
      await showTerminalConfigDialog();
      return;
    }

    // Find the preferred terminal in detected terminals
    const terminals = await detectInstalledTerminals();
    const preferredTerminal = terminals.find(
      (t: KnownTerminal) => t.name === config.preferredTerminal
    );

    if (!preferredTerminal) {
      // Preferred terminal not found/installed
      log("app", "Preferred terminal not found", { preferred: config.preferredTerminal });
      dialog.show(() => (
        <DialogAlert
          title="Terminal Not Found"
          message={`Preferred terminal "${config.preferredTerminal}" is not available.\n\nPlease select a different terminal.`}
          variant="warning"
        />
      ));
      await showTerminalConfigDialog();
      return;
    }

    // Build attach command using server URL from state (supports external/attached mode)
    const serverUrl = currentState.serverUrl || "http://localhost:10101";
    const attachCmd = getAttachCmdFromTerminal(serverUrl, currentState.sessionId);

    log("app", "Launching terminal", { 
      terminal: preferredTerminal.name, 
      serverUrl,
      sessionId: currentState.sessionId,
    });

    // Launch the terminal
    const result = await launchTerminal(preferredTerminal, attachCmd);

    if (!result.success) {
      dialog.show(() => (
        <DialogAlert
          title="Launch Failed"
          message={`Failed to launch ${preferredTerminal.name}:\n\n${result.error}`}
          variant="error"
        />
      ));
    }
  };

  /**
   * Detect if the `:` (colon) key was pressed.
   * Handles multiple keyboard configurations:
   * - Direct `:` character (Kitty protocol or non-US keyboards)
   * - Shift+`;` (US keyboard layout via raw mode)
   * - Semicolon with shift modifier
   */
  const isColonKey = (e: KeyEvent): boolean => {
    // Direct colon character (most common case with Kitty protocol)
    if (e.name === ":") return true;
    // Raw character is colon
    if (e.raw === ":") return true;
    // Shift+semicolon on US keyboard layout
    if (e.name === ";" && e.shift) return true;
    return false;
  };

  /**
   * Show the command palette dialog with all registered commands.
   */
  const showCommandPalette = () => {
    if (dialog.hasDialogs()) {
      return;
    }

    const commands = command.getCommands();
    const options = commands.map((cmd): CommandOption & { onSelect: () => void } => ({
      title: cmd.title,
      value: cmd.value,
      description: cmd.description,
      keybind: cmd.keybind,
      disabled: cmd.disabled,
      onSelect: cmd.onSelect,
    }));

    dialog.show(() => (
      <DialogSelect
        title="Command Palette"
        placeholder="Type to search commands..."
        options={options}
        onSelect={(opt) => {
          // Find and execute the command
          const cmd = commands.find(c => c.value === opt.value);
          cmd?.onSelect();
        }}
        onCancel={() => {}}
        borderColor={t().accent}
      />
    ));
    props.renderer.requestRender?.();
  };

  // Keyboard handling - now inside context providers
  // Use reliable keyboard hook that works on Windows (avoids onMount issues)
  useKeyboardReliable((e: KeyEvent) => {
    // Log every key event on Windows for debugging (after first event)
    if (process.platform === "win32" && props.keyboardEventNotified()) {
      log("keyboard", "AppContent key event", {
        key: e.name,
        isInputFocused: isInputFocused(),
        dialogStack: dialog.stack().length,
      });
    }
    
    // Notify caller that OpenTUI keyboard handling is working
    // Also log the first key event for diagnostic purposes (Phase 1.1)
    if (!props.keyboardEventNotified() && props.onKeyboardEvent) {
      props.setKeyboardEventNotified(true);
      props.onKeyboardEvent();
      // Log first key event to diagnose keyboard issues
      log("keyboard", "First OpenTUI key event received", {
        key: e.name,
        ctrl: e.ctrl,
        shift: e.shift,
        meta: e.meta,
        raw: e.raw,
        isInputFocused: isInputFocused(),
        commandMode: props.commandMode(),
        dialogInputFocused: dialogInputFocused(),
      });
    }

    const key = e.name.toLowerCase();

    // SAFETY VALVE: Ctrl+C triggers interruption handler
    if (key === "c" && e.ctrl) {
      log("app", "Interruption requested via Ctrl+C");
      if (props.interruptHandler) {
        // Manually trigger SIGINT handling logic
        // @ts-ignore - accessing private method for internal coordination
        props.interruptHandler.handleSigint();
      } else {
        props.onQuit();
      }
      return;
    }


    // Skip if any input is focused (dialogs, steering mode, etc.)
    if (isInputFocused()) {
      log("keyboard", "AppContent: skipping due to isInputFocused", {
        commandMode: props.commandMode(),
        dialogInputFocused: dialogInputFocused(),
      });
      return;
    }

    if (showHelp()) {
      if (key === "escape" || key === "?") {
        setShowHelp(false);
      }
      return;
    }

    if (key === "?" || (e.name === "/" && e.shift)) {
      setShowHelp(!showHelp());
      return;
    }

    if (key === "d" && !e.ctrl && !e.meta && !e.shift) {
      setShowDashboard(!showDashboard());
      return;
    }

    if (key === "o" && !e.ctrl && !e.meta) {
      setDetailsViewMode((mode) => {
        if (mode === "details") return "output";
        if (mode === "output") return "prompt";
        return "details";
      });
      return;
    }


    // ESC key: close tasks panel if open
    if (key === "escape" && props.showTasks()) {
      log("app", "Tasks panel closed via ESC");
      props.setShowTasks(false);
      return;
    }

    if (props.showTasks() && (key === "up" || key === "k")) {
      if (selectedTaskIndex() > 0) {
        setSelectedTaskIndex(selectedTaskIndex() - 1);
      }
      return;
    }

    if (props.showTasks() && (key === "down" || key === "j")) {
      if (selectedTaskIndex() < uiTasks().length - 1) {
        setSelectedTaskIndex(selectedTaskIndex() + 1);
      }
      return;
    }

    if (props.showTasks() && (key === "pageup")) {
      setSelectedTaskIndex((prev) => Math.max(0, prev - 10));
      return;
    }

    if (props.showTasks() && (key === "pagedown")) {
      setSelectedTaskIndex((prev) => Math.min(uiTasks().length - 1, prev + 10));
      return;
    }

    // c: open command palette
    if (matchesKeybind(e, keymap.commandPalette)) {
      log("app", "Command palette opened via 'c' key");
      showCommandPalette();
      return;
    }

    // : key: open steering mode (requires active session)
    if (isColonKey(e) && !e.ctrl && !e.meta) {
      const currentState = props.state();
      // Only allow steering when there's an active session
      if (currentState.sessionId || currentState.adapterMode === "pty") {
        log("app", "Steering mode opened via ':' key");
        props.setCommandMode(true);
        props.setCommandInput("");
      }
      return;
    }

    // p key: toggle pause OR prompt input (debug mode)
    // Phase 2.2: Use matchesKeybind for consistent key routing
    if (matchesKeybind(e, keymap.togglePause)) {
      if (props.options.debug) {
        // In debug mode, p opens prompt input dialog
        handleDebugPromptInput();
        return;
      }
      // In normal mode, p toggles pause
      props.togglePause();
      return;
    }

    // t key: launch terminal with attach command (only when no modifiers)
    if (matchesKeybind(e, keymap.terminalConfig)) {
      handleTerminalLaunch();
      return;
    }

    // Shift+T: toggle tasks panel
    if (matchesKeybind(e, keymap.toggleTasks)) {
      log("app", "Tasks panel toggled via Shift+T");
      props.setShowTasks(!props.showTasks());
      return;
    }

    // n key: create new session (debug mode only)
    if (key === "n" && !e.ctrl && !e.meta && !e.shift) {
      if (props.options.debug) {
        handleDebugNewSession();
        return;
      }
    }

    // q key: quit (triggers interruption handler)
    // Phase 2.2: Use matchesKeybind for consistent key routing
    if (matchesKeybind(e, keymap.quit)) {
      log("app", "Quit requested via 'q' key");
      if (props.interruptHandler) {
        // @ts-ignore - accessing private method for internal coordination
        props.interruptHandler.handleSigint();
      } else {
        props.onQuit();
      }
      return;
    }


    // Note: Ctrl+C is handled above as a safety valve (before isInputFocused check)
  }, { debugLabel: "AppContent" });

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={t().background}
    >
        <Header
          status={props.state().status}
          iteration={props.state().iteration}
          tasksComplete={props.state().tasksComplete}
          totalTasks={props.state().totalTasks}
          planError={props.state().planError}
          elapsedMs={props.loopStats.elapsedMs()}
          eta={props.loopStats.etaMs()}
          debug={props.options.debug}
          selectedTask={currentTask()}
          agentName={props.options.agent}
          adapterName={props.options.adapter ?? props.state().adapterMode}
          currentModel={props.state().currentModel}
          sandboxConfig={props.state().sandboxConfig}
          activeAgentState={props.state().activeAgentState}
          rateLimitState={props.state().rateLimitState}
        />
        {showDashboard() && (
          <ProgressDashboard
            status={props.state().status}
            agentName={props.options.agent}
            adapterName={props.options.adapter ?? props.state().adapterMode}
            planName={props.options.planFile}
            currentTaskId={currentTask()?.id}
            currentTaskTitle={currentTask()?.title}
            currentModel={props.state().currentModel}
            sandboxConfig={props.state().sandboxConfig}
          />
        )}
      <box
        flexGrow={1}
        flexDirection={isCompact() ? "column" : "row"}
        height={contentHeight()}
      >
        {props.showTasks() && (
          <LeftPanel
            tasks={uiTasks()}
            selectedIndex={selectedTaskIndex()}
            width={leftPanelWidth()}
            height={contentHeight()}
            totalTasks={allUiTasks().length}
            showingCompleted={props.showCompletedTasks()}
            compactMode={compactMode()}
            onSelect={(index) => setSelectedTaskIndex(index)}
          />
        )}
        <RightPanel
          selectedTask={selectedTask()}
          viewMode={detailsViewMode()}
          status={props.state().status}
          adapterMode={props.state().adapterMode ?? "sdk"}
          events={props.state().events}
          isIdle={props.state().isIdle}
          errorRetryAt={props.state().errorRetryAt}
          terminalBuffer={props.state().terminalBuffer || ""}
          terminalCols={rightPanelCols()}
          terminalRows={rightPanelRows()}
          promptText={props.state().promptText}
        />

      </box>
      <Footer
        commits={props.state().commits}
        elapsed={props.loopStats.elapsedMs()}
        status={props.state().status}
        linesAdded={props.state().linesAdded}
        linesRemoved={props.state().linesRemoved}
        sessionActive={!!props.state().sessionId || props.state().adapterMode === "pty"}
        tokens={props.state().tokens}
        adapterMode={props.state().adapterMode}
        rateLimitState={props.state().rateLimitState}
      />

      <PausedOverlay visible={props.state().status === "paused"} />
      <SteeringOverlay
        visible={props.commandMode()}
        onClose={() => {
          props.setCommandMode(false);
          props.setCommandInput("");
        }}
        onSend={async (message) => {
          addSteeringContext(message);
          if (globalSendMessage) {
            log("app", "Sending steering message", { message });
            await globalSendMessage(message);
          } else {
            log("app", "No sendMessage function available");
          }
        }}
      />
      <HelpOverlay visible={showHelp()} />
      <DialogStack />
      <ToastStack />
    </box>
  );
}
