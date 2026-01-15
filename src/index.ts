#!/usr/bin/env bun
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { extend } from "@opentui/solid";
import { acquireLock, releaseLock } from "./lock";
import { loadState, saveState, PersistedState, LoopOptions, trimEvents, LoopState } from "./state";
import { confirm } from "./prompt";
import { getHeadHash, getDiffStats, getCommitsSince } from "./git";
import { startApp, destroyRenderer } from "./app";
import { runLoop } from "./loop";
import { runHeadlessMode } from "./headless";
import { runInit, isGeneratedPrd, isGeneratedPrompt, isGeneratedProgress } from "./init";
import { STATE_FILE } from "./state";
import { LOCK_FILE } from "./lock";
import { initLog, log } from "./util/log";
import { validatePlanFile } from "./plan";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

async function registerGhosttyTerminal(): Promise<void> {
  try {
    const module = await import("ghostty-opentui/terminal-buffer");
    const GhosttyTerminalRenderable = module.GhosttyTerminalRenderable;
    extend({ "ghostty-terminal": GhosttyTerminalRenderable });
  } catch (error) {
    throw new Error(`ghostty-opentui not available: ${String(error)}`);
  }
}

function assertPtySupport(): void {
  const bunVersion = process.versions.bun;
  if (!bunVersion) return;

  const required = process.platform === "win32" ? "1.1.0" : "1.0.0";
  if (!isVersionAtLeast(bunVersion, required)) {
    throw new Error(`Bun ${required}+ is required for PTY adapters (detected ${bunVersion}).`);
  }
}

function isVersionAtLeast(current: string, required: string): boolean {
  const parse = (value: string) => value.split(".").map((part) => Number(part.replace(/\D/g, "")));
  const [cMajor = 0, cMinor = 0, cPatch = 0] = parse(current);
  const [rMajor = 0, rMinor = 0, rPatch = 0] = parse(required);

  if (cMajor !== rMajor) return cMajor > rMajor;
  if (cMinor !== rMinor) return cMinor > rMinor;
  return cPatch >= rPatch;
}

async function warnIfPlanOrProgressMissing(planFile: string, progressFile: string): Promise<void> {
  const validation = await validatePlanFile(planFile);
  if (!validation.valid) {
    const message = `Plan file "${planFile}" is missing or invalid. Run "ralph init" to create a PRD plan.`;
    console.warn(message);
    log("main", "Plan validation warning", { planFile, reason: validation.issues });
  } else if (validation.format === "markdown") {
    const message = `Plan file "${planFile}" uses legacy markdown checkboxes. Run "ralph init --from ${planFile}" to convert to PRD JSON.`;
    console.warn(message);
    log("main", "Plan format warning", { planFile, format: validation.format });
  }

  if (!existsSync(progressFile)) {
    const message = `Progress file "${progressFile}" not found. Run "ralph init" to create it.`;
    console.warn(message);
    log("main", "Progress file missing", { progressFile });
  }
}

// Version is injected at build time via Bun's define
declare const RALPH_VERSION: string | undefined;

// In dev mode, fall back to reading from package.json
const version: string =
  typeof RALPH_VERSION !== "undefined"
    ? RALPH_VERSION
    : JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf-8")).version + "-dev";

interface RalphConfig {
  adapter?: string;
  model?: string;
  plan?: string;
  progress?: string;
  prompt?: string;
  promptFile?: string;
  server?: string;
  serverTimeout?: number;
  agent?: string;
  headless?: boolean;
  format?: string;
  timestamps?: boolean;
  yes?: boolean;
  autoReset?: boolean;
  maxIterations?: number;
  maxTime?: number;
  debug?: boolean;
}

function loadGlobalConfig(): RalphConfig {
  const configPath = join(homedir(), ".config", "ralph", "config.json");
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      return JSON.parse(content) as RalphConfig;
    } catch {
      // Silently ignore invalid config
    }
  }
  return {};
}

const globalConfig = loadGlobalConfig();

// When run via the bin wrapper, RALPH_USER_CWD contains the user's actual working directory
// Change back to it so plan.md and other paths resolve correctly
const userCwd = process.env.RALPH_USER_CWD;
if (userCwd) {
  process.chdir(userCwd);
}

/**
 * Creates a batched state updater that coalesces rapid setState calls.
 * Updates arriving within the debounce window are merged and applied together.
 */
