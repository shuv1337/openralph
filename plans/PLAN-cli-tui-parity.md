# Plan: Headless CLI Mode (TUI Parity Without OpenTUI)

## Executive Summary

Add a non-interactive, headless CLI mode that runs the existing loop without OpenTUI and emits structured output suitable for CI and scripting. Preserve existing TUI behavior as the default. Align new output strictly with data that `runLoop()` and `LoopCallbacks` already surface.

---

## Current Codebase Reality Check

### Entry + Control Flow
- `src/index.ts` is the only entry point and always starts the TUI via `startApp()`.
- `main()` always calls `process.exit(0)` in the `finally` block, which currently prevents non-zero exit codes for errors/interrupts.
- Signal handlers (`SIGINT`, `SIGTERM`) also call `process.exit(0)` after cleanup.
- `confirm()` in `src/prompt.ts` uses raw stdin and will hang in non‑TTY environments unless bypassed; it also exits the process on Ctrl+C.
- `runLoop()` in `src/loop.ts` requires an `AbortSignal` argument today.

### Events and State
- `LoopCallbacks` include `onIterationStart`, `onEvent`, `onIterationComplete`, `onTasksUpdated`, `onCommitsUpdated`, `onDiffUpdated`, `onPause`, `onResume`, `onComplete`, `onError`, `onIdleChanged`.
- `ToolEvent.type` is limited to `tool | separator | spinner | reasoning` (`src/state.ts`). There is no `error`/`complete` event type emitted through `onEvent`.
- Tool events are emitted only on completed tools (`message.part.updated` with tool `completed`).
- Reasoning events are derived from text parts and are truncated to the first line (max 80 chars) in `runLoop()`.
- There are no tool durations or commit hashes in events. Commit totals are computed via `getCommitsSince()`; diff stats come from `getDiffStats()`.

### Pause/Resume and Completion
- Pause uses `.ralph-pause` file checks (not signals).
- Completion uses `.ralph-done` file detection and `callbacks.onComplete()`; the file is deleted by `runLoop()`.
- `runLoop()` does not return a reason or status; it only calls callbacks and exits when the signal is aborted or a break condition is reached.

### Prompt Handling
- Prompt is a string CLI option only; `buildPrompt()` in `src/loop.ts` supports `{plan}` replacement only.

---

## Goals and Scope

1. Add a headless CLI mode that runs `runLoop()` without rendering a TUI.
2. Provide output formats suitable for both humans and machines.
3. Maintain behavior parity with the TUI loop (tasks, iterations, commits/diff stats, pause/resume, completion).
4. Avoid breaking the current default TUI behavior.

Out of scope:
- Web API server mode
- Interactive TUI replacements (spinners, progress bars)

---

## Proposed Architecture

```
                 ┌────────────────────────────────────┐
                 │            src/index.ts            │
                 │   CLI parsing, mode selection      │
                 └──────────────────┬─────────────────┘
                                    │
                       ┌────────────┴────────────┐
                       │                         │
                       ▼                         ▼
             ┌─────────────────┐       ┌────────────────────┐
             │   TUI Mode      │       │   Headless CLI     │
             │  (existing)     │       │    (new)           │
             │  startApp()     │       │  cliRunner()       │
             └────────┬────────┘       └─────────┬──────────┘
                      │                          │
                      └──────────────┬───────────┘
                                     ▼
                           ┌─────────────────┐
                           │   src/loop.ts   │
                           │  Core loop      │
                           └─────────────────┘
```

### CLI Output Handler
Implement a headless output handler that wires to existing `LoopCallbacks` and formats output. Do not require or use `LoopState` or TUI-only `ToolEvent` types (ignore `spinner`/`separator` events in headless output).

---

## Headless Mode Behavior

### Invocation
```
# Default TUI (existing)
ralph --plan plan.md

# Headless CLI (new)
ralph --headless --plan plan.md
ralph -H --plan plan.md
```

### Non-Interactive and CI Safety
Because `confirm()` uses raw stdin, headless mode must not prompt.

Rules:
- `--headless` implies `--yes` (auto-confirm) by default.
- If `--headless` and no TTY and a prompt would be required, either:
  - auto-reset and continue (default), or
  - exit with code 2 if `--no-auto-reset` is set.
- `--yes` should also bypass prompts in TUI mode (so the code path is unified).

### Output Formats
The output must reflect the real data available today (no commit hashes, tool durations, or untruncated reasoning unless already exposed by callbacks).

#### Text (default)
Human-readable, line-based logs. Use timestamps only when `--timestamps` is set.

#### JSONL
Each line is a JSON object. All fields must be derivable from current callbacks and loop events.

