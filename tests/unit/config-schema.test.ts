import { describe, it, expect } from "bun:test";
import { ConfigSchema, FallbackAgentsSchema } from "../../src/lib/config/schema";

describe("ConfigSchema", () => {
  it("should validate a correct configuration", () => {
    const validConfig = {
      model: "test/model",
      adapter: "opencode-server",
      plan: "prd.json",
      progress: "progress.txt",
    };
    
    const result = ConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe("test/model");
    }
  });

  it("should apply defaults for missing fields", () => {
    const emptyConfig = {};
    const result = ConfigSchema.safeParse(emptyConfig);
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe("opencode/claude-opus-4-5");
      expect(result.data.adapter).toBe("opencode-server");
      expect(result.data.errorHandling.strategy).toBe("retry");
      expect(result.data.session.lockFile).toBe(".ralph-lock");
    }
  });

  it("should fail on invalid adapter", () => {
    const invalidConfig = {
      adapter: "invalid-adapter"
    };
    const result = ConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it("should fail on negative serverTimeout", () => {
    const invalidConfig = {
      serverTimeout: -100
    };
    const result = ConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it("should validate errorHandling nested object", () => {
    const config = {
      errorHandling: {
        strategy: "skip",
        maxRetries: 5
      }
    };
    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errorHandling.strategy).toBe("skip");
      expect(result.data.errorHandling.maxRetries).toBe(5);
      // Verify other defaults in the nested object
      expect(result.data.errorHandling.retryDelayMs).toBe(5000);
    }
  });
});

describe("FallbackAgentsSchema", () => {
  it("should default to empty object (no hardcoded fallbacks)", () => {
    const result = FallbackAgentsSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it("should accept valid string-to-string mappings", () => {
    const mappings = {
      "claude-opus-4": "claude-sonnet-4",
      "gpt-4o": "gpt-4o-mini",
    };
    const result = FallbackAgentsSchema.safeParse(mappings);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["claude-opus-4"]).toBe("claude-sonnet-4");
      expect(result.data["gpt-4o"]).toBe("gpt-4o-mini");
    }
  });

  it("should reject non-string values", () => {
    const invalidMappings = {
      "claude-opus-4": 123,
    };
    const result = FallbackAgentsSchema.safeParse(invalidMappings);
    expect(result.success).toBe(false);
  });

  it("should allow empty mappings", () => {
    const result = FallbackAgentsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data).length).toBe(0);
    }
  });
});

describe("ConfigSchema with fallbackAgents", () => {
  it("should include fallbackAgents in full config", () => {
    const config = {
      fallbackAgents: {
        "claude-opus-4": "claude-sonnet-4",
      }
    };
    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fallbackAgents["claude-opus-4"]).toBe("claude-sonnet-4");
    }
  });

  it("should default fallbackAgents to empty object in full config", () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fallbackAgents).toEqual({});
    }
  });
});
