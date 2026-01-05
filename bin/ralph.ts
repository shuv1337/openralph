#!/usr/bin/env bun

/*
 * Ralph CLI Entry Point - Direct Execution (No Subprocess)
 * ========================================================
 * 
 * This entry point runs src/index.ts directly without spawning a subprocess.
 * Bun automatically applies the preload from bunfig.toml, so we don't need
 * any special handling for @opentui/solid.
 * 
 * PREVIOUS APPROACH (WHY IT WAS PROBLEMATIC):
 * -------------------------------------------
 * The old code spawned a subprocess with:
 *   spawn({ cmd: ["bun", "run", "src/index.ts", ...], stdio: "inherit" })
 * 
 * This caused issues because:
 * 1. OpenTUI requires direct control of stdin/stdout for TUI rendering
 * 2. Even with stdio: "inherit", the parent process owns the TTY which
 *    interferes with raw mode keyboard handling
 * 3. Subprocess pattern creates process hierarchy that confuses signals
 * 
 * CURRENT APPROACH:
 * -----------------
 * 1. Store user's CWD in RALPH_USER_CWD env var (src/index.ts chdir's to it)
 * 2. Change to package root (so relative imports resolve correctly)
 * 3. Dynamically import src/index.ts which runs the main logic
 * 
 * PRELOAD REQUIREMENT:
 * --------------------
 * The @opentui/solid preload is configured in bunfig.toml:
 *   preload = ["@opentui/solid/preload"]
 * 
 * Bun reads this automatically when running scripts from this package,
 * so no explicit preload handling is needed here.
 */

import { dirname } from "path";
import { fileURLToPath } from "url";

// Get the package root (parent of bin directory)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = dirname(__dirname);

// Store the user's current working directory before changing dirs
// src/index.ts will read this and chdir back to it
process.env.RALPH_USER_CWD = process.cwd();

// Change to package root so relative imports in src/ resolve correctly
process.chdir(packageRoot);

// Import and run the main entry point directly
// This executes in the same process - no subprocess needed
await import("../src/index.ts");
