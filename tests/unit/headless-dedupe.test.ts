import { describe, it, expect, beforeEach, mock } from "bun:test";
import { HeadlessRunner } from "../../src/headless/runner";

describe("HeadlessRunner Deduplication", () => {
  let runner: HeadlessRunner;
  let mockWrite: any;

  beforeEach(() => {
    mockWrite = mock((text: string) => {});
    runner = new HeadlessRunner({
      format: "jsonl",
      timestamps: false,
      limits: {},
      write: mockWrite,
    });
  });

  it("should deduplicate identical stats events", () => {
    // Accessing private emitStats via any for testing
    const runnerAny = runner as any;
    
    // Mock output coordinator since we're testing the runner's logic
    runnerAny.output = {
      emit: mock((event: any) => {
        if (event.type === "stats") {
          mockWrite(JSON.stringify(event));
        }
      }),
      showBanner: mock(() => {}),
      finalize: mock(() => {}),
    };

    // Set initial stats
    runnerAny.stats.commits = 1;
    runnerAny.stats.linesAdded = 10;
    runnerAny.stats.linesRemoved = 5;

    // First emission should occur
    runnerAny.emitStats();
    expect(mockWrite).toHaveBeenCalledTimes(1);
    const firstOutput = JSON.parse(mockWrite.mock.calls[0][0]);
    expect(firstOutput.type).toBe("stats");
    expect(firstOutput.commits).toBe(1);

    // Second emission with identical stats should be ignored
    runnerAny.emitStats();
    expect(mockWrite).toHaveBeenCalledTimes(1);

    // Emission after change should occur
    runnerAny.stats.commits = 2;
    runnerAny.emitStats();
    expect(mockWrite).toHaveBeenCalledTimes(2);
    const secondOutput = JSON.parse(mockWrite.mock.calls[1][0]);
    expect(secondOutput.commits).toBe(2);
  });
});
