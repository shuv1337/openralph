import { describe, it, expect } from "bun:test";
import { calculateSimilarity, isRedundantTask } from "../../src/lib/task-deduplication";

describe("task-deduplication", () => {
  describe("calculateSimilarity", () => {
    it("should return 1.0 for identical strings", () => {
      expect(calculateSimilarity("Implement user auth", "Implement user auth")).toBe(1.0);
    });

    it("should return 0.0 for completely different strings", () => {
      expect(calculateSimilarity("Implement user auth", "Fix layout issues")).toBe(0.0);
    });

    it("should return high similarity for slight variations", () => {
      const sim = calculateSimilarity(
        "Implement user authentication logic",
        "Verify user authentication works"
      );
      // Both tokenize to ['user', 'authentication', 'logic'] vs ['user', 'authentication', 'works']
      // Intersection: ['user', 'authentication'] (2)
      // Union: ['user', 'authentication', 'logic', 'works'] (4)
      // Sim: 0.5
      expect(sim).toBeGreaterThanOrEqual(0.5);
    });

    it("should ignore punctuation and case", () => {
      expect(calculateSimilarity("User Auth!!!", "user auth")).toBe(1.0);
    });
  });

  describe("isRedundantTask", () => {
    const existing = [
      "Implement the main dashboard view",
      "Setup database connection",
      "Configure dark mode"
    ];

    it("should identify exact duplicates", () => {
      expect(isRedundantTask("Setup database connection", existing)).toBe(true);
    });

    it("should identify fuzzy duplicates", () => {
      expect(isRedundantTask("Verify the main dashboard view works", existing)).toBe(true);
      expect(isRedundantTask("Enable dark mode configuration", existing)).toBe(true);
    });

    it("should allow distinct tasks", () => {
      expect(isRedundantTask("Add unit tests for auth", existing)).toBe(false);
      expect(isRedundantTask("Fix navigation bug", existing)).toBe(false);
    });
  });
});
