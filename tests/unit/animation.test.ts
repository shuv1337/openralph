import { describe, it, expect } from "bun:test";
import { getAnimation, ANIMATIONS } from "../../src/lib/animation-registry";

describe("Animation System", () => {
  it("should return correct animation definitions", () => {
    const spinner = getAnimation("spinner");
    expect(spinner).toBeDefined();
    expect(spinner?.type).toBe("spin");
    expect(spinner?.duration).toBe(800);

    const pulse = getAnimation("pulse");
    expect(pulse?.type).toBe("pulse");
  });

  it("should return null for unknown animations", () => {
    const unknown = getAnimation("non-existent");
    expect(unknown).toBeNull();
  });

  it("should have all required standard animations", () => {
    const required = ["spinner", "pulse", "blink", "progress", "typewriter"];
    for (const name of required) {
      expect(ANIMATIONS[name]).toBeDefined();
    }
  });
});
