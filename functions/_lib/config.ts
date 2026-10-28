import type { ReasoningEffort, Task } from './providers/types';

export interface RouteConfig {
  provider: 'workers-ai' | 'anthropic';
  model: string;
  maxTokens: number;
  /**
   * gpt-oss reasoning effort (low, medium (default), high: developers.cloudflare.com/workers-ai/models/gpt-oss-120b/),
   * sent as the Chat Completions `reasoning_effort` field. Low keeps placement and judging from reasoning up to the cap.
   * Not inherited when an AI_ROUTES override changes the model.
   */
  reasoningEffort?: ReasoningEffort;
}

// Default routes, chosen by measurement (docs/model-eval.md, scripts/eval-models.ts, 2026-10-19):
// gpt-oss-120b for the two structured-JSON tasks (placement, judge), llama-4-scout for the tutor and
// code feedback. `env.AI_ROUTES` (JSON, partial per task)
// overrides these at runtime.
// FUTURE: a `wordpress-ai` adapter (WordPress 7 Connectors / AI Client) slots in here: add
// 'wordpress-ai' to the provider union in providers/types.ts, a providers/wordpressAi.ts
// implementing `Provider`, and one branch in providers/index.ts. Nothing else changes.
export const ROUTES: Record<Task, RouteConfig> = {
  placement: { provider: 'workers-ai', model: '@cf/openai/gpt-oss-120b', maxTokens: 800, reasoningEffort: 'low' },
  judge: { provider: 'workers-ai', model: '@cf/openai/gpt-oss-120b', maxTokens: 300, reasoningEffort: 'low' },
  tutor: { provider: 'workers-ai', model: '@cf/meta/llama-4-scout-17b-16e-instruct', maxTokens: 700 },
  feedback: { provider: 'workers-ai', model: '@cf/meta/llama-4-scout-17b-16e-instruct', maxTokens: 300 },
};

// USD per million tokens, checked 2026-10-19.
//  - Workers AI: https://developers.cloudflare.com/workers-ai/platform/pricing/
//      gpt-oss-120b: $0.350 in / $0.750 out.
//      llama-4-scout-17b-16e-instruct: $0.270 in / $0.850 out.
//  - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
//      Haiku 5.5 (prompts up to 100k tokens): $0.10 in / $0.50 out; Sonnet 5.5: $2 / $10.
//      (Haiku 5.5 over 100k prompt tokens is $0.50 / $2.50; our prompts are far smaller.)
export const PRICES: Record<string, { inPerM: number; outPerM: number }> = {
  '@cf/openai/gpt-oss-120b': { inPerM: 0.35, outPerM: 0.75 },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { inPerM: 0.27, outPerM: 0.85 },
  'claude-haiku-5-5': { inPerM: 0.1, outPerM: 0.5 },
  'claude-sonnet-5-5': { inPerM: 2, outPerM: 10 },
};

/** Server-side behaviour switches. Rollback = set to false and republish. */
export const SERVER_FLAGS = { serverEvents: true, sessions: false };

/** Learning Ledger REST base (the plugin's learning-ledger/v1 namespace on the WordPress site). */
export const LEDGER_BASE = 'https://learnwp.sqwrlz.com/wp-json/learning-ledger/v1';
export const PROGRAM_KEY = 'learn-wp-reimagined';
/** Learning Ledger LRS (lrs.sqwrlz.com): the xAPI endpoint and the REST API for courses, links, badges and erasure. */
export const LRS_XAPI = 'https://lrs.sqwrlz.com/wp-json/learning-ledger/xapi';
export const LRS_API = 'https://lrs.sqwrlz.com/wp-json/learning-ledger/v1';
