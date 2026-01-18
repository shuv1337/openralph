/**
 * Rate limit detection and handling utilities.
 * Adopted from Ralph TUI with cross-platform support and fallback mechanisms.
 */

// =====================================================
// RATE LIMIT TYPES
// =====================================================

/**
 * Result of rate limit detection.
 */
export interface RateLimitDetectionResult {
  /** Whether a rate limit condition was detected */
  isRateLimit: boolean;
  /** Extracted message describing the rate limit (if detected) */
  message?: string;
  /** Suggested retry delay in seconds (if parseable from the message) */
  retryAfter?: number;
}

/**
 * Input for rate limit detection.
 */
export interface RateLimitDetectionInput {
  /** Standard error output from the agent */
  stderr: string;
  /** Standard output from the agent (some agents emit errors here) */
  stdout?: string;
  /** Exit code from the agent process */
  exitCode?: number;
  /** Agent plugin identifier (e.g., 'claude', 'opencode') */
  agentId?: string;
}

/**
 * Pattern definition for matching rate limit indicators.
 */
interface RateLimitPattern {
  /** Regular expression to match against output */
  pattern: RegExp;
  /** Optional pattern to extract retry-after duration */
  retryAfterPattern?: RegExp;
}

// =====================================================
// COMMON RATE LIMIT PATTERNS
// =====================================================

/**
 * Common rate limit patterns that apply to most agents.
 */
const COMMON_PATTERNS: RateLimitPattern[] = [
  // HTTP 429 status code - must appear in error/HTTP context
  {
    pattern: /(?:HTTP|status|error|code|response)[\s:]*429|429\s*(?:too many|rate limit|error)/i,
    retryAfterPattern: /retry[- ]?after[:\s]+(\d+)\s*s/i,
  },
  // Generic rate limit phrases (with separator to avoid package name matches)
  {
    pattern: /rate[- ]limit/i,
    retryAfterPattern: /retry[- ]?after[:\s]+(\d+)\s*s/i,
  },
  // Too many requests
  {
    pattern: /too many requests/i,
    retryAfterPattern: /(\d+)\s*seconds?/i,
  },
  // Quota exceeded
  {
    pattern: /quota[- ]?exceeded/i,
    retryAfterPattern: /(\d+)\s*seconds?/i,
  },
  // Overloaded
  {
    pattern: /\boverloaded\b/i,
    retryAfterPattern: /(\d+)\s*seconds?/i,
  },
];

/**
 * Agent-specific pattern sets.
 * These are checked in addition to common patterns for specific agents.
 */
const AGENT_SPECIFIC_PATTERNS: Record<string, RateLimitPattern[]> = {
  claude: [
    // Anthropic-specific error messages
    {
      pattern: /anthropic.*rate[- ]?limit/i,
      retryAfterPattern: /retry[- ]?after[:\s]+(\d+)\s*s/i,
    },
    {
      pattern: /API rate limit exceeded/i,
      retryAfterPattern: /wait[:\s]+(\d+)\s*s/i,
    },
    // Claude-specific overload message
    {
      pattern: /claude.*is currently overloaded/i,
      retryAfterPattern: /(\d+)\s*seconds?/i,
    },
    // API error with rate limiting
    {
      pattern: /api[- ]?error.*429/i,
      retryAfterPattern: /retry[- ]?after[:\s]+(\d+)/i,
    },
  ],
  opencode: [
    // OpenAI-specific error messages
    {
      pattern: /openai.*rate[- ]?limit/i,
      retryAfterPattern: /retry[- ]?after[:\s]+(\d+)\s*s/i,
    },
    {
      pattern: /tokens per minute/i,
      retryAfterPattern: /(\d+)\s*seconds?/i,
    },
    {
      pattern: /requests per minute/i,
      retryAfterPattern: /(\d+)\s*seconds?/i,
    },
    // Azure OpenAI specific
    {
      pattern: /azure.*throttl/i,
      retryAfterPattern: /(\d+)\s*seconds?/i,
    },
  ],
};

/**
 * Exit codes that may indicate rate limiting when combined with pattern matches.
 */
const RATE_LIMIT_EXIT_CODES = new Set([1, 2, 429]);

// =====================================================
// RATE LIMIT DETECTOR CLASS
// =====================================================

/**
 * Detects rate limit conditions from agent output.
 * Examines stderr, stdout, and exit codes to determine if an agent
 * encountered rate limiting from its backing API.
 * 
 * Cross-platform: Works on Windows, macOS, and Linux.
 */
