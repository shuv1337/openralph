import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

/** Default lock file name used for session locking */
export const LOCK_FILE = ".ralph-lock";

export interface LockFile {
  pid: number;
  sessionId: string;
  startedAt: string;
  version: number;
}

export interface LockResult {
  acquired: boolean;
  error?: string;
  existingPid?: number;
}

export class SessionLock {
  private lockPath: string;
  private lockData: LockFile | null = null;
  
  constructor(cwd: string, lockFileName: string = '.ralph-lock') {
    this.lockPath = join(cwd, lockFileName);
  }
  
  async acquire(force: boolean = false): Promise<LockResult> {
    try {
      // Check for existing lock
      if (existsSync(this.lockPath)) {
        const existingData = await this.readLockFile();
        
        if (existingData && this.isProcessRunning(existingData.pid)) {
          if (force) {
            console.warn(`Force acquiring lock from PID ${existingData.pid}`);
          } else {
            return {
              acquired: false,
              error: 'Another Ralph instance is running',
              existingPid: existingData.pid,
            };
          }
        }
        
        // Process is not running, stale lock - clean up
        console.warn('Removing stale lock file');
        try {
          unlinkSync(this.lockPath);
        } catch (e) {
          // Ignore errors during unlink of stale lock
        }
      }
      
      // Create new lock
      this.lockData = {
        pid: process.pid,
        sessionId: this.generateSessionId(),
        startedAt: new Date().toISOString(),
        version: 1,
      };
      
      writeFileSync(this.lockPath, JSON.stringify(this.lockData, null, 2));
      
      return { acquired: true };
    } catch (error: any) {
      return {
        acquired: false,
        error: `Failed to acquire lock: ${error.message}`,
      };
    }
  }
  
  async release(): Promise<void> {
    if (this.lockData && existsSync(this.lockPath)) {
      try {
        unlinkSync(this.lockPath);
        this.lockData = null;
      } catch (error: any) {
        console.warn(`Warning: Failed to release lock: ${error.message}`);
      }
    }
  }
  
  private async readLockFile(): Promise<LockFile | null> {
    try {
      const content = readFileSync(this.lockPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
  
  private isProcessRunning(pid: number): boolean {
    if (pid === process.pid) return true;
    try {
      // Signal 0 checks for process existence without actually killing it
      // Supported on both Unix and Windows in Node.js/Bun
      process.kill(pid, 0);
      return true;
    } catch (e: any) {
      // ESRCH means the process doesn't exist
      return false;
    }
  }
  
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
