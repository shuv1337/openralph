import { log } from "./lib/log";
import type { TaskStatus } from "./types/task-status";

/**
 * Plan file parser for openralph
 */

export type PrdItem = {
  category?: string;
  description: string;
  steps?: string[];
  passes: boolean;
  status?: TaskStatus;
};


export type PlanFormat = "prd-json" | "markdown" | "unknown";

export type PlanValidation = {
  format: PlanFormat;
  valid: boolean;
  issues: string[];
  items?: PrdItem[];
};

export type PlanProgress = {
  done: number;
  total: number;
  error?: string;
};

/**
 * Represents a single task from a plan file
 */
export type Task = {
  /** Unique identifier derived from line number */
  id: string;
  /** Line number in the file (1-indexed) */
  line: number;
  /** Task text without the checkbox prefix */
  text: string;
  /** Whether the task is completed */
  done: boolean;
  /** Task priority (0-4) */
  priority?: number;
  /** Task category */
  category?: string;
  /** Granular task status */
  status?: TaskStatus;
};



// Regex to match markdown checkbox items
// Captures: optional leading whitespace, checkbox state, and task text
const CHECKBOX_PATTERN = /^(\s*)-\s*\[([ xX])\]\s*(.+?)\r?$/;

function normalizePrdItems(data: unknown): PrdItem[] | null {
  let items: unknown[] | null = null;
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    items = (data as { items: unknown[] }).items;
  }

  if (!items) {
    log("plan", "No items array found in PRD data");
    return null;
  }

  const normalized: PrdItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== "object") {
      log("plan", `Invalid item at index ${i}`, { item });
      return null;
    }
    const candidate = item as Record<string, unknown>;
    const description =
      typeof candidate.description === "string"
        ? candidate.description
        : typeof candidate.title === "string"
          ? candidate.title
          : null;
    if (!description) {
      log("plan", `Missing description at index ${i}`, { item });
      return null;
    }
    if (typeof candidate.passes !== "boolean") {
      log("plan", `Missing/invalid 'passes' boolean at index ${i}`, { item });
      return null;
    }

    const steps = candidate.steps;
    if (
      steps !== undefined &&
      (!Array.isArray(steps) || steps.some((step) => typeof step !== "string"))
    ) {
      log("plan", `Invalid 'steps' array at index ${i}`, { item });
      return null;
    }

    normalized.push({
      category: typeof candidate.category === "string" ? candidate.category : undefined,
      description,
      steps: steps as string[] | undefined,
      passes: candidate.passes as boolean,
      status: typeof candidate.status === "string" ? (candidate.status as TaskStatus) : undefined,
    });
  }

  return normalized;
}

export function parsePrdItems(content: string): PrdItem[] | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return normalizePrdItems(parsed);
  } catch (error) {
    log("plan", "Failed to parse PRD JSON", { 
      error: error instanceof Error ? error.message : String(error),
      contentLength: trimmed.length,
      preview: trimmed.slice(0, 100)
    });
    return null;
  }
}

function parseMarkdownTasks(content: string): Task[] {
  const lines = content.split(/\r?\n/);
  const tasks: Task[] = [];

  // Track if we're inside a fenced code block
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1; // 1-indexed

    // Check for code block boundaries
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip lines inside code blocks
    if (inCodeBlock) {
      continue;
    }

    const match = line.match(CHECKBOX_PATTERN);
    if (match) {
      const [, , checkboxState, text] = match;
      tasks.push({
        id: `task-${lineNumber}`,
        line: lineNumber,
        text: text.trim(),
        done: checkboxState.toLowerCase() === "x",
      });
    }
  }

  return tasks;
}

/**
 * Parse a plan file and extract all tasks as structured objects.
 * Tasks are identified by markdown checkboxes: `- [x]` (done) and `- [ ]` (not done)
 * @param path - Path to the plan file
 * @returns Array of Task objects with id, line, text, and done status
 */
export async function parsePlanTasks(path: string): Promise<Task[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return [];
  }

  const content = await file.text();
  const prdItems = parsePrdItems(content);
  if (prdItems) {
    return prdItems.map((item, index) => {
      // Map category/priority from PRD item if available
      // Note: PrdItem currently only has category and description
      return {
        id: `prd-${index + 1}`,
        line: index + 1,
        text: item.description,
        done: item.passes,
        category: item.category,
        status: item.status,
      };
    });
  }


  return parseMarkdownTasks(content);
}

/**
 * Parse a plan file and count completed/total tasks.
 * Tasks are identified by markdown checkboxes: `- [x]` (done) and `- [ ]` (not done)
 * @param path - Path to the plan file
 * @returns Object with done and total counts
 */
