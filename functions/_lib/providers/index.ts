import { PRICES, ROUTES, type RouteConfig } from '../config';
import type { Env } from '../env';
import { createAnthropic } from './anthropic';
import type { Provider, ReasoningEffort, Task } from './types';
import { createWorkersAi } from './workersAi';

export * from './types';
export { createWorkersAi } from './workersAi';
export { createAnthropic } from './anthropic';

const PROVIDER_IDS = ['workers-ai', 'anthropic'];

/** Returns the valid override for a task, or null (warning why) so the default route is used. */
function validOverride(task: Task, raw: unknown): Partial<RouteConfig> | null {
  if (raw === undefined) return null;
  const warn = (why: string) => {
    console.warn(`AI_ROUTES override for "${task}" ignored: ${why}`);
    return null;
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return warn('not an object');
  const o = raw as Record<string, unknown>;
  const out: Partial<RouteConfig> = {};
  if (o.provider !== undefined) {
    if (typeof o.provider !== 'string' || !PROVIDER_IDS.includes(o.provider)) return warn('unknown provider');
    out.provider = o.provider as RouteConfig['provider'];
  }
  if (o.model !== undefined) {
    if (typeof o.model !== 'string' || !o.model) return warn('model must be a non-empty string');
    if (!Object.prototype.hasOwnProperty.call(PRICES, o.model)) return warn('model has no entry in PRICES');
    out.model = o.model;
  }
  if (o.maxTokens !== undefined) {
    if (!Number.isInteger(o.maxTokens) || (o.maxTokens as number) < 1 || (o.maxTokens as number) > 4000) {
      return warn('maxTokens must be an integer from 1 to 4000');
    }
    out.maxTokens = o.maxTokens as number;
  }
  return out;
}

function overrides(env: Env): Record<string, unknown> {
  if (!env.AI_ROUTES) return {};
  try {
    const j = JSON.parse(env.AI_ROUTES);
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch {
    console.warn('AI_ROUTES is not valid JSON; ignoring');
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
): { provider: Provider; model: string; maxTokens: number; reasoningEffort?: ReasoningEffort } | null {
  const o = validOverride(task, overrides(env)[task]);
  let route: RouteConfig = { ...ROUTES[task], ...(o ?? {}) };
  // The default effort belongs to the default model; another model doesn't inherit it.
  if (route.model !== ROUTES[task].model) delete route.reasoningEffort;
  let provider = build(route.provider, env);
  if (!provider) {
    if (o?.provider) console.warn(`AI route for "${task}" names provider "${route.provider}" which is not configured; using default`);
    // Override names an unconfigured provider (e.g. anthropic without a key): use the default route.
    route = ROUTES[task];
    provider = build(route.provider, env);
  }
  if (!provider) return null;
  return {
    provider,
    model: route.model,
    maxTokens: route.maxTokens,
    ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}),
  };
}
