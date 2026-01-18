import { ConfigSchema, UserConfig } from './schema';
import { loadEnvVariables } from './env';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import os from 'os';

export const CONFIG_DIR = join(os.homedir(), '.config', 'ralph');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function loadConfig(configPath?: string): UserConfig {
  const path = configPath ? join(process.cwd(), configPath) : CONFIG_PATH;
  
  let rawConfig: Partial<UserConfig> = {};
  
  // Load from file if exists
  if (existsSync(path)) {
    try {
      const content = readFileSync(path, 'utf-8');
      rawConfig = JSON.parse(content);
    } catch (error: any) {
      console.warn(`Warning: Failed to read config file: ${error.message}`);
    }
  }
  
  // Apply environment variable overrides
  const envConfig = loadEnvVariables();
  rawConfig = { ...rawConfig, ...envConfig };
  
  // Validate and return with defaults
  const result = ConfigSchema.safeParse(rawConfig);
  
  if (!result.success) {
    console.error('Configuration validation errors:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    throw new Error('Invalid configuration');
  }
  
  return result.data;
}

export function saveConfig(config: Partial<UserConfig>, configPath?: string): void {
  const path = configPath ? join(process.cwd(), configPath) : CONFIG_PATH;
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
}

export function updateConfig(updates: Partial<UserConfig>, configPath?: string): void {
  const existing = loadConfig(configPath);
  const merged = { ...existing, ...updates };
  saveConfig(merged, configPath);
}

export function setPreferredTerminal(terminalName: string): void {
  updateConfig({ preferredTerminal: terminalName });
}

export function getPreferredTerminal(): string | undefined {
  return loadConfig().preferredTerminal;
}

export function setCustomTerminalCommand(command: string): void {
  updateConfig({ customTerminalCommand: command });
}

export function getCustomTerminalCommand(): string | undefined {
  return loadConfig().customTerminalCommand;
}

export function clearTerminalPreferences(): void {
  const config = loadConfig();
  delete config.preferredTerminal;
  delete config.customTerminalCommand;
  saveConfig(config);
}

// =====================================================
// FALLBACK AGENT CONFIGURATION
// =====================================================

/**
 * Get the fallback agent for a rate-limited primary agent.
 * Checks user config first, then falls back to defaults.
 */
export function getFallbackAgent(primaryAgent: string): string | undefined {
  const config = loadConfig();
  const fallbackAgents = config.fallbackAgents || {};

  // Check for exact match
  if (fallbackAgents[primaryAgent]) {
    return fallbackAgents[primaryAgent];
  }

  // Check for partial match (e.g., "anthropic/claude-opus-4" -> "claude-opus-4")
  for (const [key, fallback] of Object.entries(fallbackAgents)) {
    if (primaryAgent.includes(key)) {
      return fallback;
    }
  }

  return undefined;
}

/**
 * Set a fallback agent mapping.
 */
export function setFallbackAgent(primaryAgent: string, fallbackAgent: string): void {
  const config = loadConfig();
  const fallbackAgents = config.fallbackAgents || {};
  fallbackAgents[primaryAgent] = fallbackAgent;
  updateConfig({ fallbackAgents });
}

/**
 * Remove a fallback agent mapping.
 */
export function removeFallbackAgent(primaryAgent: string): void {
  const config = loadConfig();
  const fallbackAgents = config.fallbackAgents || {};
  delete fallbackAgents[primaryAgent];
  updateConfig({ fallbackAgents });
}

/**
 * Get all configured fallback agent mappings.
 */
export function getAllFallbackAgents(): Record<string, string> {
  const config = loadConfig();
  return config.fallbackAgents || {};
}