Event types available from current code:
- `start` (from headless runner initialization in `index.ts`)
- `iteration_start` / `iteration_end`
- `tool` (from `ToolEvent` with type `tool`)
- `reasoning` (from `ToolEvent` with type `reasoning`, already truncated)
- `pause` / `resume`
- `progress` (from `onTasksUpdated`)
- `stats` (from `onCommitsUpdated` and `onDiffUpdated`)
- `idle` (from `onIdleChanged`, boolean payload)
- `error` (from `onError`)
- `complete` (from `onComplete`)

#### JSON Summary
One JSON object printed at completion. Use stats already tracked (total tasks, commits, diff stats, duration, exit code). Do not include tool payloads beyond what callbacks expose.

### Exit Codes
Align exit codes with actual loop behavior and headless lifecycle, and fix `main()` to stop forcing exit code 0:
- `0` success (all tasks complete or `.ralph-done` reached)
- `1` unrecoverable error (exceptions, session creation failure)
- `2` interrupted or aborted (SIGINT/SIGTERM or user abort)
- `3` max-iterations or max-time limit reached

---

## Implementation Plan

### Phase 1: CLI Mode Switch + Non-Interactive Safety
1. Add `--headless/-H`, `--format`, `--timestamps`, `--yes`, and `--no-auto-reset` options in `src/index.ts`.
2. Refactor the prompt/reset flow so headless and TUI share the same decision logic, but can bypass `confirm()` when `--yes` or `--headless` is set.
3. When `--headless` is set:
   - Skip `startApp()` entirely.
   - Skip OpenTUI keyboard fallback and renderer-specific setup.
   - Still acquire lock and initialize logging to keep parity with TUI runs.
   - Run `runLoop()` directly with a headless output handler and an `AbortController` signal.

### Phase 2: CLI Output Implementation
1. Create `src/cli-output.ts` to build a `LoopCallbacks` implementation that writes to stdout.
2. Add formatters in `src/formats/`:
   - `text.ts`: human-readable lines
   - `jsonl.ts`: streaming JSONL
   - `json.ts`: buffered summary
3. Filter or ignore `ToolEvent` types `spinner` and `separator` in headless output (these are TUI-only artifacts emitted by `runLoop()`).
4. Ensure output does not assume data the loop does not provide (no tool durations, no commit hashes, no untruncated reasoning text).

### Phase 3: Limits and Exit Code Handling
1. Add `--max-iterations` and `--max-time` options in `src/index.ts`.
2. Enforce limits in the headless runner using its own counters and `AbortController.abort()`.
   - Track iteration count based on `onIterationStart` calls.
   - Track elapsed time based on `persistedState.startTime` or headless start time.
3. Adjust `main()` so it does not unconditionally call `process.exit(0)`.
   - Prefer `process.exitCode = <code>` and let `main()` return.
   - Ensure signal handlers set a non-zero exit code for headless mode when appropriate.
4. Consider a small `signal.aborted` check inside the pause loop in `runLoop()` so aborts are honored promptly even while paused.

### Phase 4: Documentation + Tests
1. Update README with headless usage and output format examples.
2. Add unit tests for formatters in `tests/unit/`.
3. Add integration tests for `--headless` flow in `tests/integration/` (create directory if missing).
   - Verify no-tty behavior with `--headless --yes`.
   - Verify exit code mapping for success, abort, and limit hits.
   - Verify JSONL output schema fields.

---

## Codebase Alignment Map

- CLI parsing and mode selection: `src/index.ts`
- Core loop callbacks and events: `src/loop.ts`
- Prompt handling: `src/prompt.ts` and `src/index.ts`
- Task parsing and counts: `src/plan.ts`
- Existing TUI rendering: `src/app.tsx` (unchanged for headless)
- Loop event model: `src/state.ts` (`ToolEvent`, `LoopState`)

Gaps to fill:
- No headless runner exists today
- No CLI output formatter exists today
- Confirmation prompts must be bypassed for CI
- Exit code propagation is blocked by `process.exit(0)` in `main()`

---

## Risks and Mitigations

- **Non-TTY prompts can hang CI**: ensure `--headless` and/or `--yes` bypasses `confirm()` entirely.
- **Exit codes overridden**: remove unconditional `process.exit(0)` so headless exit codes are honored.
- **Output format mismatch**: only emit fields that exist in current callbacks; ignore `spinner`/`separator`.
- **Abort handling while paused**: add a fast path to honor `AbortSignal` inside pause loop.

---

## Success Criteria

1. `ralph --headless` runs without requiring a TTY.
2. JSONL output can be consumed in CI (one JSON object per line).
3. Exit codes accurately reflect success, error, interruption, or limits.
4. TUI behavior is unchanged when `--headless` is not used.
