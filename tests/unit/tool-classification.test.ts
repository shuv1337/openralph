import { describe, it, expect } from "bun:test";
import { getToolClassification, TOOL_CLASSIFICATIONS } from "../../src/lib/tool-classification";

describe("Tool Classification", () => {
  it("should return correct classification for known tools", () => {
    const read = getToolClassification("read");
    expect(read.category).toBe("file");
    expect(read.displayName).toBe("Read");
    expect(read.icon).toBe("󰈞");

    const bash = getToolClassification("bash");
    expect(bash.category).toBe("execute");
    expect(bash.displayName).toBe("Bash");
  });

  it("should be case-insensitive", () => {
    const read1 = getToolClassification("READ");
    const read2 = getToolClassification("read");
    expect(read1).toEqual(read2);
  });

  it("should return a custom classification for unknown tools", () => {
    const unknown = getToolClassification("my-cool-tool");
    expect(unknown.category).toBe("custom");
    expect(unknown.displayName).toBe("my-cool-tool");
    expect(unknown.fallbackIcon).toBe("[MY-COOL-TOOL]");
  });

  it("should have classifications for all standard OpenCode tools", () => {
    const standardTools = ["read", "write", "edit", "glob", "grep", "bash", "task"];
    for (const tool of standardTools) {
      expect(TOOL_CLASSIFICATIONS[tool]).toBeDefined();
    }
  });
});
