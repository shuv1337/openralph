import type { ErrorHandlingConfig } from './config/schema';

export interface ErrorContext {
  taskId?: string;
  iteration: number;
  error: Error;
  timestamp: Date;
}

export type ErrorStrategy = 'retry' | 'skip' | 'abort';

export interface ErrorResult {
  strategy: ErrorStrategy;
  shouldContinue: boolean;
  retryCount: number;
  delayMs: number;
  message: string;
}

export class ErrorHandler {
  private config: ErrorHandlingConfig;
  private retryCounts: Map<string, number> = new Map();
  
  constructor(config: ErrorHandlingConfig) {
    this.config = config;
  }
  
  handleError(context: ErrorContext): ErrorResult {
    const key = context.taskId || `iteration-${context.iteration}`;
    const currentRetries = this.retryCounts.get(key) || 0;
    
    switch (this.config.strategy) {
      case 'retry':
        return this.handleRetryStrategy(context, currentRetries, key);
      case 'skip':
        return this.handleSkipStrategy(context);
      case 'abort':
        return this.handleAbortStrategy(context);
      default:
        return this.createResult('abort', false, 0, 0, 'Unknown error strategy');
    }
  }
  
  private handleRetryStrategy(
    context: ErrorContext,
    currentRetries: number,
    key: string
  ): ErrorResult {
    if (currentRetries >= this.config.maxRetries) {
      this.retryCounts.delete(key);
      return this.createResult(
        'abort',
        false,
        currentRetries,
        0,
        `Max retries (${this.config.maxRetries}) exceeded`
      );
    }
    
    const delayMs = this.calculateBackoff(currentRetries);
    const newRetryCount = currentRetries + 1;
    this.retryCounts.set(key, newRetryCount);
    
    return this.createResult(
      'retry',
      true,
      newRetryCount,
      delayMs,
      `Retry attempt ${newRetryCount}/${this.config.maxRetries} after ${delayMs}ms`
    );
  }
  
  private handleSkipStrategy(context: ErrorContext): ErrorResult {
    this.retryCounts.delete(context.taskId || `iteration-${context.iteration}`);
    return this.createResult(
      'skip',
      true,
      0,
      0,
      `Skipping task due to error: ${context.error.message}`
    );
  }
  
  private handleAbortStrategy(context: ErrorContext): ErrorResult {
    this.retryCounts.delete(context.taskId || `iteration-${context.iteration}`);
    return this.createResult(
      'abort',
      false,
      0,
      0,
      `Aborting due to error: ${context.error.message}`
    );
  }
  
  private calculateBackoff(retryCount: number): number {
    const baseDelay = this.config.retryDelayMs;
    const multiplier = this.config.backoffMultiplier || 2;
    return Math.min(baseDelay * Math.pow(multiplier, retryCount), 60000);
  }
  
  private createResult(
    strategy: ErrorStrategy,
    shouldContinue: boolean,
    retryCount: number,
    delayMs: number,
    message: string
  ): ErrorResult {
    return {
      strategy,
      shouldContinue,
      retryCount,
      delayMs,
      message,
    };
  }
  
  clearRetryCount(key?: string): void {
    if (key) {
      this.retryCounts.delete(key);
    } else {
      this.retryCounts.clear();
    }
  }
}