export async function parsePlan(path: string): Promise<PlanProgress> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { done: 0, total: 0 };
  }

  const content = await file.text();

  try {
    const prdItems = parsePrdItems(content);
    if (prdItems) {
      const done = prdItems.filter((item) => item.passes).length;
      return { done, total: prdItems.length };
    }
  } catch (err) {
    return { 
      done: 0, 
      total: 0, 
      error: err instanceof Error ? err.message : String(err) 
    };
  }

  // If content is present but parsePrdItems returned null, check if it was intended to be JSON
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    // It looks like JSON but failed to parse/normalize
    return {
      done: 0,
      total: 0,
      error: "Invalid PRD JSON format. Check for syntax errors."
    };
  }

  // Fallback to markdown parsing
  // Remove content inside fenced code blocks (```...```) before counting
  // This prevents counting checkboxes that appear in code examples
  const contentWithoutCodeBlocks = content.replace(/```[\s\S]*?```/g, "");

  // Count completed tasks: - [x] (case insensitive)
  const doneMatches = contentWithoutCodeBlocks.match(/- \[x\]/gi);
  const done = doneMatches ? doneMatches.length : 0;

  // Count incomplete tasks: - [ ]
  const notDoneMatches = contentWithoutCodeBlocks.match(/- \[ \]/g);
  const notDone = notDoneMatches ? notDoneMatches.length : 0;

  return {
    done,
    total: done + notDone,
  };
}

export async function validatePlanFile(path: string): Promise<PlanValidation> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {
      format: "unknown",
      valid: false,
      issues: ["Plan file does not exist."],
    };
  }

  const content = await file.text();
  const prdItems = parsePrdItems(content);
  if (prdItems) {
    return {
      format: "prd-json",
      valid: true,
      issues: [],
      items: prdItems,
    };
  }

  const markdownTasks = parseMarkdownTasks(content);
  if (markdownTasks.length > 0) {
    return {
      format: "markdown",
      valid: true,
      issues: [],
    };
  }

  return {
    format: "unknown",
    valid: false,
    issues: ["Plan file format is not recognized."],
  };
}

/**
 * Validates if all tasks in a plan file are complete.
 * Returns true only if all tasks are done and there is at least one task.
 * @param planFile - Path to the plan file
 * @returns Promise<boolean> - True if the plan is complete, false otherwise
 */
export async function validatePlanCompletion(planFile: string): Promise<boolean> {
  const { done, total } = await parsePlan(planFile);
  return total > 0 && done === total;
}

/**
 * Save updated tasks back to the plan file.
 * Supports both PRD JSON and Markdown formats.
 * @param path - Path to the plan file
 * @param updatedTasks - Array of tasks with updated status/done state
 */
export async function savePlanTasks(path: string, updatedTasks: Task[]): Promise<void> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Plan file does not exist: ${path}`);
  }

  const content = await file.text();
  const prdItems = parsePrdItems(content);

  if (prdItems) {
    // JSON Format
    try {
      const parsed = JSON.parse(content);
      let items: any[];
      if (Array.isArray(parsed)) {
        items = parsed;
      } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
        items = parsed.items;
      } else {
        throw new Error("Invalid PRD JSON structure");
      }

      for (const task of updatedTasks) {
        const match = task.id.match(/^prd-(\d+)$/);
        if (match) {
          const index = parseInt(match[1], 10) - 1;
          if (items[index]) {
            items[index].passes = task.done;
            if (task.status) {
              items[index].status = task.status;
            }
          }
        }
      }

      await Bun.write(path, JSON.stringify(parsed, null, 2));
      log("plan", `Saved ${updatedTasks.length} tasks to PRD JSON`, { path });
    } catch (error) {
      log("plan", "Failed to save PRD JSON", { error: String(error) });
      throw error;
    }
  } else {
    // Markdown Format
    const lines = content.split(/\r?\n/);
    let modified = false;

    for (const task of updatedTasks) {
      const lineIndex = task.line - 1;
      if (lines[lineIndex]) {
        const match = lines[lineIndex].match(CHECKBOX_PATTERN);
        if (match) {
          const [, indent, , text] = match;
          const checkbox = task.done ? "x" : " ";
          const newLine = `${indent}- [${checkbox}] ${text}`;
          if (lines[lineIndex] !== newLine) {
            lines[lineIndex] = newLine;
            modified = true;
          }
        }
      }
    }

    if (modified) {
      await Bun.write(path, lines.join("\n"));
      log("plan", `Saved ${updatedTasks.length} tasks to Markdown`, { path });
    }
  }
}


