import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadState, saveState, STATE_FILE, MAX_EVENTS, trimEvents, type PersistedState, type ToolEvent } from "../../src/state";
import { unlink } from "node:fs/promises";

describe("state management", () => {
  // Clean up state file before and after each test
  beforeEach(async () => {
    try {
      await unlink(STATE_FILE);
    } catch {
      // File doesn't exist, that's fine
    }
  });

  afterEach(async () => {
    try {
      await unlink(STATE_FILE);
    } catch {
      // File doesn't exist, that's fine
    }
  });

  describe("loadState()", () => {
    it("should return null when file doesn't exist", async () => {
      const result = await loadState();
      expect(result).toBeNull();
    });

    it("should not throw when file doesn't exist", async () => {
      // This test ensures loadState handles missing file gracefully
      await expect(loadState()).resolves.toBeNull();
    });

    it("should return parsed PersistedState with valid state file", async () => {
      const validState: PersistedState = {
        startTime: 1704067200000, // 2024-01-01T00:00:00.000Z
        initialCommitHash: "abc123def456789012345678901234567890abcd",
        iterationTimes: [60000, 120000, 90000],
        planFile: "plan.md",
        totalPausedMs: 0,
        lastSaveTime: 1704067201000,
      };

      // Create the state file with valid JSON
      await Bun.write(STATE_FILE, JSON.stringify(validState, null, 2));

      const result = await loadState();

      expect(result).not.toBeNull();
      expect(result).toEqual(validState);
      expect(result!.startTime).toBe(1704067200000);
      expect(result!.initialCommitHash).toBe("abc123def456789012345678901234567890abcd");
      expect(result!.iterationTimes).toEqual([60000, 120000, 90000]);
      expect(result!.planFile).toBe("plan.md");
      expect(result!.totalPausedMs).toBe(0);
      expect(result!.lastSaveTime).toBe(1704067201000);
    });
  });

  describe("saveState()", () => {
    it("should create valid JSON with all required fields", async () => {
      const state: PersistedState = {
        startTime: 1704067200000,
        initialCommitHash: "abc123def456789012345678901234567890abcd",
        iterationTimes: [60000, 120000],
        planFile: "plan.md",
        totalPausedMs: 1000,
        lastSaveTime: 1704067202000,
      };

      await saveState(state);

      // Read the file as text to verify it's valid JSON
      const file = Bun.file(STATE_FILE);
      const exists = await file.exists();
      expect(exists).toBe(true);

      const content = await file.text();

      // Should be valid JSON (won't throw)
      const parsed = JSON.parse(content);

      // Verify all required fields are present
      expect(parsed).toHaveProperty("startTime");
      expect(parsed).toHaveProperty("initialCommitHash");
      expect(parsed).toHaveProperty("iterationTimes");
      expect(parsed).toHaveProperty("planFile");
      expect(parsed).toHaveProperty("totalPausedMs");
      expect(parsed).toHaveProperty("lastSaveTime");

      // Verify values are correct
      expect(parsed.startTime).toBe(1704067200000);
      expect(parsed.initialCommitHash).toBe("abc123def456789012345678901234567890abcd");
      expect(parsed.iterationTimes).toEqual([60000, 120000]);
      expect(parsed.planFile).toBe("plan.md");
      expect(parsed.totalPausedMs).toBe(1000);
      expect(parsed.lastSaveTime).toBe(1704067202000);
    });

    it("should overwrite existing state with new values", async () => {
      const firstState: PersistedState = {
        startTime: 1704067200000,
        initialCommitHash: "abc123def456789012345678901234567890abcd",
        iterationTimes: [60000],
        planFile: "old-plan.md",
        totalPausedMs: 0,
        lastSaveTime: 1704067201000,
      };

      const secondState: PersistedState = {
        startTime: 1704153600000, // Different timestamp
        initialCommitHash: "def456789012345678901234567890abcdef12",
        iterationTimes: [90000, 120000, 150000],
        planFile: "new-plan.md",
        totalPausedMs: 2000,
        lastSaveTime: 1704153601000,
      };

      // Save first state
      await saveState(firstState);

      // Save second state (should overwrite)
      await saveState(secondState);

      // Load and verify the second state is what's persisted
      const loaded = await loadState();

      expect(loaded).not.toBeNull();
      expect(loaded!.startTime).toBe(secondState.startTime);
      expect(loaded!.initialCommitHash).toBe(secondState.initialCommitHash);
      expect(loaded!.iterationTimes).toEqual(secondState.iterationTimes);
      expect(loaded!.planFile).toBe(secondState.planFile);
      expect(loaded!.totalPausedMs).toBe(secondState.totalPausedMs);
      expect(loaded!.lastSaveTime).toBe(secondState.lastSaveTime);

      // Also verify the first state values are NOT present
      expect(loaded!.startTime).not.toBe(firstState.startTime);
      expect(loaded!.initialCommitHash).not.toBe(firstState.initialCommitHash);
      expect(loaded!.iterationTimes).not.toEqual(firstState.iterationTimes);
      expect(loaded!.planFile).not.toBe(firstState.planFile);
    });
  });

  describe("state roundtrip", () => {
    it("should preserve all state fields through save/load cycle", async () => {
      const originalState: PersistedState = {
        startTime: 1704067200000,
        initialCommitHash: "abc123def456789012345678901234567890abcd",
        iterationTimes: [60000, 120000, 90000],
        planFile: "plan.md",
        totalPausedMs: 3000,
        lastSaveTime: 1704067205000,
      };

      // Save the state
      await saveState(originalState);

      // Load it back
      const loadedState = await loadState();

      // Verify loaded state matches original exactly
      expect(loadedState).not.toBeNull();
      expect(loadedState).toEqual(originalState);
    });

    it("should preserve empty iterationTimes array through roundtrip", async () => {
      const originalState: PersistedState = {
        startTime: 1704067200000,
        initialCommitHash: "abc123def456789012345678901234567890abcd",
        iterationTimes: [],
        planFile: "plan.md",
        totalPausedMs: 0,
        lastSaveTime: 1704067200001,
      };

      await saveState(originalState);
      const loadedState = await loadState();

      expect(loadedState).toEqual(originalState);
      expect(loadedState!.iterationTimes).toEqual([]);
    });

    it("should preserve large iterationTimes array through roundtrip", async () => {
      const largeIterationTimes = Array.from({ length: 100 }, (_, i) => (i + 1) * 10000);
      const originalState: PersistedState = {
        startTime: 1704067200000,
        initialCommitHash: "abc123def456789012345678901234567890abcd",
        iterationTimes: largeIterationTimes,
        planFile: "plan.md",
        totalPausedMs: 123456,
        lastSaveTime: 1704067200002,
      };

      await saveState(originalState);
      const loadedState = await loadState();

      expect(loadedState).toEqual(originalState);
      expect(loadedState!.iterationTimes).toHaveLength(100);
    });

    it("should preserve special characters in planFile through roundtrip", async () => {
      const originalState: PersistedState = {
        startTime: 1704067200000,
        initialCommitHash: "abc123def456789012345678901234567890abcd",
        iterationTimes: [60000],
        planFile: "plans/feature-plan (v2).md",
        totalPausedMs: 0,
        lastSaveTime: 1704067200003,
      };

      await saveState(originalState);
      const loadedState = await loadState();

      expect(loadedState).toEqual(originalState);
      expect(loadedState!.planFile).toBe("plans/feature-plan (v2).md");
    });
  });

  describe("trimEvents()", () => {
    // Helper to create mock ToolEvent
    function createMockEvent(iteration: number, timestamp: number): ToolEvent {
      return {
        iteration,
        type: "tool",
        icon: "🔧",
        text: `Event at ${timestamp}`,
        timestamp,
      };
    }

    it("should return same array when under MAX_EVENTS limit", () => {
      const events: ToolEvent[] = [
        createMockEvent(1, 1000),
        createMockEvent(1, 2000),
        createMockEvent(1, 3000),
      ];

      const result = trimEvents(events);

      expect(result).toHaveLength(3);
      expect(result).toEqual(events);
    });

    it("should return same array when exactly at MAX_EVENTS limit", () => {
      const events: ToolEvent[] = Array.from({ length: MAX_EVENTS }, (_, i) =>
        createMockEvent(Math.floor(i / 10) + 1, 1000 + i)
      );

      const result = trimEvents(events);

      expect(result).toHaveLength(MAX_EVENTS);
      expect(result).toEqual(events);
    });

    it("should trim to MAX_EVENTS keeping most recent events", () => {
      const extraEvents = 50;
      const totalEvents = MAX_EVENTS + extraEvents;
      const events: ToolEvent[] = Array.from({ length: totalEvents }, (_, i) =>
        createMockEvent(Math.floor(i / 10) + 1, 1000 + i)
      );

      const result = trimEvents(events);

      expect(result).toHaveLength(MAX_EVENTS);
      // Should keep the last MAX_EVENTS (indices extraEvents to totalEvents-1)
      expect(result[0].timestamp).toBe(1000 + extraEvents);
      expect(result[MAX_EVENTS - 1].timestamp).toBe(1000 + totalEvents - 1);
    });

    it("should preserve event order after trimming", () => {
      const events: ToolEvent[] = Array.from({ length: MAX_EVENTS + 10 }, (_, i) =>
        createMockEvent(i + 1, 1000 + i * 100)
      );

      const result = trimEvents(events);

      // Check that events are in ascending timestamp order
      for (let i = 1; i < result.length; i++) {
        expect(result[i].timestamp).toBeGreaterThan(result[i - 1].timestamp);
      }
    });

    it("should handle empty array", () => {
      const result = trimEvents([]);

      expect(result).toHaveLength(0);
      expect(result).toEqual([]);
    });

    it("should handle single event", () => {
      const events: ToolEvent[] = [createMockEvent(1, 1000)];

      const result = trimEvents(events);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(events[0]);
    });

    it("should correctly trim when one over MAX_EVENTS", () => {
      const events: ToolEvent[] = Array.from({ length: MAX_EVENTS + 1 }, (_, i) =>
        createMockEvent(1, 1000 + i)
      );

      const result = trimEvents(events);

      expect(result).toHaveLength(MAX_EVENTS);
      // First event (timestamp 1000) should be dropped
      expect(result[0].timestamp).toBe(1001);
      expect(result[MAX_EVENTS - 1].timestamp).toBe(1000 + MAX_EVENTS);
    });

    it("should preserve all event properties after trimming", () => {
      const events: ToolEvent[] = Array.from({ length: MAX_EVENTS + 5 }, (_, i) => ({
        iteration: i + 1,
        type: i % 2 === 0 ? "tool" : "separator" as const,
        icon: i % 2 === 0 ? "🔧" : undefined,
        text: `Event ${i}`,
        timestamp: 1000 + i,
        duration: i % 2 === 1 ? 5000 : undefined,
        commitCount: i % 2 === 1 ? 2 : undefined,
      }));

      const result = trimEvents(events);

      // Check that the 6th event (index 5, which becomes index 0 after trim) has all properties
      const expectedIndex = 5;
      expect(result[0].iteration).toBe(events[expectedIndex].iteration);
      expect(result[0].type).toBe(events[expectedIndex].type);
      expect(result[0].icon).toBe(events[expectedIndex].icon);
      expect(result[0].text).toBe(events[expectedIndex].text);
      expect(result[0].timestamp).toBe(events[expectedIndex].timestamp);
      expect(result[0].duration).toBe(events[expectedIndex].duration);
      expect(result[0].commitCount).toBe(events[expectedIndex].commitCount);
    });

    it("should keep memory bounded after 20+ iterations worth of events", () => {
      // Simulate 25 iterations with ~50 events per iteration
      // Total: 1250 events, far exceeding MAX_EVENTS (200)
      const NUM_ITERATIONS = 25;
      const EVENTS_PER_ITERATION = 50;
      
      let events: ToolEvent[] = [];
      
      for (let iteration = 1; iteration <= NUM_ITERATIONS; iteration++) {
        // Add separator at start of iteration
        events.push({
          iteration,
          type: "separator",
          text: `iteration ${iteration}`,
          timestamp: iteration * 100000,
          duration: 60000,
          commitCount: 1,
        });
        
        // Add tool events for this iteration
        for (let e = 0; e < EVENTS_PER_ITERATION; e++) {
          events.push({
            iteration,
            type: "tool",
            icon: "🔧",
            text: `Tool event ${e} for iteration ${iteration}`,
            timestamp: iteration * 100000 + e + 1,
          });
          
          // Trim after each event addition (simulating real behavior in onEvent)
          events = trimEvents(events);
        }
      }
      
      // After 25 iterations * 51 events/iteration = 1275 events added
      // Events array should be capped at MAX_EVENTS
      expect(events.length).toBeLessThanOrEqual(MAX_EVENTS);
      expect(events.length).toBe(MAX_EVENTS);
      
      // Verify the most recent events are kept (from later iterations)
      const lastEvent = events[events.length - 1];
      expect(lastEvent.iteration).toBe(NUM_ITERATIONS);
      
      // Verify old events from early iterations are dropped
      const firstEvent = events[0];
      // First event should NOT be from iteration 1 (those were trimmed)
      expect(firstEvent.iteration).toBeGreaterThan(1);
      
      // The earliest iteration in the bounded array should be calculable:
      // We have MAX_EVENTS=200 events, ~51 events per iteration
      // So we'd expect events from roughly the last 4 iterations
      const minIteration = Math.min(...events.map(e => e.iteration));
      expect(minIteration).toBeGreaterThan(NUM_ITERATIONS - 5);
    });
  });
});
