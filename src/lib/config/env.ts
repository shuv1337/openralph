import { UserConfig } from './schema';

export function loadEnvVariables(): Partial<UserConfig> {
  const config: Partial<UserConfig> = {};

  if (process.env.RALPH_MODEL) config.model = process.env.RALPH_MODEL;
  if (process.env.RALPH_ADAPTER) {
    const adapter = process.env.RALPH_ADAPTER;
    if (['opencode-server', 'opencode-run', 'codex'].includes(adapter)) {
      config.adapter = adapter as any;
    }
  }
  if (process.env.RALPH_PLAN) config.plan = process.env.RALPH_PLAN;
  if (process.env.RALPH_PROGRESS) config.progress = process.env.RALPH_PROGRESS;
  if (process.env.RALPH_SERVER) config.server = process.env.RALPH_SERVER;
  if (process.env.RALPH_SERVER_TIMEOUT) {
    const timeout = parseInt(process.env.RALPH_SERVER_TIMEOUT, 10);
    if (!isNaN(timeout)) config.serverTimeout = timeout;
  }

  return config;
}