export class RateLimitDetector {
  /**
   * Detect if the agent output indicates a rate limit condition.
   *
   * @param input - The detection input containing stderr, stdout, exitCode, and agentId
   * @returns Detection result with isRateLimit flag and optional message/retryAfter
   */
  detect(input: RateLimitDetectionInput): RateLimitDetectionResult {
    const { stderr, exitCode, agentId } = input;

    // IMPORTANT: Only check stderr for rate limit detection.
    // Checking stdout causes false positives when agents output code containing
    // words like "rate limit", "429", etc.
    const outputToCheck = stderr;

    // If stderr is empty and exit code is 0, definitely not a rate limit
    if (!outputToCheck.trim() && exitCode === 0) {
      return { isRateLimit: false };
    }

    // Get patterns to check: common + agent-specific
    const patterns = this.getPatternsForAgent(agentId);

    // Check each pattern against stderr only
    for (const { pattern, retryAfterPattern } of patterns) {
      if (pattern.test(outputToCheck)) {
        // Found a match - extract message and retryAfter
        const message = this.extractMessage(outputToCheck, pattern);
        const retryAfter = retryAfterPattern
          ? this.extractRetryAfter(outputToCheck, retryAfterPattern)
          : undefined;

        return {
          isRateLimit: true,
          message,
          retryAfter,
        };
      }
    }

    // Check exit code as secondary indicator
    if (exitCode !== undefined && exitCode !== 0) {
      const looseMatch = this.looseRateLimitCheck(outputToCheck);
      if (looseMatch && RATE_LIMIT_EXIT_CODES.has(exitCode)) {
        return {
          isRateLimit: true,
          message: looseMatch,
          retryAfter: this.extractAnyRetryAfter(outputToCheck),
        };
      }
    }

    return { isRateLimit: false };
  }

  /**
   * Get all applicable patterns for a given agent.
   */
  private getPatternsForAgent(agentId?: string): RateLimitPattern[] {
    const patterns = [...COMMON_PATTERNS];

    if (agentId && AGENT_SPECIFIC_PATTERNS[agentId]) {
      patterns.push(...AGENT_SPECIFIC_PATTERNS[agentId]);
    }

    return patterns;
  }

  /**
   * Extract a relevant message snippet around the matched pattern.
   */
  private extractMessage(output: string, pattern: RegExp): string {
    const match = output.match(pattern);
    if (!match) {
      return "Rate limit detected";
    }

    // Get context around the match
    const matchIndex = match.index ?? 0;
    const start = Math.max(0, matchIndex - 50);
    const end = Math.min(output.length, matchIndex + match[0].length + 100);

    let message = output.slice(start, end).trim();

    // Clean up the message
    message = message.replace(/\s+/g, " ");

    // Truncate if too long
    if (message.length > 200) {
      message = message.slice(0, 200) + "...";
    }

    return message;
  }

  /**
   * Extract retry-after duration in seconds from output.
   */
  private extractRetryAfter(output: string, pattern: RegExp): number | undefined {
    const match = output.match(pattern);
    if (match && match[1]) {
      const seconds = parseInt(match[1], 10);
      if (!isNaN(seconds) && seconds > 0 && seconds < 3600) {
        return seconds;
      }
    }
    return undefined;
  }

  /**
   * Try to extract any retry-after value from the output.
   */
  private extractAnyRetryAfter(output: string): number | undefined {
    const patterns = [
      /retry[- ]?after[:\s]+(\d+)\s*s/i,
      /wait[:\s]+(\d+)\s*s/i,
      /try again in[:\s]+(\d+)\s*s/i,
      /(\d+)\s*seconds?(?:\s*(?:before|until|wait))/i,
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match && match[1]) {
        const seconds = parseInt(match[1], 10);
        if (!isNaN(seconds) && seconds > 0 && seconds < 3600) {
          return seconds;
        }
      }
    }

    return undefined;
  }

  /**
   * Loose check for rate-limit-like content.
   * Used as a fallback when strict patterns don't match.
   */
  private looseRateLimitCheck(output: string): string | null {
    const loosePatterns = [
      /throttl/i,
      /limit.*exceeded/i,
      /exceeded.*limit/i,
      /capacity/i,
      /backoff/i,
    ];

    for (const pattern of loosePatterns) {
      if (pattern.test(output)) {
        return this.extractMessage(output, pattern);
      }
    }

    return null;
  }
}

// =====================================================
// FALLBACK AGENT MAPPING (User Configurable)
// =====================================================

import { getFallbackAgent as getConfiguredFallback } from './config/loader';

/**
 * Get the fallback agent for a rate-limited primary agent.
 * 
 * Returns the user-configured fallback from config.json, or undefined
 * if no fallback is configured. Users must configure their own fallback
 * mappings via the command palette or config file.
 * 
 * @param primaryAgent - The name of the rate-limited agent
 * @returns The fallback agent to use, or undefined if not configured
 */
export function getFallbackAgent(primaryAgent: string): string | undefined {
  return getConfiguredFallback(primaryAgent);
}

// =====================================================
// SINGLETON INSTANCE
// =====================================================

/**
 * Shared rate limit detector instance.
 */
export const rateLimitDetector = new RateLimitDetector();
