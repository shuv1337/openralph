/**
 * Format a duration in milliseconds to a human-readable string.
 * - If hours > 0: "Xh Ym"
 * - If minutes > 0: "Xm Ys"
 * - Else: "Xs"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Calculate estimated time remaining based on iteration times.
 * @param iterationTimes - Array of past iteration durations in milliseconds
 * @param remainingTasks - Number of tasks remaining
 * @returns Estimated time in milliseconds, or null if no data available
 */
export function calculateEta(
  iterationTimes: number[],
  remainingTasks: number,
): number | null {
  if (iterationTimes.length === 0) {
    return null;
  }
  const sum = iterationTimes.reduce((acc, time) => acc + time, 0);
  const average = sum / iterationTimes.length;
  return average * remainingTasks;
}

/**
 * Format an ETA value to a human-readable string.
 * @param ms - Estimated time remaining in milliseconds, or null if unavailable
 * @returns Formatted string like "~5m 30s remaining" or "--:--" if null
 */
export function formatEta(ms: number | null): string {
  if (ms === null) {
    return "--:--";
  }
  return `~${formatDuration(ms)} remaining`;
}
