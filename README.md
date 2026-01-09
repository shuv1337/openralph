# ralph

AI agent loop for autonomous task execution. Reads a PRD, picks one task, completes it, commits, repeats.

<img width="1714" height="1076" alt="image" src="https://github.com/user-attachments/assets/3dd85500-0164-44cd-8917-dfcbe787c09f" />

## Quick Start

```bash
# Install stable release
bun install -g @hona/ralph-cli

# Or install dev snapshot (latest from dev branch)
bun install -g @hona/ralph-cli@dev

# Initialize PRD, progress log, and prompt
ralph init

# Run in any project directory
ralph
```

### Install from Source

```bash
git clone https://github.com/hona/opencode-ralph.git
cd opencode-ralph
bun install
bun run build:single  # compiles for current platform
```

## What is Ralph?

Ralph-driven development forces an AI agent to re-read full context every iteration, eliminating context drift. Each loop:

1. Read `prd.json`
2. Pick ONE task
3. Complete it
4. Commit (updating the PRD in the same commit)
5. Repeat until done

The agent never pushes—only commits—so you maintain review control.

**Why it works:**
- Deterministic failures are debuggable. When Ralph fails, fix the prompt.
- `AGENTS.md` accumulates wisdom so future iterations don't rediscover fire.
- Human review checkpoint before anything goes live.

See: [ghuntley.com/ralph](https://ghuntley.com/ralph/) · [lukeparker.dev/stop-chatting-with-ai-start-loops-ralph-driven-development](https://lukeparker.dev/stop-chatting-with-ai-start-loops-ralph-driven-development)

## Usage

```bash
ralph                              # uses prd.json in current directory
ralph --plan BACKLOG.json          # different PRD file
ralph --progress progress.txt      # custom progress log
ralph --model anthropic/claude-opus-4  # different model
ralph --reset                      # start fresh, ignore previous state
ralph init --from plan.md          # convert unstructured plan to PRD JSON
```

| Option | Default | Description |
|--------|---------|-------------|
| `--plan, -p` | `prd.json` | PRD file path |
| `--progress` | `progress.txt` | Progress log path |
| `--model, -m` | `opencode/claude-opus-4-5` | Model (provider/model format) |
| `--prompt` | see below | Custom prompt (`{plan}` and `{progress}` placeholders) |
| `--prompt-file` | `.ralph-prompt.md` | Prompt file path |
| `--reset, -r` | `false` | Reset state |
| `--headless, -H` | `false` | CI-friendly output |
| `--format` | `text` | Headless output format (text, jsonl, json) |
| `--max-iterations` | (none) | Cap iterations (headless) |
| `--max-time` | (none) | Cap runtime seconds (headless) |
| `--server, -s` | (none) | OpenCode server URL |
| `--server-timeout` | `5000` | Health check timeout in ms |
| `--agent, -a` | (none) | Agent name (e.g., build/plan/general) |
| `--debug, -d` | `false` | Manual session creation |
| `--yes` | `false` | Auto-confirm prompts |
| `--auto-reset` | `true` | Auto-reset when no TTY prompt |

**Default prompt:**
```
READ all of {plan} and {progress}. Pick ONE task with passes=false (prefer highest-risk/highest-impact). Keep changes small: one logical change per commit. Update {plan} by setting passes=true and adding notes or steps as needed. Append a brief entry to {progress} with what changed and why. Run feedback loops before committing: bun run typecheck, bun test, bun run lint (if missing, note it in {progress} and continue). Commit change (update {plan} in the same commit). ONLY do one task unless GLARINGLY OBVIOUS steps should run together. Quality bar: production code, maintainable, tests when appropriate. If you learn a critical operational detail, update AGENTS.md. When ALL tasks complete, create .ralph-done and output <promise>COMPLETE</promise>. NEVER GIT PUSH. ONLY COMMIT.
```

## Configuration

Ralph reads configuration from `~/.config/ralph/config.json`:

```json
{
  "model": "opencode/claude-opus-4-5",
  "plan": "prd.json",
  "progress": "progress.txt",
  "server": "http://localhost:4190",
  "serverTimeout": 5000
}
```

CLI arguments override config file values.

## Workflow Files

| File | Purpose |
|------|---------|
| `prd.json` | PRD plan items with `passes` state |
| `progress.txt` | Progress log appended each iteration |
| `.ralph-prompt.md` | Prompt template used for loop runs |
| `.ralph-state.json` | Persisted state for resume after Ctrl+C |
| `.ralph-lock` | Prevents multiple instances |
| `.ralph-done` | Agent creates this when all tasks complete |
| `.ralph-pause` | Created by `p` key to pause loop |

Add to `.gitignore`:
```
.ralph-*
```

## Writing PRDs

Prefer PRD JSON with `passes` flags so Ralph can track scope and progress:

```json
[
  {
    "category": "functional",
    "description": "Create the CLI entry point",
    "steps": [
      "Run the CLI with --help",
      "Verify the help output renders"
    ],
    "passes": false
  }
]
```

**Guidelines:**
- Small, isolated tasks—one commit each
- Explicit verification steps
- Set `passes` to true only when verified
- 1000+ lines is normal; more detail = fewer hallucinations

Legacy markdown checkboxes are still supported, but `ralph init --from plan.md` is the recommended upgrade path.

## Progress Log

Append a short entry each iteration. Example:

```
## Iteration 3 - 2025-01-10T12:34:56Z
- Task: Wire up API client
- Checks: typecheck, test
- Commit: abc123
- Notes: Added retry logic for timeouts
```

## AGENTS.md

Ralph writes operational learnings here. Future iterations read it.

```markdown
# AGENTS.md

## Build
- Run `bun install` before `bun run dev`

## Pitfalls
- Never import from `solid-js`, use `@opentui/solid`
```

## Keybindings

| Key | Action |
|-----|--------|
| `p` | Pause/resume |
| `q` / `Ctrl+C` | Quit |

## Architecture

```
src/
├── index.ts      # CLI entry, wires TUI to loop
├── loop.ts       # Main agent loop (prompt → events → commit)
├── app.tsx       # Solid.js TUI root component
├── state.ts      # State types and persistence
├── plan.ts       # PRD + markdown plan parser
├── git.ts        # Git operations (hash, diff, commits)
├── lock.ts       # Lock file management
├── prompt.ts     # User confirmation prompts
├── components/   # TUI components (header, log, footer)
└── util/         # Helpers (time formatting, logging)
```

**Data flow:** `index.ts` starts the TUI (`app.tsx`) and the loop (`loop.ts`) in parallel. The loop sends callbacks to update TUI state. State persists to `.ralph-state.json` for resume capability.

## Testing

```bash
bun test              # run all tests
bun test --watch      # watch mode
bun test --coverage   # with coverage
```

```
tests/
├── unit/         # Module isolation tests
├── integration/  # Full workflow tests
├── fixtures/     # Test plans and PRD JSON
└── helpers/      # Mock factories, temp file utils
```

## Requirements

- [Bun](https://bun.sh) v1.0+
- [OpenCode](https://opencode.ai) CLI running
