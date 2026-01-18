import { describe, it, expect } from "bun:test";
import { ErrorHandler } from "../../src/lib/error-handler";
import type { ErrorHandlingConfig } from "../../src/lib/config/schema";

describe("ErrorHandler", () => {
  const defaultConfig: ErrorHandlingConfig = {
    strategy: "retry",
    maxRetries: 2,
    retryDelayMs: 100,
    backoffMultiplier: 2,
  };

  it("should handle retry strategy correctly", () => {
    const handler = new ErrorHandler(defaultConfig);
    const context = {
      taskId: "task-1",
      iteration: 1,
      error: new Error("Test error"),
      timestamp: new Date(),
    };

    // First retry
    let result = handler.handleError(context);
    expect(result.strategy).toBe("retry");
    expect(result.shouldContinue).toBe(true);
    expect(result.retryCount).toBe(1);
    expect(result.delayMs).toBeGreaterThanOrEqual(100);

    // Second retry
    result = handler.handleError(context);
    expect(result.retryCount).toBe(2);

    // Third call should abort (maxRetries = 2)
    result = handler.handleError(context);
    expect(result.strategy).toBe("abort");
    expect(result.shouldContinue).toBe(false);
    expect(result.message).toContain("Max retries (2) exceeded");
  });

  it("should handle skip strategy correctly", () => {
    const skipConfig: ErrorHandlingConfig = { ...defaultConfig, strategy: "skip" };
    const handler = new ErrorHandler(skipConfig);
    const context = {
      iteration: 1,
      error: new Error("Test error"),
      timestamp: new Date(),
    };

    const result = handler.handleError(context);
    expect(result.strategy).toBe("skip");
    expect(result.shouldContinue).toBe(true);
  });

  it("should handle abort strategy correctly", () => {
    const abortConfig: ErrorHandlingConfig = { ...defaultConfig, strategy: "abort" };
    const handler = new ErrorHandler(abortConfig);
    const context = {
      iteration: 1,
      error: new Error("Test error"),
      timestamp: new Date(),
    };

    const result = handler.handleError(context);
    expect(result.strategy).toBe("abort");
    expect(result.shouldContinue).toBe(false);
  });
});
