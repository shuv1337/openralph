/**
 * Cross-platform process cleanup utilities for ralph
 * 
 * Handles graceful and forceful termination of child processes
 * across Windows, macOS, and Linux.
 * 
 * Key concepts:
 * - Subprocess Registry: Explicitly track all spawned PIDs for guaranteed cleanup
 * - Process Tree Termination: Kill entire subtrees using platform-specific methods
 * - Orphan Prevention: Kill processes BEFORE parent relationships are broken
 */
import { log } from "./log";

/**
 * Global subprocess registry for tracking spawned processes.
 * This provides a fallback mechanism when process tree traversal fails.
 * 
 * On Windows, when a parent process is killed, its children become orphaned
 * (their parent PID points to a dead process), making tree-based cleanup fail.
 * By explicitly tracking PIDs, we can always find and terminate them.
 */
const spawnedProcessRegistry = new Set<number>();

/**
 * Register a spawned subprocess PID for tracking.
 * Call this immediately after spawning any child process.
 */
export function registerSpawnedProcess(pid: number): void {
  if (pid > 0) {
    spawnedProcessRegistry.add(pid);
    log("cleanup", "Registered spawned process", { pid });
  }
}

/**
 * Unregister a subprocess PID (e.g., when it exits normally).
 */
export function unregisterSpawnedProcess(pid: number): void {
  spawnedProcessRegistry.delete(pid);
  log("cleanup", "Unregistered spawned process", { pid });
}

/**
 * Get all registered spawned process PIDs.
 */
export function getRegisteredProcesses(): number[] {
  return Array.from(spawnedProcessRegistry);
}

/**
 * Clear the subprocess registry.
 * Call this after successful cleanup.
 */
export function clearProcessRegistry(): void {
  spawnedProcessRegistry.clear();
}

/**
 * Kill all registered processes directly.
 * This is more reliable than tree traversal because it doesn't depend
 * on parent-child relationships which can be broken during cleanup.
 * 
 * @returns CleanupResult with terminated PIDs
 */
