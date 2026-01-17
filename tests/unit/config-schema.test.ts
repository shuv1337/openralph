import { describe, it, expect } from "bun:test";
import { ConfigSchema } from "../../src/lib/config/schema";

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