function createBatchStateUpdater(
  setState: (updater: (prev: LoopState) => LoopState) => void,
  debounceMs: number = 50
) {
  let pendingUpdates: Array<(prev: LoopState) => Partial<LoopState>> = [];
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  // Tracking stats for logging
  let totalUpdatesQueued = 0;
  let totalFlushes = 0;
  let lastLogTime = Date.now();
  const LOG_INTERVAL_MS = 10000; // Log stats every 10 seconds

  function flush() {
    if (pendingUpdates.length === 0) return;
    
    const updates = pendingUpdates;
    const batchSize = updates.length;
    pendingUpdates = [];
    timeoutId = null;
    totalFlushes++;

    // Log batching stats periodically to avoid log spam
    const now = Date.now();
    if (now - lastLogTime >= LOG_INTERVAL_MS) {
      const avgBatchSize = totalFlushes > 0 ? (totalUpdatesQueued / totalFlushes).toFixed(1) : "0";
      log("batcher", "Batching stats", {
        totalUpdatesQueued,
        totalFlushes,
        avgBatchSize,
        currentBatchSize: batchSize,
      });
      lastLogTime = now;
    }

    // Apply all pending updates in a single setState call
    setState((prev) => {
      let current = prev;
      for (const update of updates) {
        current = { ...current, ...update(current) };
      }
      return current;
    });
  }

  return {
    /**
     * Queue a partial state update to be batched with other updates.
     */
    queueUpdate(updater: (prev: LoopState) => Partial<LoopState>) {
      pendingUpdates.push(updater);
      totalUpdatesQueued++;
      
      if (timeoutId === null) {
        timeoutId = setTimeout(flush, debounceMs);
      }
    },
    
    /**
     * Immediately flush all pending updates without waiting for debounce.
     * Use for updates that need immediate feedback (iteration start/complete).
     */
    flushNow() {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      flush();
    }
  };
}

/**
 * Result of a reset operation.
 */
type ResetResult = {
  removed: string[];
  skipped: string[];
  errors: string[];
};

/**
 * Run the reset operation: remove generated files and state files.
 * Only removes files that were generated by `ralph init` or are internal state files.
 * Never removes user-created files.
 */
async function runReset(options: {
  planFile: string;
  progressFile: string;
  promptFile: string;
}): Promise<ResetResult> {
  const { unlink } = await import("node:fs/promises");
  const result: ResetResult = { removed: [], skipped: [], errors: [] };

  // Helper to safely remove a file
  async function safeRemove(path: string): Promise<boolean> {
    try {
      await unlink(path);
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return false; // File doesn't exist, not an error
      }
      result.errors.push(`Failed to remove ${path}: ${err}`);
      return false;
    }
  }

  // 1. Always remove internal state files
  const stateFiles = [STATE_FILE, ".ralph-pause", ".ralph-done"];
  for (const file of stateFiles) {
    if (await safeRemove(file)) {
      result.removed.push(file);
    }
  }

  // 2. Remove stale lock file (only if process is not running)
  const lockFile = Bun.file(LOCK_FILE);
  if (await lockFile.exists()) {
    const content = await lockFile.text();
    const pid = parseInt(content.trim(), 10);
    let isStale = true;
    
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0); // Check if process exists
        isStale = false; // Process is running, lock is active
      } catch {
        // Process doesn't exist, lock is stale
      }
    }
    
    if (isStale) {
      if (await safeRemove(LOCK_FILE)) {
        result.removed.push(LOCK_FILE);
      }
    } else {
      result.skipped.push(`${LOCK_FILE} (active)`);
    }
  }

  // 3. Check and remove generated prd.json
  const prdFile = Bun.file(options.planFile);
  if (await prdFile.exists()) {
    const content = await prdFile.text();
    if (isGeneratedPrd(content)) {
      if (await safeRemove(options.planFile)) {
        result.removed.push(options.planFile);
      }
    } else {
      result.skipped.push(`${options.planFile} (user-created)`);
    }
  }

  // 4. Check and remove generated progress.txt
  const progressFile = Bun.file(options.progressFile);
  if (await progressFile.exists()) {
    const content = await progressFile.text();
    if (isGeneratedProgress(content)) {
      if (await safeRemove(options.progressFile)) {
        result.removed.push(options.progressFile);
      }
    } else {
      result.skipped.push(`${options.progressFile} (user-created)`);
    }
  }

  // 5. Check and remove generated prompt file
  const promptFile = Bun.file(options.promptFile);
  if (await promptFile.exists()) {
    const content = await promptFile.text();
    if (isGeneratedPrompt(content)) {
      if (await safeRemove(options.promptFile)) {
        result.removed.push(options.promptFile);
      }
    } else {
      result.skipped.push(`${options.promptFile} (user-created)`);
    }
  }

  return result;
}

