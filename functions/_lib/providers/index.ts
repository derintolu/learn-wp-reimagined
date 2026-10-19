import { ROUTES, type RouteConfig } from '../config';
import type { Env } from '../env';
import { createAnthropic } from './anthropic';
import type { Provider, Task } from './types';
import { createWorkersAi } from './workersAi';

export * from './types';
export { createWorkersAi } from './workersAi';
export { createAnthropic } from './anthropic';

function overrides(env: Env): Partial<Record<Task, Partial<RouteConfig>>> {
  if (!env.AI_ROUTES) return {};
  try {
    const j = JSON.parse(env.AI_ROUTES);
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function build(name: string | undefined, env: Env): Provider | null {
  if (name === 'workers-ai' && env.CF_ACCOUNT_ID && env.CF_AI_TOKEN) {
    return createWorkersAi(env.CF_ACCOUNT_ID, env.CF_AI_TOKEN);
  }
  if (name === 'anthropic' && env.ANTHROPIC_API_KEY) return createAnthropic(env.ANTHROPIC_API_KEY);
  return null;
}

/** Resolves the provider/model for a task, or null when its provider is not configured. */
export function routeFor(
  task: Task,
  env: Env,
): { provider: Provider; model: string; maxTokens: number } | null {
  const o = overrides(env)[task];
  let route: RouteConfig = { ...ROUTES[task], ...(o && typeof o === 'object' ? o : {}) };
  let provider = build(route.provider, env);
  if (!provider) {
    // Override names an unconfigured provider (e.g. anthropic without a key): use the default route.
    route = ROUTES[task];
    provider = build(route.provider, env);
  }
  if (!provider) return null;
  return { provider, model: route.model, maxTokens: route.maxTokens };
}
