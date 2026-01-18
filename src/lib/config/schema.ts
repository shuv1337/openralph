import { z } from 'zod';

export const ErrorHandlingSchema = z.object({
  strategy: z.enum(['retry', 'skip', 'abort']).default('retry'),
  maxRetries: z.number().int().min(0).max(10).default(3),
  retryDelayMs: z.number().int().min(0).max(60000).default(5000),
  backoffMultiplier: z.number().positive().default(2),
});

export const SessionSchema = z.object({
  lockFile: z.string().default('.ralph-lock'),
  persistenceEnabled: z.boolean().default(false),
  logDirectory: z.string().default('.ralph-logs'),
});

export const UISchema = z.object({
  theme: z.string().default('default'),
  showProgressDashboard: z.boolean().default(true),
  compactMode: z.boolean().default(false),
  // Buffer size configuration
  maxTerminalBuffer: z.number().int().min(1000).max(500000).default(20000),
  maxParsedOutputSize: z.number().int().min(1000).max(1000000).default(100000),
  outputBufferTrimStrategy: z.enum(['head', 'tail']).default('tail'),
});

/**
 * Fallback agent configuration for rate limit handling.
 * Maps primary agent/model names to their fallback alternatives.
 * Users configure their own mappings - no defaults provided.
 */
export const FallbackAgentsSchema = z.record(z.string(), z.string()).default({});

export const ConfigSchema = z.object({
  // Core settings
  model: z.string().default('opencode/claude-opus-4-5'),
  adapter: z.enum(['opencode-server', 'opencode-run', 'codex']).default('opencode-server'),
  plan: z.string().default('prd.json'),
  progress: z.string().default('progress.txt'),
  prompt: z.string().optional(),
  promptFile: z.string().default('.ralph-prompt.md'),
  server: z.string().url().optional(),
  serverTimeout: z.number().positive().default(5000),
  agent: z.string().optional(),
  
  // Execution settings
  headless: z.boolean().default(false),
  format: z.string().default('text'),
  timestamps: z.boolean().default(false),
  yes: z.boolean().default(false),
  autoReset: z.boolean().default(true),
  maxIterations: z.number().int().positive().optional(),
  maxTime: z.number().int().positive().optional(),

  // Terminal launcher preferences
  preferredTerminal: z.string().optional(),
  customTerminalCommand: z.string().optional(),

  // Error handling
  errorHandling: ErrorHandlingSchema.default({
    strategy: 'retry',
    maxRetries: 3,
    retryDelayMs: 5000,
    backoffMultiplier: 2,
  }),
  
  // Session settings
  session: SessionSchema.default({
    lockFile: '.ralph-lock',
    persistenceEnabled: false,
    logDirectory: '.ralph-logs',
  }),
  
  // UI settings
  ui: UISchema.default({
    theme: 'default',
    showProgressDashboard: true,
    compactMode: false,
    maxTerminalBuffer: 20000,
    maxParsedOutputSize: 100000,
    outputBufferTrimStrategy: 'tail',
  }),

  // Rate limit fallback agents
  // Maps primary agent/model to fallback when rate limited
  fallbackAgents: FallbackAgentsSchema,
}).strict();

export type UserConfig = z.infer<typeof ConfigSchema>;
export type ErrorHandlingConfig = z.infer<typeof ErrorHandlingSchema>;
export type SessionConfig = z.infer<typeof SessionSchema>;
export type UIConfig = z.infer<typeof UISchema>;
export type FallbackAgentsConfig = z.infer<typeof FallbackAgentsSchema>;