async function main() {
  // Add global error handlers early to catch any issues
  process.on("uncaughtException", (err) => {
    log("main", "UNCAUGHT EXCEPTION", { error: err.message, stack: err.stack });
    console.error("Uncaught:", err);
  });

  process.on("unhandledRejection", (reason) => {
    log("main", "UNHANDLED REJECTION", { reason: String(reason) });
    console.error("Unhandled rejection:", reason);
  });

  const argv = await yargs(hideBin(process.argv))
    .scriptName("ralph")
    .usage("$0 [options]")
    .command(
      "init",
      "Initialize PRD plan, progress log, prompt, plugin, AGENTS.md, and .gitignore",
      (cmd) =>
        cmd
          .option("from", {
            type: "string",
            description: "Source plan or notes to convert into PRD JSON",
          })
          .option("force", {
            type: "boolean",
            description: "Overwrite existing files",
            default: false,
          })
    )
    .option("headless", {
      alias: "H",
      type: "boolean",
      description: "Run without the TUI (CI-friendly output)",
      default: globalConfig.headless ?? false,
    })
    .option("plan", {
      alias: "p",
      type: "string",
      description: "Path to the plan file",
      default: globalConfig.plan || "prd.json",
    })
    .option("progress", {
      type: "string",
      description: "Path to the progress log file",
      default: globalConfig.progress || "progress.txt",
    })
    .option("adapter", {
      type: "string",
      description: "Adapter to use (opencode-server, opencode-run, codex)",
      default: globalConfig.adapter || "opencode-server",
    })
    .option("model", {
      alias: "m",
      type: "string",
      description: "Model to use (provider/model format)",
      default: globalConfig.model || "opencode/claude-opus-4-5",
    })
    .option("prompt", {
      type: "string",
      description: "Custom prompt template (use {plan} and {progress} placeholders)",
      default: globalConfig.prompt,
    })
    .option("prompt-file", {
      type: "string",
      description: "Path to prompt file",
      default: globalConfig.promptFile || ".ralph-prompt.md",
    })
    .option("reset", {
      alias: "r",
      type: "boolean",
      description: "Reset state and start fresh",
      default: false,
    })
    .option("yes", {
      type: "boolean",
      description: "Auto-confirm prompts",
      default: globalConfig.yes ?? false,
    })
    .option("auto-reset", {
      type: "boolean",
      description: "Auto-reset when prompts cannot be shown (use --no-auto-reset to disable)",
      default: globalConfig.autoReset ?? true,
    })
    .option("format", {
      type: "string",
      description: "Headless output format (text, jsonl, json)",
      choices: ["text", "jsonl", "json"],
      default: globalConfig.format || "text",
    })
    .option("timestamps", {
      type: "boolean",
      description: "Include timestamps in headless output",
      default: globalConfig.timestamps ?? false,
    })
    .option("max-iterations", {
      type: "number",
      description: "Maximum iterations before aborting (headless)",
      default: globalConfig.maxIterations,
    })
    .option("max-time", {
      type: "number",
      description: "Maximum time in seconds before aborting (headless)",
      default: globalConfig.maxTime,
    })
    .option("server", {
      alias: "s",
      type: "string",
      description: "URL of existing OpenCode server to connect to",
      default: globalConfig.server,
    })
    .option("server-timeout", {
      type: "number",
      description: "Health check timeout in ms for external server",
      default: globalConfig.serverTimeout ?? 5000,
    })
    .option("agent", {
      alias: "a",
      type: "string",
      description: "Agent to use (e.g., 'build', 'plan', 'general')",
      default: globalConfig.agent,
    })
    .option("debug", {
      alias: "d",
      type: "boolean",
      description: "Debug mode - manual session creation",
      default: globalConfig.debug ?? false,
    })
    .help("h")
    .alias("h", "help")
    .version(version)
    .alias("v", "version")
    .strict()
    .parse();

  if (argv._[0] === "init") {
    const result = await runInit({
      planFile: argv.plan,
      progressFile: argv.progress,
      promptFile: argv.promptFile as string,
      pluginFile: ".opencode/plugin/ralph-write-guardrail.ts",
      agentsFile: "AGENTS.md",
      gitignoreFile: ".gitignore",
      from: argv.from as string | undefined,
      force: argv.force as boolean | undefined,
    });
    if (result.created.length > 0) {
      console.log(`Created: ${result.created.join(", ")}`);
    }
    if (result.skipped.length > 0) {
      console.log(`Skipped: ${result.skipped.join(", ")}`);
    }
    for (const warning of result.warnings) {
      console.warn(`Warning: ${warning}`);
    }
    return;
  }

  // Handle --reset flag: cleanup generated files and exit
  if (argv.reset) {
    const resetResult = await runReset({
      planFile: argv.plan,
      progressFile: argv.progress,
      promptFile: argv.promptFile as string,
    });

    if (resetResult.removed.length > 0) {
      console.log(`Removed: ${resetResult.removed.join(", ")}`);
    }
    if (resetResult.skipped.length > 0) {
      console.log(`Skipped: ${resetResult.skipped.join(", ")}`);
    }
    for (const error of resetResult.errors) {
      console.error(`Error: ${error}`);
    }
    
    if (resetResult.errors.length > 0) {
      process.exitCode = 1;
    } else {
      console.log("Reset complete. Run `ralph init` to reinitialize.");
    }
    return;
  }

  // Acquire lock to prevent multiple instances
  const lockAcquired = await acquireLock();
  if (!lockAcquired) {
    console.error("Another ralph instance is running");
    process.exitCode = 1;
    return;
  }

  let exitCode = 0;

  try {
    // Load existing state if present
    const existingState = await loadState();
    
    // Log whether state was found (before initLog, so use console)
    if (existingState) {
      console.log(`Found existing state: ${existingState.iterationTimes.length} iterations, started at ${new Date(existingState.startTime).toISOString()}`);
    } else {
      console.log("No existing state found, will create fresh state");
    }

    const autoYes = argv.yes || argv.headless;
    const canPrompt = process.stdin.isTTY && !autoYes;

    // Determine the state to use after confirmation prompts
    let stateToUse: PersistedState | null = null;
    let shouldReset = false; // Reset is handled above, this is for auto-reset prompts

    if (existingState && !shouldReset) {
      const samePlan = existingState.planFile === argv.plan;

      if (autoYes) {
        if (samePlan) {
          stateToUse = existingState;
        } else {
          shouldReset = true;
        }
      } else if (!canPrompt) {
        if (argv.autoReset) {
          console.log("No TTY available for prompt; auto-resetting.");
          shouldReset = true;
        } else {
          console.error("No TTY available for prompt and --no-auto-reset set. Exiting.");
          exitCode = 2;
          return;
        }
      } else if (samePlan) {
        // Same plan file - ask to continue
        const continueRun = await confirm("Continue previous run?");
        if (continueRun) {
          stateToUse = existingState;
        } else {
          shouldReset = true;
        }
      } else {
        // Different plan file - ask to reset
        const resetForNewPlan = await confirm("Reset state for new plan?");
        if (resetForNewPlan) {
          shouldReset = true;
        } else {
          // User chose not to reset - exit gracefully
          console.log("Exiting without changes.");
          return;
        }
      }
    }

    // Initialize logging (reset log when state is reset)
    const isNewRun = !stateToUse;
    initLog(isNewRun);
    log("main", "Ralph starting", { plan: argv.plan, model: argv.model, reset: shouldReset });
    if (!argv.debug) {
      await warnIfPlanOrProgressMissing(argv.plan, argv.progress);
    }
    
    // Create fresh state if needed
    if (!stateToUse) {
      log("main", "Creating fresh state");
      const headHash = await getHeadHash();
      stateToUse = {
        startTime: Date.now(),
        initialCommitHash: headHash,
        iterationTimes: [],
        planFile: argv.plan,
      };
      await saveState(stateToUse);
    } else {
      log("main", "Resuming existing state", { iterations: stateToUse.iterationTimes.length });
    }

    // Create LoopOptions from CLI arguments
    const loopOptions: LoopOptions = {
      planFile: argv.plan,
      progressFile: argv.progress,
      model: argv.model,
      prompt: argv.prompt || "",
      promptFile: argv.promptFile,
      serverUrl: argv.server,
      serverTimeoutMs: argv.serverTimeout,
      adapter: argv.adapter,
      agent: argv.agent,
      debug: argv.debug,
    };

    let adapterMode: "sdk" | "pty" =
      loopOptions.adapter && loopOptions.adapter !== "opencode-server" ? "pty" : "sdk";

    if (adapterMode === "pty") {
      try {
        assertPtySupport();
      } catch (error) {
        exitCode = 1;
        console.error(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    if (argv.headless) {
      exitCode = await runHeadlessMode({
        loopOptions,
        persistedState: stateToUse,
        format: argv.format,
        timestamps: argv.timestamps,
        maxIterations: argv.maxIterations,
        maxTime: argv.maxTime,
      });
      return;
    }

    if (adapterMode === "pty") {
      try {
        await registerGhosttyTerminal();
      } catch (error) {
        exitCode = 1;
        console.error(error instanceof Error ? error.message : String(error));
        return;
      }
    }

// Create abort controller for cancellation
    const abortController = new AbortController();

    // Keep event loop alive on Windows - stdin.resume() doesn't keep Bun's event loop active
    // This interval ensures the process stays alive until explicitly exited
    // On Windows, also send a minimal cursor save/restore sequence to keep console active
    const isWindowsPlatform = process.platform === "win32";
    const keepaliveInterval = setInterval(() => {
      // On Windows, send invisible cursor activity to prevent inactivity timeout
      if (isWindowsPlatform && process.stdout.isTTY) {
        // ESC 7 (save cursor) + ESC 8 (restore cursor) - invisible but counts as activity
        process.stdout.write("\x1b7\x1b8");
      }
    }, 30000); // Every 30 seconds

    // Task 4.3: Declare fallback timeout variable early so cleanup() can reference it
    let fallbackTimeout: ReturnType<typeof setTimeout> | undefined;
    // Phase 3.3: Declare fallback raw mode flag early so cleanup() can reference it
    let fallbackRawModeEnabled = false;

    // Cleanup function for graceful shutdown
    async function cleanup() {
      log("main", "cleanup() called");
      destroyRenderer();
      clearInterval(keepaliveInterval);

      if (fallbackTimeout) clearTimeout(fallbackTimeout); // Task 4.3: Clean up fallback timeout
      // Clean up fallback stdin handler if still active
      if (fallbackStdinHandler) {
        process.stdin.off("data", fallbackStdinHandler);
        fallbackStdinHandler = null;
      }
      // Phase 3.3: Restore raw mode if fallback enabled it
      if (fallbackRawModeEnabled && process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
          log("main", "Raw mode restored to normal during cleanup");
        } catch {
          // Ignore errors - stdin may already be closed
        }
      }
      abortController.abort();
      await releaseLock();
      log("main", "cleanup() done");
    }

    // Fallback quit handler (useful if TUI key events fail)
    let quitRequested = false;
    async function requestQuit(source: string, payload?: unknown) {
      if (quitRequested) return;
      quitRequested = true;
      log("main", "Quit requested", { source, payload });
      await cleanup();
      process.exit(0);
    }

    // Task 4.3: Conditional stdin fallback for keyboard handling
    // OpenTUI expects exclusive control over stdin, so we DON'T add a handler by default.
    // However, if OpenTUI's keyboard handling fails (no events received within timeout
    // of first user input attempt), we fall back to raw stdin as a last resort.
    // 
    // The fallback is only activated if:
    // 1. No keyboard events received from OpenTUI after startup
    // 2. A timeout has elapsed (indicating OpenTUI may not be working)
    //
    // Once OpenTUI keyboard events ARE received, the fallback is permanently disabled
    // AND the stdin listener is removed to prevent any double-handling.
    //
    // Windows-specific: Reduced timeout (2s vs 5s) because OpenTUI's onMount hook
    // is less reliable on Windows. We use a simple stdin data handler (NOT 
    // readline.emitKeypressEvents) because readline permanently modifies stdin's
    // event emission behavior, which interferes with OpenTUI's stdin handling.
    const isWindows = process.platform === "win32";
    let keyboardWorking = false;
    let fallbackEnabled = false;
    let fallbackFirstKeyLogged = false; // Phase 1.2: Only log first fallback key to avoid spam
    let fallbackStdinHandler: ((data: Buffer) => Promise<void>) | null = null;
    // Reduced timeout on Windows where OpenTUI keyboard is less reliable.
    // We use a simple stdin data handler (NOT readline.emitKeypressEvents) to avoid
    // permanently modifying stdin's event emission behavior.
    const KEYBOARD_FALLBACK_TIMEOUT_MS = isWindows ? 2000 : 5000;
    
    /**
     * Permanently disable the fallback stdin handler.
     * Called when OpenTUI keyboard is confirmed working.
     */
    const disableFallbackHandler = () => {
      // Clean up raw stdin data handler
      if (fallbackStdinHandler) {
        process.stdin.off("data", fallbackStdinHandler);
        fallbackStdinHandler = null;
        log("main", "Fallback stdin data handler removed");
      }
      // Mark fallback as disabled
      fallbackEnabled = false;
      // NOTE: We do NOT restore raw mode here because OpenTUI has taken over
      // and needs stdin to remain in raw mode. OpenTUI will handle cleanup
      // when it shuts down.
    };
    
    const onKeyboardEvent = () => {
      // OpenTUI keyboard is working - disable any fallback permanently
      keyboardWorking = true;
      log("main", "OpenTUI keyboard confirmed working, disabling fallback");
      disableFallbackHandler();
    };
    
    // Set up a delayed fallback that only activates if keyboard isn't working
    fallbackTimeout = setTimeout(async () => {
      if (keyboardWorking) {
        log("main", "Keyboard working before timeout, no fallback needed");
        return;
      }
      
      // OpenTUI keyboard may not be working - enable fallback stdin handler
      fallbackEnabled = true;
      log("main", `Enabling fallback stdin handler (OpenTUI keyboard not detected after ${KEYBOARD_FALLBACK_TIMEOUT_MS / 1000}s)`, 
        { isWindows });
      
      // Set stdin to raw mode for single-keypress detection
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        fallbackRawModeEnabled = true; // Phase 3.3: Track raw mode for cleanup
      }
      process.stdin.resume();
      
      // Use simple data handler for both Windows and non-Windows.
      // We intentionally do NOT use readline.emitKeypressEvents() because it
      // permanently modifies stdin's event emission behavior, which interferes
      // with OpenTUI's stdin handling even after cleanup.
      fallbackStdinHandler = async (data: Buffer) => {
        // If OpenTUI keyboard started working, ignore this event
        if (keyboardWorking) {
          return;
        }
        
        const char = data.toString();
        // Phase 1.2: Only log first fallback key to avoid spam
        if (!fallbackFirstKeyLogged) {
          fallbackFirstKeyLogged = true;
          log("main", "First fallback stdin key event", { 
            char: char.replace(/\x03/g, "^C"),
            isWindows,
          });
        }
        
        // Handle 'q' for quit
        if (char === "q" || char === "Q") {
          await requestQuit("fallback-stdin-q");
        }
        // Handle Ctrl+C (0x03)
        if (char === "\x03") {
          await requestQuit("fallback-stdin-ctrl-c");
        }
        // Handle 'p' for pause toggle
        if (char === "p" || char === "P") {
          log("main", "Fallback stdin: toggle pause");
          const PAUSE_FILE = ".ralph-pause";
          const file = Bun.file(PAUSE_FILE);
          const exists = await file.exists();
          if (exists) {
            const fs = await import("node:fs/promises");
            await fs.unlink(PAUSE_FILE);
          } else {
            await Bun.write(PAUSE_FILE, String(process.pid));
          }
        }
      };
      
      process.stdin.on("data", fallbackStdinHandler);
      log("main", "Simple stdin data handler installed (no readline)");
    }, KEYBOARD_FALLBACK_TIMEOUT_MS);

    // Handle SIGINT (Ctrl+C) and SIGTERM signals for graceful shutdown
    // NOTE: When stdin is in raw mode, Ctrl+C sends 0x03 character instead of SIGINT.
    // SIGINT will still fire if something else sends the signal (e.g., kill -INT).
    process.on("SIGINT", async () => {
      if (quitRequested) {
        log("main", "SIGINT received but quit already requested, ignoring");
        return;
      }
      log("main", "SIGINT received");
      await requestQuit("SIGINT");
    });

    process.on("SIGTERM", async () => {
      if (quitRequested) {
        log("main", "SIGTERM received but quit already requested, ignoring");
        return;
      }
      log("main", "SIGTERM received");
      await requestQuit("SIGTERM");
    });

    // Windows-specific: Handle SIGHUP for console close
    // Windows sends SIGHUP when console window is closed
    if (process.platform === "win32") {
      process.on("SIGHUP", async () => {
        if (quitRequested) {
          log("main", "SIGHUP received but quit already requested, ignoring");
          return;
        }
        log("main", "SIGHUP received (Windows console close)");
        await requestQuit("SIGHUP");
      });
    }

    // NOTE: We use a simple stdin data handler instead of readline.emitKeypressEvents()
    // because readline permanently modifies stdin's event emission behavior, which
    // interferes with OpenTUI's stdin handling even after cleanup.

// Start the TUI app and get state setters
    log("main", "Starting TUI app");
    const { exitPromise, stateSetters } = await startApp({
      options: loopOptions,
      persistedState: stateToUse,
      onQuit: () => {
        log("main", "onQuit callback triggered");
        abortController.abort();
      },
      onKeyboardEvent, // Task 4.3: Callback to detect if OpenTUI keyboard is working
    });
    log("main", "TUI app started, state setters available");

    // Create batched updater for coalescing rapid state changes
    // Use 100ms debounce for better batching during high event throughput
    const batchedUpdater = createBatchStateUpdater(stateSetters.setState, 100);
    const MAX_TERMINAL_BUFFER = 20000;

    stateSetters.setState((prev) => ({
      ...prev,
      adapterMode,
    }));

    // Fetch initial diff stats and commits on resume
    const initialDiff = await getDiffStats(stateToUse.initialCommitHash);
    const initialCommits = await getCommitsSince(stateToUse.initialCommitHash);
    stateSetters.setState((prev) => ({
      ...prev,
      linesAdded: initialDiff.added,
      linesRemoved: initialDiff.removed,
      commits: initialCommits,
    }));
    log("main", "Initial stats loaded", { diff: initialDiff, commits: initialCommits });

    // In debug mode, skip automatic loop start - set state to ready and wait
    if (loopOptions.debug) {
      log("main", "Debug mode: skipping automatic loop start, setting state to ready");
      stateSetters.setState((prev) => ({
        ...prev,
        status: "ready",   // Ready status for debug mode
        iteration: 0,      // No iteration running yet
        isIdle: true,      // Waiting for user input
      }));
      // Don't start the loop - wait for user to manually create sessions
      await exitPromise;
      log("main", "Debug mode: exit received, cleaning up");
      return;
    }

    // Start in ready state - create pause file and set initial state
    // User must press 'p' to begin the loop
    const PAUSE_FILE = ".ralph-pause";
    await Bun.write(PAUSE_FILE, String(process.pid));
    stateSetters.setState((prev) => ({
      ...prev,
      status: "ready",
    }));
    log("main", "Starting in ready state - press 'p' to begin");

    // Start the loop in parallel with callbacks wired to app state
    log("main", "Starting loop (paused)");
    runLoop(loopOptions, stateToUse, {
      onIterationStart: (iteration) => {
        log("main", "onIterationStart", { iteration });
        stateSetters.setState((prev) => ({
          ...prev,
          status: "running",
          iteration,
        }));
      },
      onEvent: (event) => {
        // Debounce event updates to batch rapid events within 50ms window
        // Mutate existing array in-place to avoid allocations
        batchedUpdater.queueUpdate((prev) => {
          const spinnerIndex = prev.events.findIndex((e) => e.type === "spinner");
          const existingSpinner = spinnerIndex !== -1 ? prev.events[spinnerIndex] : undefined;
          const eventsWithoutSpinner = prev.events.filter((e) => e.type !== "spinner");

          let nextSpinner = existingSpinner;
          if (event.type === "spinner") {
            nextSpinner = event;
          } else {
            eventsWithoutSpinner.push(event);
          }

          if (nextSpinner) {
            eventsWithoutSpinner.push(nextSpinner);
          }

          return { events: trimEvents(eventsWithoutSpinner) };
        });
      },
      onRawOutput: (data) => {
        batchedUpdater.queueUpdate((prev) => {
          const existing = prev.terminalBuffer || "";
          let next = existing + data;
          if (next.length > MAX_TERMINAL_BUFFER) {
            next = next.slice(-MAX_TERMINAL_BUFFER);
          }
          return { terminalBuffer: next };
        });
      },
      onIterationComplete: (iteration, duration, commits) => {
        batchedUpdater.flushNow();
        // Mutate the separator event in-place and remove spinner
        stateSetters.setState((prev) => {
          const updatedEvents = prev.events
            .map((event) => {
              if (event.type === "separator" && event.iteration === iteration) {
                return { ...event, duration, commitCount: commits };
              }
              return event;
            })
            .filter(
              (event) => !(event.type === "spinner" && event.iteration === iteration)
            );

          return {
            ...prev,
            events: updatedEvents,
          };
        });
        // Update persisted state with the new iteration time
        stateToUse.iterationTimes.push(duration);
        saveState(stateToUse);
        // Update the iteration times in the app for ETA calculation
        stateSetters.updateIterationTimes([...stateToUse.iterationTimes]);
        // Trigger render when iteration ends
        stateSetters.requestRender();
      },
      onTasksUpdated: (done, total) => {
        log("main", "onTasksUpdated", { done, total });
        stateSetters.setState((prev) => ({
          ...prev,
          tasksComplete: done,
          totalTasks: total,
        }));
      },
      onCommitsUpdated: (commits) => {
        // Debounce commits updates - these can lag slightly for better batching
        batchedUpdater.queueUpdate(() => ({
          commits,
        }));
      },
      onDiffUpdated: (added, removed) => {
        // Debounce diff updates - these can lag slightly for better batching
        batchedUpdater.queueUpdate(() => ({
          linesAdded: added,
          linesRemoved: removed,
        }));
      },
      onPause: () => {
        // Update state.status to "paused"
        stateSetters.setState((prev) => ({
          ...prev,
          status: "paused",
        }));
        // Trigger render when paused
        stateSetters.requestRender();
      },
      onResume: () => {
        // Update state.status to "running"
        stateSetters.setState((prev) => ({
          ...prev,
          status: "running",
        }));
        // Trigger render when resumed
        stateSetters.requestRender();
      },
      onComplete: () => {
        batchedUpdater.flushNow();
        // Update state.status to "complete" and clear any lingering spinners
        stateSetters.setState((prev) => {
          const events = prev.events;
          for (let i = events.length - 1; i >= 0; i--) {
            if (events[i].type === "spinner") {
              events.splice(i, 1);
            }
          }
          return {
            ...prev,
            status: "complete",
            isIdle: true,
          };
        });
        // Trigger render when complete
        stateSetters.requestRender();
      },
      onError: (error) => {
        // Update state.status to "error" and set state.error
        stateSetters.setState((prev) => ({
          ...prev,
          status: "error",
          error,
        }));
        // Trigger render on error
        stateSetters.requestRender();
      },
      onIdleChanged: (isIdle) => {
        // Update isIdle state for idle mode optimization
        stateSetters.setState((prev) => ({
          ...prev,
          isIdle,
        }));
        // Trigger render when session becomes idle (completed processing)
        if (isIdle) {
          stateSetters.requestRender();
        }
      },
      onSessionCreated: (session) => {
        // Store session info in state for steering mode
        // Reset tokens to zero for new session (fresh token tracking per session)
        const isPty = adapterMode === "pty";
        stateSetters.setState((prev) => ({
          ...prev,
          sessionId: isPty ? undefined : session.sessionId,
          serverUrl: isPty ? undefined : session.serverUrl,
          attached: isPty ? undefined : session.attached,
          tokens: undefined, // Reset token counters on session start
        }));
        // Store sendMessage function for steering overlay
        stateSetters.setSendMessage(session.sendMessage);
        // Trigger render when new session starts
        stateSetters.requestRender();
      },
      onSessionEnded: (_sessionId) => {
        // Clear session fields when session ends
        // Also clear token display when no active session
        stateSetters.setState((prev) => ({
          ...prev,
          sessionId: undefined,
          serverUrl: undefined,
          attached: undefined,
          tokens: undefined, // Clear token display when session ends
        }));
        // Clear sendMessage function
        stateSetters.setSendMessage(null);
        // Trigger render when session ends (cleanup complete)
        stateSetters.requestRender();
      },
      onBackoff: (backoffMs, retryAt) => {
        // Update state with backoff info for retry countdown display
        stateSetters.setState((prev) => ({
          ...prev,
          errorBackoffMs: backoffMs,
          errorRetryAt: retryAt,
        }));
      },
      onBackoffCleared: () => {
        // Clear backoff fields when retry begins
        stateSetters.setState((prev) => ({
          ...prev,
          errorBackoffMs: undefined,
          errorRetryAt: undefined,
        }));
      },
      onTokens: (tokens) => {
        // Accumulate token usage for footer display
        batchedUpdater.queueUpdate((prev) => {
          const existing = prev.tokens || {
            input: 0,
            output: 0,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
          };
          return {
            tokens: {
              input: existing.input + tokens.input,
              output: existing.output + tokens.output,
              reasoning: existing.reasoning + tokens.reasoning,
              cacheRead: existing.cacheRead + tokens.cacheRead,
              cacheWrite: existing.cacheWrite + tokens.cacheWrite,
            },
          };
        });
      },
      onAdapterModeChanged: (mode) => {
        adapterMode = mode;
        stateSetters.setState((prev) => ({
          ...prev,
          adapterMode: mode,
          terminalBuffer: mode === "pty" ? "" : prev.terminalBuffer,
        }));
      },
      // Real-time plan file modification handler with debouncing
      // Uses 150ms debounce to batch rapid file edits (e.g., multiple task updates)
      onPlanFileModified: (() => {
        let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
        return () => {
          if (debounceTimeout) {
            clearTimeout(debounceTimeout);
          }
          debounceTimeout = setTimeout(() => {
            debounceTimeout = null;
            log("main", "Plan file modified, triggering task refresh");
            stateSetters.triggerTaskRefresh();
            stateSetters.requestRender();
          }, 150);
        };
      })(),
    }, abortController.signal).catch((error) => {
      log("main", "Loop error", { error: error instanceof Error ? error.message : String(error) });
      console.error("Loop error:", error);
    });

    // Wait for the app to exit, then cleanup
    log("main", "Waiting for exit");
    await exitPromise;
    log("main", "Exit received, cleaning up");
  } catch (error) {
    exitCode = 1;
    log("main", "ERROR in main", { error: error instanceof Error ? error.message : String(error) });
    console.error("Error:", error instanceof Error ? error.message : String(error));
  } finally {
    log("main", "FINALLY BLOCK ENTERED");
    destroyRenderer();
    await releaseLock();
    log("main", "Lock released");
    process.exitCode = exitCode;
  }
}

// Error handling wrapper for the main function
main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
