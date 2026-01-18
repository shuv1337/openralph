import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SessionLock } from "../../src/lib/lock";
import { unlinkSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

const LOCK_FILE = ".ralph-lock-test";
const TEST_CWD = process.cwd();
const LOCK_PATH = join(TEST_CWD, LOCK_FILE);

function cleanupLockFile() {
  if (existsSync(LOCK_PATH)) {
    try {
      unlinkSync(LOCK_PATH);
    } catch {
      // Ignore
    }
  }
}

describe("SessionLock", () => {
  beforeEach(() => {
    cleanupLockFile();
  });

  afterEach(() => {
    cleanupLockFile();
  });

  it("should acquire lock when no lock file exists", async () => {
    const lock = new SessionLock(TEST_CWD, LOCK_FILE);
    const result = await lock.acquire();
    
    expect(result.acquired).toBe(true);
    expect(existsSync(LOCK_PATH)).toBe(true);
  });

  it("should fail to acquire lock when valid lock file exists", async () => {
    const lock1 = new SessionLock(TEST_CWD, LOCK_FILE);
    await lock1.acquire();
    
    const lock2 = new SessionLock(TEST_CWD, LOCK_FILE);
    const result = await lock2.acquire();
    
    expect(result.acquired).toBe(false);
    expect(result.error).toBe("Another Ralph instance is running");
    expect(result.existingPid).toBe(process.pid);
  });

  it("should acquire lock if force is true even if valid lock exists", async () => {
    const lock1 = new SessionLock(TEST_CWD, LOCK_FILE);
    await lock1.acquire();
    
    const lock2 = new SessionLock(TEST_CWD, LOCK_FILE);
    const result = await lock2.acquire(true);
    
    expect(result.acquired).toBe(true);
  });

  it("should release lock properly", async () => {
    const lock = new SessionLock(TEST_CWD, LOCK_FILE);
    await lock.acquire();
    expect(existsSync(LOCK_PATH)).toBe(true);
    
    await lock.release();
    expect(existsSync(LOCK_PATH)).toBe(false);
  });

  it("should detect stale locks", async () => {
    // Write a lock file with a non-existent PID
    const staleData = {
      pid: 999999,
      sessionId: "stale-session",
      startedAt: new Date().toISOString(),
      version: 1
    };
    writeFileSync(LOCK_PATH, JSON.stringify(staleData));
    
    const lock = new SessionLock(TEST_CWD, LOCK_FILE);
    const result = await lock.acquire();
    
    expect(result.acquired).toBe(true);
    const newData = JSON.parse(readFileSync(LOCK_PATH, 'utf-8'));
    expect(newData.pid).toBe(process.pid);
  });
});
