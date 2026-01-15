import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runInit, isGeneratedPrd, isGeneratedPrompt, isGeneratedProgress, isGeneratedPlugin, isGeneratedAgents, GENERATED_PROMPT_MARKER, GENERATED_PLUGIN_MARKER, GENERATED_AGENTS_MARKER, GITIGNORE_ENTRIES, GITIGNORE_HEADER, buildGitignoreBlock } from "../../src/init";
import { TempDir } from "../helpers/temp-files";

describe("runInit", () => {
  const tempDir = new TempDir();

  beforeEach(async () => {
    await tempDir.create();
  });

  afterEach(async () => {
    await tempDir.cleanup();
  });

  it("should preserve markdown plan files and write PRD JSON to prd.json", async () => {
    const planPath = await tempDir.write(
      "plan.md",
      "# Plan\n- [ ] First task\n- [ ] Second task\n"
    );
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");
    const pluginPath = tempDir.path(".opencode/plugin/ralph-write-guardrail.ts");
    const agentsPath = tempDir.path("AGENTS.md");

    const result = await runInit({
      planFile: planPath,
      progressFile: progressPath,
      promptFile: promptPath,
      pluginFile: pluginPath,
      agentsFile: agentsPath,
      gitignoreFile: tempDir.path(".gitignore"),
    });

    const originalPlan = await tempDir.read("plan.md");
    expect(originalPlan).toBe("# Plan\n- [ ] First task\n- [ ] Second task\n");

    const prdPath = tempDir.path("prd.json");
    const prdExists = await tempDir.exists("prd.json");
    expect(prdExists).toBe(true);

    const prdContent = await Bun.file(prdPath).json();
    // PRD is now wrapped with metadata
    expect(prdContent.metadata).toBeDefined();
    expect(prdContent.metadata.generated).toBe(true);
    expect(prdContent.metadata.generator).toBe("ralph-init");
    expect(Array.isArray(prdContent.items)).toBe(true);
    expect(prdContent.items.length).toBe(2);
    expect(prdContent.items[0]).toMatchObject({
      description: "First task",
      passes: false,
    });

    expect(result.created).toContain(prdPath);
  });

  it("should use plan.md when no args and prd.json does not exist", async () => {
    await tempDir.write("plan.md", "# Plan\n- [ ] First task\n- [ ] Second task\n");
    const prdPath = tempDir.path("prd.json");
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");
    const pluginPath = tempDir.path(".opencode/plugin/ralph-write-guardrail.ts");
    const agentsPath = tempDir.path("AGENTS.md");

    const originalCwd = process.cwd();
    try {
      process.chdir(tempDir.dir);
      const result = await runInit({
        planFile: prdPath,
        progressFile: progressPath,
        promptFile: promptPath,
        pluginFile: pluginPath,
        agentsFile: agentsPath,
        gitignoreFile: tempDir.path(".gitignore"),
      });

      const prdContent = await Bun.file(prdPath).json();
      // PRD is now wrapped with metadata
      expect(prdContent.metadata).toBeDefined();
      expect(prdContent.items.length).toBe(2);
      expect(result.warnings.some((warning) => warning.includes("plan.md"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should add frontmatter marker to generated prompt file", async () => {
    const planPath = await tempDir.write("plan.md", "# Plan\n- [ ] Task\n");
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");
    const pluginPath = tempDir.path(".opencode/plugin/ralph-write-guardrail.ts");
    const agentsPath = tempDir.path("AGENTS.md");

    await runInit({
      planFile: planPath,
      progressFile: progressPath,
      promptFile: promptPath,
      pluginFile: pluginPath,
      agentsFile: agentsPath,
      gitignoreFile: tempDir.path(".gitignore"),
    });

    const promptContent = await Bun.file(promptPath).text();
    expect(promptContent.startsWith(GENERATED_PROMPT_MARKER)).toBe(true);
    expect(isGeneratedPrompt(promptContent)).toBe(true);
  });

  it("should include sourceFile in PRD metadata when initialized from a source", async () => {
    const planPath = await tempDir.write("plan.md", "# Plan\n- [ ] Task\n");
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");
    const pluginPath = tempDir.path(".opencode/plugin/ralph-write-guardrail.ts");
    const agentsPath = tempDir.path("AGENTS.md");
    const prdPath = tempDir.path("prd.json");

    await runInit({
      planFile: planPath,
      progressFile: progressPath,
      promptFile: promptPath,
      pluginFile: pluginPath,
      agentsFile: agentsPath,
      gitignoreFile: tempDir.path(".gitignore"),
    });

    const prdContent = await Bun.file(prdPath).json();
    expect(prdContent.metadata.sourceFile).toBe(planPath);
  });

  it("should create plugin file with marker in .opencode/plugin directory", async () => {
    const planPath = await tempDir.write("plan.md", "# Plan\n- [ ] Task\n");
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");
    const pluginPath = tempDir.path(".opencode/plugin/ralph-write-guardrail.ts");
    const agentsPath = tempDir.path("AGENTS.md");

    const result = await runInit({
      planFile: planPath,
      progressFile: progressPath,
      promptFile: promptPath,
      pluginFile: pluginPath,
      agentsFile: agentsPath,
      gitignoreFile: tempDir.path(".gitignore"),
    });

    const pluginExists = await Bun.file(pluginPath).exists();
    expect(pluginExists).toBe(true);

    const pluginContent = await Bun.file(pluginPath).text();
    expect(pluginContent.startsWith(GENERATED_PLUGIN_MARKER)).toBe(true);
    expect(isGeneratedPlugin(pluginContent)).toBe(true);
    expect(pluginContent).toContain("@opencode-ai/plugin");
    expect(pluginContent).toContain("tool.execute.before");
    expect(pluginContent).toContain("prd.json");
    expect(pluginContent).toContain("AGENTS.md");

    expect(result.created).toContain(pluginPath);
  });

  it("should create AGENTS.md with marker when it doesn't exist", async () => {
    const planPath = await tempDir.write("plan.md", "# Plan\n- [ ] Task\n");
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");
    const pluginPath = tempDir.path(".opencode/plugin/ralph-write-guardrail.ts");
    const agentsPath = tempDir.path("AGENTS.md");

    const result = await runInit({
      planFile: planPath,
      progressFile: progressPath,
      promptFile: promptPath,
      pluginFile: pluginPath,
      agentsFile: agentsPath,
      gitignoreFile: tempDir.path(".gitignore"),
    });

    const agentsExists = await Bun.file(agentsPath).exists();
    expect(agentsExists).toBe(true);

    const agentsContent = await Bun.file(agentsPath).text();
    expect(agentsContent.startsWith(GENERATED_AGENTS_MARKER)).toBe(true);
    expect(isGeneratedAgents(agentsContent)).toBe(true);
    expect(agentsContent).toContain("Project-Specific Configuration");
    expect(agentsContent).toContain("Common Gotchas");

    expect(result.created).toContain(agentsPath);
  });

  it("should NEVER overwrite existing AGENTS.md even with --force", async () => {
    const planPath = await tempDir.write("plan.md", "# Plan\n- [ ] Task\n");
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");
    const pluginPath = tempDir.path(".opencode/plugin/ralph-write-guardrail.ts");
    
    // Create an existing AGENTS.md with custom content
    const customAgentsContent = "# My Custom AGENTS.md\n\nDo not overwrite this!";
    const agentsPath = await tempDir.write("AGENTS.md", customAgentsContent);

    const result = await runInit({
      planFile: planPath,
      progressFile: progressPath,
      promptFile: promptPath,
      pluginFile: pluginPath,
      agentsFile: agentsPath,
      gitignoreFile: tempDir.path(".gitignore"),
      force: true, // Even with force, AGENTS.md should not be overwritten
    });

    const agentsContent = await Bun.file(agentsPath).text();
    expect(agentsContent).toBe(customAgentsContent);
    expect(result.skipped).toContain(agentsPath);
    expect(result.created).not.toContain(agentsPath);
  });

  it("should respect --force for plugin file but not for AGENTS.md", async () => {
    const planPath = await tempDir.write("plan.md", "# Plan\n- [ ] Task\n");
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");
    
    // Create existing plugin file
    const { mkdirSync } = await import("fs");
    mkdirSync(tempDir.path(".opencode/plugin"), { recursive: true });
    const oldPluginContent = "// Old plugin content";
    const pluginPath = await tempDir.write(".opencode/plugin/ralph-write-guardrail.ts", oldPluginContent);
    
    // Create existing AGENTS.md
    const customAgentsContent = "# My Custom AGENTS.md";
    const agentsPath = await tempDir.write("AGENTS.md", customAgentsContent);

    const result = await runInit({
      planFile: planPath,
      progressFile: progressPath,
      promptFile: promptPath,
      pluginFile: pluginPath,
      agentsFile: agentsPath,
      gitignoreFile: tempDir.path(".gitignore"),
      force: true,
    });

    // Plugin should be overwritten with --force
    const pluginContent = await Bun.file(pluginPath).text();
    expect(pluginContent).not.toBe(oldPluginContent);
    expect(isGeneratedPlugin(pluginContent)).toBe(true);
    expect(result.created).toContain(pluginPath);

    // AGENTS.md should NOT be overwritten even with --force
    const agentsContent = await Bun.file(agentsPath).text();
    expect(agentsContent).toBe(customAgentsContent);
    expect(result.skipped).toContain(agentsPath);
  });

  it("should create new .gitignore with Ralph entries when it doesn't exist", async () => {
    const planPath = await tempDir.write("plan.md", "# Plan\n- [ ] Task\n");
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");
    const pluginPath = tempDir.path(".opencode/plugin/ralph-write-guardrail.ts");
    const agentsPath = tempDir.path("AGENTS.md");
    const gitignorePath = tempDir.path(".gitignore");

    const result = await runInit({
      planFile: planPath,
      progressFile: progressPath,
      promptFile: promptPath,
      pluginFile: pluginPath,
      agentsFile: agentsPath,
      gitignoreFile: gitignorePath,
    });

    const gitignoreExists = await Bun.file(gitignorePath).exists();
    expect(gitignoreExists).toBe(true);

    const gitignoreContent = await Bun.file(gitignorePath).text();
    expect(gitignoreContent).toContain(GITIGNORE_HEADER);
    for (const entry of GITIGNORE_ENTRIES) {
      expect(gitignoreContent).toContain(entry);
    }
    expect(result.created).toContain(gitignorePath);
    expect(result.gitignoreAppended).toBeUndefined();
  });

  it("should append Ralph entries to existing .gitignore without duplicates", async () => {
    const planPath = await tempDir.write("plan.md", "# Plan\n- [ ] Task\n");
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");
    const pluginPath = tempDir.path(".opencode/plugin/ralph-write-guardrail.ts");
    const agentsPath = tempDir.path("AGENTS.md");
    
    // Create existing .gitignore with some content
    const existingContent = "node_modules/\n.env\n";
    const gitignorePath = await tempDir.write(".gitignore", existingContent);

    const result = await runInit({
      planFile: planPath,
      progressFile: progressPath,
      promptFile: promptPath,
      pluginFile: pluginPath,
      agentsFile: agentsPath,
      gitignoreFile: gitignorePath,
    });

    const gitignoreContent = await Bun.file(gitignorePath).text();
    
    // Original content should be preserved
    expect(gitignoreContent).toContain("node_modules/");
    expect(gitignoreContent).toContain(".env");
    
    // Ralph entries should be added
    expect(gitignoreContent).toContain(GITIGNORE_HEADER);
    for (const entry of GITIGNORE_ENTRIES) {
      expect(gitignoreContent).toContain(entry);
    }
    
    expect(result.created).toContain(gitignorePath);
    expect(result.gitignoreAppended).toBe(true);
  });

  it("should skip .gitignore when all Ralph entries already present", async () => {
    const planPath = await tempDir.write("plan.md", "# Plan\n- [ ] Task\n");
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");
    const pluginPath = tempDir.path(".opencode/plugin/ralph-write-guardrail.ts");
    const agentsPath = tempDir.path("AGENTS.md");
    
    // Create .gitignore that already has all Ralph entries
    const existingContent = `node_modules/
.env
# Ralph - AI agent loop files
.ralph-state.json
.ralph-lock
.ralph-done
`;
    const gitignorePath = await tempDir.write(".gitignore", existingContent);

    const result = await runInit({
      planFile: planPath,
      progressFile: progressPath,
      promptFile: promptPath,
      pluginFile: pluginPath,
      agentsFile: agentsPath,
      gitignoreFile: gitignorePath,
    });

    const gitignoreContent = await Bun.file(gitignorePath).text();
    
    // Content should be unchanged
    expect(gitignoreContent).toBe(existingContent);
    
    // Should be skipped, not created
    expect(result.skipped).toContain(gitignorePath);
    expect(result.created).not.toContain(gitignorePath);
    expect(result.gitignoreAppended).toBeUndefined();
  });

  it("should only add missing Ralph entries to .gitignore", async () => {
    const planPath = await tempDir.write("plan.md", "# Plan\n- [ ] Task\n");
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");
    const pluginPath = tempDir.path(".opencode/plugin/ralph-write-guardrail.ts");
    const agentsPath = tempDir.path("AGENTS.md");
    
    // Create .gitignore that already has some Ralph entries
    const existingContent = `node_modules/
.ralph-state.json
`;
    const gitignorePath = await tempDir.write(".gitignore", existingContent);

    const result = await runInit({
      planFile: planPath,
      progressFile: progressPath,
      promptFile: promptPath,
      pluginFile: pluginPath,
      agentsFile: agentsPath,
      gitignoreFile: gitignorePath,
    });

    const gitignoreContent = await Bun.file(gitignorePath).text();
    
    // Original content should be preserved
    expect(gitignoreContent).toContain("node_modules/");
    
    // All Ralph entries should now be present
    for (const entry of GITIGNORE_ENTRIES) {
      expect(gitignoreContent).toContain(entry);
    }
    
    // Count occurrences of .ralph-state.json - should only appear once
    const matches = gitignoreContent.match(/\.ralph-state\.json/g);
    expect(matches?.length).toBe(1);
    
    expect(result.created).toContain(gitignorePath);
    expect(result.gitignoreAppended).toBe(true);
  });

  it("should handle .gitignore without trailing newline", async () => {
    const planPath = await tempDir.write("plan.md", "# Plan\n- [ ] Task\n");
    const progressPath = tempDir.path("progress.txt");
    const promptPath = tempDir.path(".ralph-prompt.md");
    const pluginPath = tempDir.path(".opencode/plugin/ralph-write-guardrail.ts");
    const agentsPath = tempDir.path("AGENTS.md");
    
    // Create .gitignore without trailing newline
    const existingContent = "node_modules/\n.env";  // No trailing newline
    const gitignorePath = await tempDir.write(".gitignore", existingContent);

    const result = await runInit({
      planFile: planPath,
      progressFile: progressPath,
      promptFile: promptPath,
      pluginFile: pluginPath,
      agentsFile: agentsPath,
      gitignoreFile: gitignorePath,
    });

    const gitignoreContent = await Bun.file(gitignorePath).text();
    
    // Original content should be preserved
    expect(gitignoreContent).toContain("node_modules/");
    expect(gitignoreContent).toContain(".env");
    
    // Ralph entries should be properly separated
    expect(gitignoreContent).toContain(GITIGNORE_HEADER);
    
    // Make sure there's a blank line before the header for readability
    expect(gitignoreContent).toContain("\n\n" + GITIGNORE_HEADER);
    
    expect(result.gitignoreAppended).toBe(true);
  });
});

describe("isGeneratedPrd", () => {
  it("should return true for generated PRD with metadata", () => {
    const content = JSON.stringify({
      metadata: {
        generated: true,
        generator: "ralph-init",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
      items: [{ description: "Task", passes: false }],
    });
    expect(isGeneratedPrd(content)).toBe(true);
  });

  it("should return false for plain array PRD", () => {
    const content = JSON.stringify([{ description: "Task", passes: false }]);
    expect(isGeneratedPrd(content)).toBe(false);
  });

  it("should return false for PRD with wrong generator", () => {
    const content = JSON.stringify({
      metadata: {
        generated: true,
        generator: "other-tool",
        createdAt: "2025-01-01T00:00:00.000Z",
      },
      items: [{ description: "Task", passes: false }],
    });
    expect(isGeneratedPrd(content)).toBe(false);
  });

  it("should return false for non-JSON content", () => {
    expect(isGeneratedPrd("# Not JSON")).toBe(false);
  });

  it("should return false for invalid JSON", () => {
    expect(isGeneratedPrd("{ invalid json }")).toBe(false);
  });
});

describe("isGeneratedPrompt", () => {
  it("should return true for prompt with generated frontmatter", () => {
    const content = `---
generated: true
generator: ralph-init
safe_to_delete: true
---
READ all of plan.md`;
    expect(isGeneratedPrompt(content)).toBe(true);
  });

  it("should return false for prompt without frontmatter", () => {
    const content = "READ all of plan.md";
    expect(isGeneratedPrompt(content)).toBe(false);
  });

  it("should return false for prompt with different frontmatter", () => {
    const content = `---
title: My Custom Prompt
---
READ all of plan.md`;
    expect(isGeneratedPrompt(content)).toBe(false);
  });
});

describe("isGeneratedProgress", () => {
  it("should return true for progress with init marker", () => {
    const content = `# Ralph Progress

## Iteration 0 - Initialized 2025-01-01T00:00:00.000Z
- Plan: prd.json
- Notes: Initialized via ralph init.
`;
    expect(isGeneratedProgress(content)).toBe(true);
  });

  it("should return false for user-created progress", () => {
    const content = `# My Progress

## Task 1
- Did something
`;
    expect(isGeneratedProgress(content)).toBe(false);
  });
});

describe("isGeneratedPlugin", () => {
  it("should return true for plugin with generated marker", () => {
    const content = `// Generated by ralph init
// generator: ralph-init
// safe_to_delete: true

import type { Plugin } from "@opencode-ai/plugin"
export const RalphWriteGuardrail: Plugin = async () => { return {} }`;
    expect(isGeneratedPlugin(content)).toBe(true);
  });

  it("should return false for custom plugin", () => {
    const content = `// My custom plugin
import type { Plugin } from "@opencode-ai/plugin"
export const MyPlugin: Plugin = async () => { return {} }`;
    expect(isGeneratedPlugin(content)).toBe(false);
  });
});

describe("isGeneratedAgents", () => {
  it("should return true for AGENTS.md with generated marker", () => {
    const content = `<!-- Generated by ralph init -->
<!-- generator: ralph-init -->
<!-- safe_to_delete: true -->

# AGENTS.md - Project Configuration for AI Agents`;
    expect(isGeneratedAgents(content)).toBe(true);
  });

  it("should return false for custom AGENTS.md", () => {
    const content = `# AGENTS.md - My Custom Configuration

This is my custom configuration file.`;
    expect(isGeneratedAgents(content)).toBe(false);
  });
});