export async function killRegisteredProcesses(): Promise<CleanupResult> {
  const result: CleanupResult = {
    success: true,
    terminatedPids: [],
    errors: [],
  };

  const registeredPids = getRegisteredProcesses();
  if (registeredPids.length === 0) {
    log("cleanup", "No registered processes to kill");
    return result;
  }

  log("cleanup", "Killing registered processes", { count: registeredPids.length, pids: registeredPids });

  const platform = process.platform;

  for (const pid of registeredPids) {
    try {
      if (platform === "win32") {
        // On Windows, use taskkill /F /T to kill entire tree rooted at this PID
        const killProc = Bun.spawn(
          ["taskkill", "/F", "/T", "/PID", String(pid)],
          { stdout: "pipe", stderr: "pipe" }
        );
        await killProc.exited;
        
        if (killProc.exitCode === 0) {
          result.terminatedPids.push(pid);
          log("cleanup", "Killed registered process tree", { pid });
        } else {
          const stderr = await new Response(killProc.stderr).text();
          // "not found" means already gone
          if (stderr.includes("not found") || killProc.exitCode === 128) {
            log("cleanup", "Registered process already gone", { pid });
          } else {
            log("cleanup", "Failed to kill registered process", { pid, exitCode: killProc.exitCode });
          }
        }
      } else {
        // Unix: Send SIGKILL to the process group
        try {
          // First try to kill the process group (negative PID)
          try {
            process.kill(-pid, "SIGKILL");
            result.terminatedPids.push(pid);
            log("cleanup", "Killed registered process group", { pid });
          } catch {
            // Process group kill failed, try direct kill
            process.kill(pid, "SIGKILL");
            result.terminatedPids.push(pid);
            log("cleanup", "Killed registered process directly", { pid });
          }
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          if (!error.includes("ESRCH")) {
            log("cleanup", "Error killing registered process", { pid, error });
          }
        }
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      result.errors.push(`Failed to kill PID ${pid}: ${error}`);
    }
  }

  // Clear the registry after killing
  clearProcessRegistry();

  log("cleanup", "Registered process cleanup complete", {
    terminated: result.terminatedPids.length,
    errors: result.errors.length,
  });

  return result;
}

/**
 * Result of a cleanup operation
 */
export type CleanupResult = {
  success: boolean;
  terminatedPids: number[];
  errors: string[];
};

/**
 * Force terminate all descendant processes of the current process.
 * This is a cross-platform cleanup function that works on Windows, macOS, and Linux.
 * 
 * Strategy:
 * 1. FIRST: Kill all explicitly registered processes (most reliable)
 * 2. THEN: Find and kill any remaining descendants via tree traversal
 * 
 * Windows: Uses taskkill /F /T to forcefully terminate the entire process tree
 * Unix: Uses process groups and SIGKILL for reliable termination
 * 
 * @returns CleanupResult with information about what was terminated
 */
export async function forceTerminateDescendants(): Promise<CleanupResult> {
  const result: CleanupResult = {
    success: true,
    terminatedPids: [],
    errors: [],
  };

  const platform = process.platform;
  const myPid = process.pid;

  log("cleanup", "Starting process cleanup", { platform, pid: myPid });

  try {
    // STEP 1: Kill all explicitly registered processes first
    // This is more reliable than tree traversal because we have the exact PIDs
    const registeredResult = await killRegisteredProcesses();
    result.terminatedPids.push(...registeredResult.terminatedPids);
    result.errors.push(...registeredResult.errors);
    
    // Brief pause to let processes fully terminate before tree traversal
    await Bun.sleep(100);
    
    // STEP 2: Find and kill any remaining descendants via tree traversal
    if (platform === "win32") {
      await forceTerminateWindows(myPid, result);
    } else {
      await forceTerminateUnix(myPid, result);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    result.success = false;
    log("cleanup", "Error during process cleanup", { error: errorMsg });
  }

  log("cleanup", "Process cleanup complete", {
    terminatedCount: result.terminatedPids.length,
    errors: result.errors.length,
  });

  return result;
}

/**
 * Windows-specific process tree termination.
 * Uses a simplified strategy for robust cleanup:
 * 1. Find only DIRECT children (not grandchildren)
 * 2. Kill each direct child with taskkill /F /T (which handles entire subtree)
 * 3. Verify and retry if needed
 * 
 * This avoids race conditions where killing grandchildren while the parent
 * is still alive causes the parent to respawn new children.
 */
async function forceTerminateWindows(
  myPid: number,
  result: CleanupResult
): Promise<void> {
  // Configuration for retry behavior
  // Reduced from 5 to 2 attempts since we now filter out cleanup utility processes
  // which was causing false positives (wmic, powershell, taskkill showing up as children)
  const MAX_CLEANUP_ATTEMPTS = 2;
  const CLEANUP_DELAY_MS = 500; // Increased delay for more reliable process termination
  
  /**
   * Kill a single PID and its tree using taskkill.
   * Returns true if successfully killed or process doesn't exist.
   */
  async function killPidTree(pid: number): Promise<boolean> {
    try {
      const killProc = Bun.spawn(
        ["taskkill", "/F", "/T", "/PID", String(pid)],
        { stdout: "pipe", stderr: "pipe" }
      );
      await killProc.exited;
      
      if (killProc.exitCode === 0) {
        result.terminatedPids.push(pid);
        return true;
      }
      
      const stderr = await new Response(killProc.stderr).text();
      // "not found" or exit code 128 means process already gone - success
      if (stderr.includes("not found") || killProc.exitCode === 128) {
        return true;
      }
      
      return false;
    } catch {
      // Process may have already exited
      return true;
    }
  }
  
  /**
   * Try to kill a process using native process.kill() - final fallback.
   */
  function nativeKill(pid: number): boolean {
    try {
      process.kill(pid, "SIGKILL");
      result.terminatedPids.push(pid);
      return true;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      // ESRCH = process doesn't exist - that's success
      return error.includes("ESRCH");
    }
  }
  
  log("cleanup", "Windows cleanup starting", { myPid, maxAttempts: MAX_CLEANUP_ATTEMPTS });
  
  // Aggressive cleanup loop: keep trying until no children remain or max attempts
  for (let attempt = 1; attempt <= MAX_CLEANUP_ATTEMPTS; attempt++) {
    // IMPORTANT: Get only DIRECT children, not grandchildren
    // taskkill /T will handle the entire subtree for each direct child
    // Getting grandchildren causes race conditions where the parent respawns them
    const directChildren = await getWindowsDirectChildPids(myPid);
    
    if (directChildren.length === 0) {
      log("cleanup", `No direct child processes found (attempt ${attempt})`, { attempt });
      break;
    }
    
    log("cleanup", `Attempt ${attempt}: Found ${directChildren.length} direct child processes`, { 
      attempt, 
      pids: directChildren,
      isLastAttempt: attempt === MAX_CLEANUP_ATTEMPTS
    });
    
    // Kill all direct children in parallel - taskkill /T handles their subtrees
    const killPromises = directChildren.map(async (pid) => {
      const success = await killPidTree(pid);
      if (!success && attempt === MAX_CLEANUP_ATTEMPTS) {
        // Last attempt - try native kill as fallback
        log("cleanup", `taskkill failed for PID ${pid}, trying native kill`);
        nativeKill(pid);
      }
    });
    
    await Promise.all(killPromises);
    
    // Small delay between attempts to let processes fully terminate
    if (attempt < MAX_CLEANUP_ATTEMPTS) {
      await Bun.sleep(CLEANUP_DELAY_MS);
    }
  }
  
  // Final verification - check for any stragglers (use recursive check here for thoroughness)
  await Bun.sleep(200);
  const finalCheck = await getWindowsChildPids(myPid);
  
  if (finalCheck.length > 0) {
    log("cleanup", `WARNING: ${finalCheck.length} child processes persist after all attempts`, { 
      pids: finalCheck 
    });
    
    // Final scorched earth - native kill each remaining PID
    for (const pid of finalCheck) {
      log("cleanup", `Final native kill attempt for PID ${pid}`);
      nativeKill(pid);
    }
    
    // Last check
    await Bun.sleep(100);
    const lastCheck = await getWindowsChildPids(myPid);
    if (lastCheck.length > 0) {
      log("cleanup", `CRITICAL: ${lastCheck.length} processes still remain - may be orphaned`, { 
        pids: lastCheck 
      });
      result.errors.push(`${lastCheck.length} child processes could not be terminated`);
    }
  } else {
    log("cleanup", "All child processes successfully terminated");
  }
}

/**
 * System processes spawned by our cleanup code that should be excluded from kill list.
 * These are the enumeration and kill utilities we spawn ourselves.
 * Case-insensitive matching is used.
 */
const CLEANUP_UTILITY_PROCESSES = new Set([
  "wmic.exe",
  "powershell.exe",
  "taskkill.exe",
  "conhost.exe",      // Console host spawned for command-line tools
  "cmd.exe",          // Command shell (may be spawned by some tools)
]);

/**
 * Check if a process name is a cleanup utility that should be excluded.
 */
function isCleanupUtilityProcess(name: string): boolean {
  return CLEANUP_UTILITY_PROCESSES.has(name.toLowerCase());
}

/**
 * Get ONLY direct child PIDs on Windows (no grandchildren).
 * This is used by the cleanup logic to avoid race conditions -
 * taskkill /T will handle the subtrees.
 * 
 * IMPORTANT: Filters out cleanup utility processes (wmic, powershell, taskkill)
 * to prevent the cleanup loop from finding its own enumeration processes.
 */
async function getWindowsDirectChildPids(parentPid: number): Promise<number[]> {
  try {
    // Use WMIC to get both PID and Name so we can filter out utility processes
    const proc = Bun.spawn(
      ["wmic", "process", "where", `ParentProcessId=${parentPid}`, "get", "ProcessId,Name", "/format:csv"],
      { stdout: "pipe", stderr: "pipe" }
    );
    
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    
    if (proc.exitCode !== 0) {
      // WMIC may not be available, try PowerShell
      return await getWindowsDirectChildPidsPowerShell(parentPid);
    }
    
    // Parse CSV output: Node,Name,ProcessId\r\n...,opencode.exe,1234\r\n
    const pids: number[] = [];
    const lines = output.trim().split(/\r?\n/);
    for (const line of lines) {
      const parts = line.split(",");
      // CSV format: Node,Name,ProcessId (3+ parts)
      if (parts.length >= 3) {
        const name = parts[1]?.trim() || "";
        const pid = parseInt(parts[parts.length - 1].trim(), 10);
        
        if (!isNaN(pid) && pid > 0 && pid !== parentPid) {
          // Skip cleanup utility processes to prevent infinite loop
          if (isCleanupUtilityProcess(name)) {
            log("cleanup", "Skipping cleanup utility process", { pid, name });
            continue;
          }
          pids.push(pid);
        }
      }
    }
    
    // NO recursion - only return direct children
    return pids;
  } catch (e) {
    log("cleanup", "Failed to get direct child PIDs via WMIC", { error: String(e) });
    return getWindowsDirectChildPidsPowerShell(parentPid);
  }
}

/**
 * Fallback: Get ONLY direct child PIDs using PowerShell.
 * Filters out cleanup utility processes to prevent infinite cleanup loop.
 */
async function getWindowsDirectChildPidsPowerShell(parentPid: number): Promise<number[]> {
  try {
    // Get both ProcessId and Name so we can filter out utility processes
    const proc = Bun.spawn(
      [
        "powershell",
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${parentPid} } | Select-Object ProcessId,Name | ConvertTo-Json -Depth 1`
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    
    const pids: number[] = [];
    
    // Try to parse as JSON
    try {
      let data = JSON.parse(output.trim());
      // ConvertTo-Json returns single object if only one result
      if (!Array.isArray(data)) {
        data = [data];
      }
      
      for (const item of data) {
        if (!item || typeof item.ProcessId !== "number") continue;
        
        const pid = item.ProcessId;
        const name = String(item.Name || "").toLowerCase();
        
        if (pid > 0 && !isCleanupUtilityProcess(name)) {
          pids.push(pid);
        } else if (isCleanupUtilityProcess(name)) {
          log("cleanup", "Skipping cleanup utility process (PS)", { pid, name });
        }
      }
    } catch {
      // JSON parse failed - fall back to line-by-line parsing
      // This handles the case where PowerShell returns plain text
      for (const line of output.trim().split(/\r?\n/)) {
        const pid = parseInt(line.trim(), 10);
        // Without name info, we can't filter - but these are likely real processes
        if (!isNaN(pid) && pid > 0) {
          pids.push(pid);
        }
      }
    }
    
    // NO recursion - only return direct children
    return pids;
  } catch (e) {
    log("cleanup", "Failed to get direct child PIDs via PowerShell", { error: String(e) });
    return [];
  }
}

/**
 * Get direct child PIDs on Windows using WMIC.
 * Also recursively gets grandchildren for complete tree enumeration.
 * Used by final verification step.
 * 
 * IMPORTANT: Filters out cleanup utility processes to avoid false positives.
 */
async function getWindowsChildPids(parentPid: number): Promise<number[]> {
  try {
    // Use WMIC to get both PID and Name so we can filter out utility processes
    const proc = Bun.spawn(
      ["wmic", "process", "where", `ParentProcessId=${parentPid}`, "get", "ProcessId,Name", "/format:csv"],
      { stdout: "pipe", stderr: "pipe" }
    );
    
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    
    if (proc.exitCode !== 0) {
      // WMIC may not be available, try PowerShell
      return await getWindowsChildPidsPowerShell(parentPid);
    }
    
    // Parse CSV output: Node,Name,ProcessId\r\n...,opencode.exe,1234\r\n
    const pids: number[] = [];
    const lines = output.trim().split(/\r?\n/);
    for (const line of lines) {
      const parts = line.split(",");
      // CSV format: Node,Name,ProcessId (3+ parts)
      if (parts.length >= 3) {
        const name = parts[1]?.trim() || "";
        const pid = parseInt(parts[parts.length - 1].trim(), 10);
        
        if (!isNaN(pid) && pid > 0 && pid !== parentPid) {
          // Skip cleanup utility processes
          if (isCleanupUtilityProcess(name)) {
            continue;
          }
          pids.push(pid);
        }
      }
    }
    
    // Also get grandchildren recursively
    const allPids = [...pids];
    for (const childPid of pids) {
      const grandchildren = await getWindowsChildPids(childPid);
      allPids.push(...grandchildren);
    }
    
    return allPids;
  } catch (e) {
    log("cleanup", "Failed to get child PIDs via WMIC", { error: String(e) });
    return getWindowsChildPidsPowerShell(parentPid);
  }
}

/**
 * Fallback: Get child PIDs using PowerShell.
 * Filters out cleanup utility processes.
 */
async function getWindowsChildPidsPowerShell(parentPid: number): Promise<number[]> {
  try {
    // Get both ProcessId and Name so we can filter out utility processes
    const proc = Bun.spawn(
      [
        "powershell",
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${parentPid} } | Select-Object ProcessId,Name | ConvertTo-Json -Depth 1`
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    
    const pids: number[] = [];
    
    // Try to parse as JSON
    try {
      let data = JSON.parse(output.trim());
      // ConvertTo-Json returns single object if only one result
      if (!Array.isArray(data)) {
        data = [data];
      }
      
      for (const item of data) {
        if (!item || typeof item.ProcessId !== "number") continue;
        
        const pid = item.ProcessId;
        const name = String(item.Name || "").toLowerCase();
        
        if (pid > 0 && !isCleanupUtilityProcess(name)) {
          pids.push(pid);
        }
      }
    } catch {
      // JSON parse failed - fall back to line-by-line parsing
      for (const line of output.trim().split(/\r?\n/)) {
        const pid = parseInt(line.trim(), 10);
        if (!isNaN(pid) && pid > 0) {
          pids.push(pid);
        }
      }
    }
    
    return pids;
  } catch (e) {
    log("cleanup", "Failed to get child PIDs via PowerShell", { error: String(e) });
    return [];
  }
}

/**
 * Unix-specific process tree termination.
 * Uses pgrep/pkill or ps with SIGKILL for reliable termination.
 * Works on both Linux and macOS.
 */
async function forceTerminateUnix(
  myPid: number,
  result: CleanupResult
): Promise<void> {
  const isMacOS = process.platform === "darwin";
  
  /**
   * Get child PIDs using pgrep (works on both Linux and macOS).
   * Falls back to ps if pgrep is not available.
   */
  async function getChildPids(parentPid: number): Promise<number[]> {
    try {
      // pgrep -P works on both Linux and macOS
      const pgrepProc = Bun.spawn(["pgrep", "-P", String(parentPid)], {
        stdout: "pipe",
        stderr: "ignore",
      });
      
      const output = await new Response(pgrepProc.stdout).text();
      await pgrepProc.exited;
      
      if (pgrepProc.exitCode === 0) {
        return output
          .trim()
          .split("\n")
          .map((line) => parseInt(line.trim(), 10))
          .filter((pid) => !isNaN(pid) && pid > 0);
      }
    } catch {
      // pgrep not available, fall through to ps
    }
    
    // Fallback: Use ps with platform-specific syntax
    try {
      // Linux: ps -o pid= --ppid <pid>
      // macOS: ps -o pid= -ax | ... (need different approach)
      const psArgs = isMacOS
        ? ["-o", "pid=,ppid=", "-ax"]  // macOS: get all processes with ppid
        : ["-o", "pid=", "--ppid", String(parentPid)];  // Linux: direct filter
      
      const psProc = Bun.spawn(["ps", ...psArgs], {
        stdout: "pipe",
        stderr: "ignore",
      });
      
      const output = await new Response(psProc.stdout).text();
      await psProc.exited;
      
      if (isMacOS) {
        // Parse macOS output: "  123  456" (pid, ppid)
        return output
          .trim()
          .split("\n")
          .map((line) => {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[0], 10);
            const ppid = parseInt(parts[1], 10);
            return ppid === parentPid ? pid : NaN;
          })
          .filter((pid) => !isNaN(pid) && pid > 0);
      } else {
        return output
          .trim()
          .split("\n")
          .map((line) => parseInt(line.trim(), 10))
          .filter((pid) => !isNaN(pid) && pid > 0);
      }
    } catch {
      return [];
    }
  }
  
  try {
    // Strategy 1: Use pkill to kill all children recursively
    // -KILL sends SIGKILL, -P matches parent PID
    log("cleanup", "Strategy 1: pkill -KILL -P");
    const pkillProc = Bun.spawn(["pkill", "-KILL", "-P", String(myPid)], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await pkillProc.exited;

    if (pkillProc.exitCode === 0) {
      log("cleanup", "pkill successfully terminated child processes");
      result.terminatedPids.push(-1); // Placeholder
    }

    // Strategy 2: Find and kill any remaining children
    log("cleanup", "Strategy 2: pgrep/ps + kill fallback");
    const childPids = await getChildPids(myPid);

    for (const pid of childPids) {
      try {
        process.kill(pid, "SIGKILL");
        result.terminatedPids.push(pid);
        log("cleanup", `Killed PID ${pid} via SIGKILL`);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        if (!error.includes("ESRCH")) {
          result.errors.push(`Failed to kill PID ${pid}: ${error}`);
        }
      }
    }

    // Strategy 3: Verify cleanup completed - re-check for remaining children
    // IMPORTANT: We do NOT use pkill -f to kill by process name globally
    // as that would kill ALL processes with that name, including unrelated ones.
    log("cleanup", "Strategy 3: Verify child processes terminated");
    
    // Wait briefly and re-check
    await Bun.sleep(200);
    
    const remainingPids = await getChildPids(myPid);
    
    if (remainingPids.length > 0) {
      log("cleanup", `Found ${remainingPids.length} remaining children, retrying kill...`, { pids: remainingPids });
      for (const pid of remainingPids) {
        try {
          process.kill(pid, "SIGKILL");
          result.terminatedPids.push(pid);
          log("cleanup", `Force killed remaining PID ${pid}`);
        } catch (e) {
          // Ignore - process may have exited
        }
      }
    } else {
      log("cleanup", "All child processes successfully terminated");
    }

    log("cleanup", "Unix cleanup completed", {
      terminatedCount: result.terminatedPids.length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Unix cleanup error: ${errorMsg}`);
  }
}

/**
 * Kill a specific process by PID.
 * Cross-platform implementation.
 * 
 * @param pid Process ID to kill
 * @param force Whether to use SIGKILL (force) or SIGTERM (graceful)
 * @returns true if the process was killed or doesn't exist
 */
export async function killProcess(pid: number, force: boolean = true): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const args = force ? ["/F", "/T", "/PID", String(pid)] : ["/PID", String(pid)];
      const proc = Bun.spawn(["taskkill", ...args], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
      return proc.exitCode === 0 || proc.exitCode === 128;
    } else {
      const signal = force ? "SIGKILL" : "SIGTERM";
      try {
        process.kill(pid, signal);
        return true;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        return error.includes("ESRCH");
      }
    }
  } catch {
    return false;
  }
}

/**
 * Check if a process with the given PID is running.
 * Cross-platform implementation.
 * 
 * @param pid Process ID to check
 * @returns true if the process is running
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the process listening on a specific port.
 * Cross-platform implementation that works on Windows, macOS, and Linux.
 * 
 * This is useful for tracking processes when we don't have direct access to the PID
 * (e.g., when an SDK spawns a server but doesn't expose the child process PID).
 * 
 * @param port The port number to search for
 * @returns The PID of the process listening on the port, or null if not found
 */
export async function findProcessByPort(port: number): Promise<number | null> {
  const platform = process.platform;
  
  log("cleanup", "Finding process by port", { port, platform });
  
  try {
    if (platform === "win32") {
      return await findProcessByPortWindows(port);
    } else {
      return await findProcessByPortUnix(port);
    }
  } catch (error) {
    log("cleanup", "Error finding process by port", { 
      port, 
      error: error instanceof Error ? error.message : String(error) 
    });
    return null;
  }
}

/**
 * Windows implementation: Find process by port using netstat.
 * Falls back to PowerShell if netstat parsing fails.
 */
async function findProcessByPortWindows(port: number): Promise<number | null> {
  // Strategy 1: Use netstat -ano (available on all Windows versions)
  try {
    const proc = Bun.spawn(
      ["netstat", "-ano", "-p", "TCP"],
      { stdout: "pipe", stderr: "pipe" }
    );
    
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    
    if (proc.exitCode === 0) {
      // Parse netstat output:
      // TCP    127.0.0.1:4096    0.0.0.0:0    LISTENING    1234
      const lines = output.split(/\r?\n/);
      for (const line of lines) {
        // Match LISTENING state and our port
        if (line.includes("LISTENING")) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 5) {
            const localAddr = parts[1];
            const pid = parseInt(parts[parts.length - 1], 10);
            
            // Check if local address ends with our port
            if (localAddr && localAddr.endsWith(`:${port}`) && !isNaN(pid) && pid > 0) {
              log("cleanup", "Found process by port (netstat)", { port, pid });
              return pid;
            }
          }
        }
      }
    }
  } catch (e) {
    log("cleanup", "netstat failed, trying PowerShell", { error: String(e) });
  }
  
  // Strategy 2: Use PowerShell Get-NetTCPConnection (Windows 8+)
  try {
    const proc = Bun.spawn(
      [
        "powershell",
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess`
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    
    const pid = parseInt(output.trim(), 10);
    if (!isNaN(pid) && pid > 0) {
      log("cleanup", "Found process by port (PowerShell)", { port, pid });
      return pid;
    }
  } catch (e) {
    log("cleanup", "PowerShell Get-NetTCPConnection failed", { error: String(e) });
  }
  
  log("cleanup", "Could not find process by port on Windows", { port });
  return null;
}

/**
 * Unix implementation: Find process by port using lsof or ss.
 * Works on both macOS and Linux.
 */
async function findProcessByPortUnix(port: number): Promise<number | null> {
  const isMacOS = process.platform === "darwin";
  
  // Strategy 1: Use lsof (available on macOS and most Linux distros)
  try {
    const proc = Bun.spawn(
      ["lsof", "-i", `:${port}`, "-t", "-sTCP:LISTEN"],
      { stdout: "pipe", stderr: "pipe" }
    );
    
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    
    if (proc.exitCode === 0) {
      const pid = parseInt(output.trim().split(/\n/)[0], 10);
      if (!isNaN(pid) && pid > 0) {
        log("cleanup", "Found process by port (lsof)", { port, pid });
        return pid;
      }
    }
  } catch (e) {
    log("cleanup", "lsof failed, trying fallback", { error: String(e) });
  }
  
  // Strategy 2: Use ss (Linux) or netstat (macOS fallback)
  if (!isMacOS) {
    // Linux: Use ss -tlnp (socket statistics)
    try {
      const proc = Bun.spawn(
        ["ss", "-tlnp", `sport = :${port}`],
        { stdout: "pipe", stderr: "pipe" }
      );
      
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      
      if (proc.exitCode === 0) {
        // Parse ss output: ...pid=1234,...
        const pidMatch = output.match(/pid=(\d+)/);
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10);
          if (!isNaN(pid) && pid > 0) {
            log("cleanup", "Found process by port (ss)", { port, pid });
            return pid;
          }
        }
      }
    } catch (e) {
      log("cleanup", "ss failed", { error: String(e) });
    }
  } else {
    // macOS fallback: Use netstat
    try {
      const proc = Bun.spawn(
        ["netstat", "-anv", "-p", "tcp"],
        { stdout: "pipe", stderr: "pipe" }
      );
      
      const output = await new Response(proc.stdout).text();
      await proc.exited;
      
      if (proc.exitCode === 0) {
        const lines = output.split(/\n/);
        for (const line of lines) {
          // Look for LISTEN state and our port
          if (line.includes("LISTEN") && line.includes(`.${port} `) || line.includes(`:${port} `)) {
            // macOS netstat format varies, try to extract PID from last column
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(pid) && pid > 0) {
              log("cleanup", "Found process by port (netstat macOS)", { port, pid });
              return pid;
            }
          }
        }
      }
    } catch (e) {
      log("cleanup", "macOS netstat failed", { error: String(e) });
    }
  }
  
  log("cleanup", "Could not find process by port on Unix", { port });
  return null;
}

/**
 * Find and register a process by the port it's listening on.
 * Convenience wrapper that finds the PID and registers it for cleanup.
 * 
 * @param port The port to search for
 * @returns The found PID, or null if not found
 */
export async function findAndRegisterProcessByPort(port: number): Promise<number | null> {
  const pid = await findProcessByPort(port);
  if (pid) {
    registerSpawnedProcess(pid);
    log("cleanup", "Found and registered process by port", { port, pid });
  }
  return pid;
}
