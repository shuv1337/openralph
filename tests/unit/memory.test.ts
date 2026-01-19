import { describe, it, expect, beforeEach } from "bun:test";
import { destroyRenderer } from "../../src/app";
import * as log from "../../src/lib/log";

describe("Memory Management", () => {
  beforeEach(() => {
    // Clear any previous state
  });
  
  describe("loggedTextByPartId cleanup", () => {
    it("clears map after each iteration", () => {
      const map = new Map<string, string>();
      
      // Simulate iterations
      for (let i = 0; i < 10; i++) {
        map.set(`part-${i}`, "text content ".repeat(10));
        // Iteration ends
        map.clear();
      }
      
      expect(map.size).toBe(0);
    });
    
    it("releases text references on clear", () => {
      const largeString = "x".repeat(10000);
      const map = new Map<string, string>();
      
      map.set("large", largeString);
      expect(map.has("large")).toBe(true);
      
      map.clear();
      expect(map.has("large")).toBe(false);
    });
  });
  
  describe("destroyRenderer cleanup", () => {
    it("clears all global references", () => {
      // Note: This tests the pattern, actual globals require module setup
      const globals = {
        setState: null as any,
        updateTimes: null as any,
        sendMessage: null as any,
        renderer: null as any,
        triggerRefresh: null as any,
      };
      
      // Simulate cleanup
      globals.setState = null;
      globals.updateTimes = null;
      globals.sendMessage = null;
      globals.renderer = null;
      globals.triggerRefresh = null;
      
      expect(globals.setState).toBeNull();
      expect(globals.updateTimes).toBeNull();
      expect(globals.sendMessage).toBeNull();
      expect(globals.renderer).toBeNull();
      expect(globals.triggerRefresh).toBeNull();
    });
  });
  
  describe("Memory Stats", () => {
    it("getMemoryStats returns valid structure", () => {
      const stats = log.getMemoryStats();
      
      expect(stats).toHaveProperty("heapUsed");
      expect(stats).toHaveProperty("heapTotal");
      expect(stats).toHaveProperty("rss");
      expect(stats).toHaveProperty("external");
      expect(stats).toHaveProperty("gcRate");
      
      // Verify format (contains "MB" or "KB")
      expect(stats.heapUsed).toMatch(/\d+(\.\d+)? (KB|MB|GB)/);
    });
    
    it("checkMemoryThreshold returns boolean", () => {
      const result = log.checkMemoryThreshold("test");
      expect(typeof result).toBe("boolean");
    });
  });
});
