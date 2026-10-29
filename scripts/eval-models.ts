// Evaluates Workers AI candidate models against the real prompts and adapter.
//
//   npx tsx scripts/eval-models.ts [--models glm-4.7-flash,kimi-k2.6] [--tokens placement=400,judge=300,tutor=700,feedback=300]
//                                  [--only placement,judge] [--out results.json] [--probe] [--content content/snapshot]
//
// --content picks the content directory (default tests/fixtures/content). On any other directory a placement
// case is checked against its `contentStart` lesson ids when it has them, since the fixture ids don't exist there.
//
// Reads CF_ACCOUNT_ID and CF_AI_TOKEN from .env.server (never printed). Each case runs once per candidate.
// A candidate whose JSON validity is clearly poor (under 50% after 8 placement/judge calls) is stopped early.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildContent } from './build-content.ts';
import { ROUTES, PRICES } from '../functions/_lib/config.ts';
import { askPrompt, feedbackPrompt, judgePrompt, placementPrompt, wrapLearner } from '../functions/_lib/prompts.ts';
import { createWorkersAi } from '../functions/_lib/providers/workersAi.ts';
import { parseObject } from '../functions/_lib/ai.ts';
import { validatePlacement } from '../src/shared/engine.ts';
import type { ChatMessage, ReasoningEffort, Task, Usage } from '../functions/_lib/providers/types.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
export const FIXTURE_CONTENT = 'tests/fixtures/content';

/** The content directory from `--content <dir>`, relative to the repo root; the fixtures by default. */
export function contentDirFrom(args: string[]): string {
  const i = args.indexOf('--content');
  return i >= 0 && args[i + 1] ? args[i + 1] : FIXTURE_CONTENT;
}

/** The start lessons a placement case accepts on this content: `contentStart` off the fixtures, when given. */
export function expectedStarts(e: { start?: string[]; contentStart?: string[] }, contentDir: string): string[] {
  return (contentDir !== FIXTURE_CONTENT && e.contentStart) || e.start || [];
}

/** The route's reasoning effort, sent only when the candidate is the model the route uses (as routeFor does). */
export function effortFor(task: Task, model: string): ReasoningEffort | undefined {
  return ROUTES[task].model === model ? ROUTES[task].reasoningEffort : undefined;
}

// Eval-only prices for candidates that are not (yet) routed, so not in config.ts PRICES. Checked against
// https://developers.cloudflare.com/workers-ai/platform/pricing/ on 2026-10-19 (USD per million tokens).
const EVAL_ONLY_PRICES: Record<string, { inPerM: number; outPerM: number }> = {
  '@cf/zai-org/glm-4.7-flash': { inPerM: 0.06, outPerM: 0.4 },
  '@cf/moonshotai/kimi-k2.6': { inPerM: 0.95, outPerM: 4.0 },
  '@cf/qwen/qwen3.8-27b': { inPerM: 0.45, outPerM: 3.2 },
};
// Candidates in evaluation order. Routed models take their price from PRICES, so the two cannot drift.
export const CANDIDATES: string[] = [
  '@cf/openai/gpt-oss-120b',
  '@cf/zai-org/glm-4.7-flash',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/moonshotai/kimi-k2.6',
  '@cf/qwen/qwen3.8-27b',
];

// Per-learner usage assumed for the cost estimate: 1 placement, 6 judges, 20 tutor turns.
const MIX: Record<'placement' | 'judge' | 'tutor', number> = { placement: 1, judge: 6, tutor: 20 };

function readDotEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const PLACEMENT_SCHEMA = {
  type: 'object',
  properties: { reply: { type: 'string' }, done: { type: 'boolean' }, placement: { type: 'object' } },
  required: ['reply', 'done'],
};
const JUDGE_SCHEMA = {
  type: 'object',
  properties: { outcome: { type: 'string' }, feedback: { type: 'string' } },
  required: ['outcome', 'feedback'],
};

interface TextExpect { include?: string[]; exclude?: string[] }
interface Cases {
  placement: { id: string; messages: { role: 'user' | 'assistant'; content: string }[]; expect: { done: boolean | 'any'; start?: string[]; contentStart?: string[] } }[];
  judge: { id: string; lessonId: string; answer: string; expect: { outcome: string[] } }[];
  tutor: { id: string; lessonId: string; solutionRequest?: boolean; messages: { role: 'user' | 'assistant'; content: string }[]; expect: TextExpect }[];
  feedback: { id: string; lessonId: string; solutionRequest?: boolean; file: string; code: string; passed: boolean; failedMessages: string[]; expect: TextExpect }[];
}

export interface CaseResult {
  task: Task;
  id: string;
  valid: boolean;
  correct: boolean;
  solutionRequest: boolean;
  empty: boolean;
  ms: number;
  usage: Usage;
  error?: string;
}

export function textCorrect(text: string, e: TextExpect): boolean {
  const lower = text.toLowerCase();
  if (e.include?.length && !e.include.some((s) => lower.includes(s.toLowerCase()))) return false;
  if (e.exclude?.some((s) => new RegExp(s, 'i').test(text))) return false;
  return true;
}

export function costOf(model: string, u: Usage): number {
  const p = PRICES[model] ?? EVAL_ONLY_PRICES[model];
  if (!p) throw new Error(`no price for ${model}`);
  return (u.inputTokens * p.inPerM + u.outputTokens * p.outPerM) / 1e6;
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

async function runModel(
  model: string,
  cases: Cases,
  tokens: Record<Task, number>,
  only: Set<string>,
  creds: { id: string; token: string },
  contentDir: string,
): Promise<{ results: CaseResult[]; stoppedEarly: boolean }> {
  const provider = createWorkersAi(creds.id, creds.token);
  const content = buildContent(resolve(ROOT, contentDir));
  const results: CaseResult[] = [];
  const timeout = () => AbortSignal.timeout(90_000);
  const learner = (m: { role: 'user' | 'assistant'; content: string }): ChatMessage => ({
    role: m.role,
    content: m.role === 'user' ? wrapLearner(m.content) : m.content,
  });

  async function time<T>(fn: () => Promise<T>): Promise<{ v?: T; ms: number; error?: string }> {
    const t = performance.now();
    try {
      return { v: await fn(), ms: performance.now() - t };
    } catch (e) {
      return { ms: performance.now() - t, error: (e as Error).message };
    }
  }
  const failed = (task: Task, id: string, ms: number, error: string, sr = false): CaseResult => ({
    task, id, valid: false, correct: false, solutionRequest: sr, empty: false, ms, usage: { inputTokens: 0, outputTokens: 0 }, error,
  });

  if (only.has('placement')) {
    for (const c of cases.placement) {
      const { v, ms, error } = await time(() =>
        provider.chat({
          model, maxTokens: tokens.placement, json: PLACEMENT_SCHEMA, reasoningEffort: effortFor('placement', model), signal: timeout(),
          messages: [{ role: 'system', content: placementPrompt(content) }, ...c.messages.map(learner)],
        }),
      );
      if (!v) { results.push(failed('placement', c.id, ms, error!)); continue; }
      const parsed = parseObject(v.text);
      const valid = !!parsed && typeof parsed.reply === 'string' && parsed.reply.length > 0;
      let correct = false;
      if (valid) {
        const placed = parsed!.done === true && parsed!.placement !== undefined ? validatePlacement(content, parsed!.placement) : null;
        const okPlacement = placed?.ok === true && expectedStarts(c.expect, contentDir).includes(placed.placement.startLessonId);
        if (c.expect.done === false) correct = parsed!.done !== true;
        else if (c.expect.done === true) correct = okPlacement;
        else correct = parsed!.done !== true || okPlacement;
      }
      results.push({ task: 'placement', id: c.id, valid, correct, solutionRequest: false, empty: v.text.trim() === '', ms, usage: v.usage });
    }
  }

  if (only.has('judge')) {
    for (const c of cases.judge) {
      const lesson = content.lessons[c.lessonId];
      const authored = lesson.checkpoint!.branches.map((b) => b.outcome as string);
      const { v, ms, error } = await time(() =>
        provider.chat({
          model, maxTokens: tokens.judge, json: JUDGE_SCHEMA, reasoningEffort: effortFor('judge', model), signal: timeout(),
          messages: [{ role: 'system', content: judgePrompt(lesson) }, { role: 'user', content: wrapLearner(c.answer) }],
        }),
      );
      if (!v) { results.push(failed('judge', c.id, ms, error!)); continue; }
      const p = parseObject(v.text);
      const valid = !!p && typeof p.outcome === 'string' && authored.includes(p.outcome) && typeof p.feedback === 'string';
      const correct = valid && c.expect.outcome.includes(p!.outcome as string);
      results.push({ task: 'judge', id: c.id, valid, correct, solutionRequest: false, empty: v.text.trim() === '', ms, usage: v.usage });
    }
  }

  // Stop early when JSON validity is clearly poor: no point streaming tutor turns for a model that cannot place or judge.
  const jsonRuns = results.filter((r) => r.task === 'placement' || r.task === 'judge');
  if (jsonRuns.length >= 8 && jsonRuns.filter((r) => r.valid).length / jsonRuns.length < 0.5) {
    return { results, stoppedEarly: true };
  }

  if (only.has('tutor')) {
    for (const c of cases.tutor) {
      const lesson = content.lessons[c.lessonId];
      const { v, ms, error } = await time(async () => {
        const s = await provider.stream({
          model, maxTokens: tokens.tutor, signal: timeout(),
          messages: [{ role: 'system', content: askPrompt(lesson) }, ...c.messages.map(learner)],
        });
        let text = '';
        const reader = s.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += value;
        }
        return { text, usage: await s.usage };
      });
      if (!v) { results.push(failed('tutor', c.id, ms, error!, !!c.solutionRequest)); continue; }
      const valid = v.text.trim().length > 0;
      results.push({
        task: 'tutor', id: c.id, valid, correct: valid && textCorrect(v.text, c.expect),
        solutionRequest: !!c.solutionRequest, empty: !valid, ms, usage: v.usage,
      });
    }
  }

  if (only.has('feedback')) {
    for (const c of cases.feedback) {
      const lesson = content.lessons[c.lessonId];
      const { v, ms, error } = await time(() =>
        provider.chat({
          model, maxTokens: tokens.feedback, signal: timeout(),
          messages: [
            { role: 'system', content: feedbackPrompt(lesson, c.file) },
            {
              role: 'user',
              content: `Checks ${c.passed ? 'all passed' : 'failed'}.\nFailed check messages:\n${c.failedMessages.map((m) => `- ${m}`).join('\n') || '(none)'}\n\n${wrapLearner(c.code)}`,
            },
          ],
        }),
      );
      if (!v) { results.push(failed('feedback', c.id, ms, error!)); continue; }
      const valid = v.text.trim().length > 0;
      results.push({ task: 'feedback', id: c.id, valid, correct: valid && textCorrect(v.text, c.expect), solutionRequest: !!c.solutionRequest, empty: !valid, ms, usage: v.usage });
    }
  }
  return { results, stoppedEarly: false };
}

/** Raw wire check of one streamed and one JSON-schema reply: chunk shapes, usage, reasoning vs content. */
async function probe(model: string, creds: { id: string; token: string }, maxTokens: number): Promise<Record<string, unknown>> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.id}/ai/v1/chat/completions`;
  const headers = { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' };
  const out: Record<string, unknown> = { model };
  try {
    const res = await fetch(url, {
      method: 'POST', headers, signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true },
        messages: [{ role: 'user', content: 'In one sentence, what is theme.json?' }],
      }),
    });
    const raw = await res.text();
    const events = raw.split(/\r?\n\r?\n/).map((e) => e.replace(/^data: ?/, '')).filter(Boolean);
    let content = 0, reasoning = 0, usageChunks = 0;
    let last: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    let finish: string | null = null;
    for (const e of events) {
      if (e === '[DONE]') continue;
      const j = JSON.parse(e) as { choices?: { delta?: { content?: string; reasoning?: string }; finish_reason?: string | null }[]; usage?: typeof last };
      const d = j.choices?.[0]?.delta;
      if (d?.content) content++;
      if (d?.reasoning) reasoning++;
      if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason;
      if (j.usage) { usageChunks++; last = j.usage; }
    }
    Object.assign(out, { stream: { status: res.status, doneMarker: events.includes('[DONE]'), contentChunks: content, reasoningChunks: reasoning, usageChunks, finalUsage: last, finish } });
  } catch (e) {
    out.stream = { error: (e as Error).message };
  }
  return out;
}

function table(rows: string[][]): string {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const line = (r: string[]) => '| ' + r.map((c, i) => c.padEnd(w[i])).join(' | ') + ' |';
  return [line(rows[0]), '|' + w.map((n) => '-'.repeat(n + 2)).join('|') + '|', ...rows.slice(1).map(line)].join('\n');
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}% (${n}/${d})` : 'n/a');

export function summarise(model: string, results: CaseResult[], stoppedEarly: boolean): string[] {
  const by = (t: Task) => results.filter((r) => r.task === t);
  const jsonRuns = [...by('placement'), ...by('judge')];
  const sr = results.filter((r) => r.solutionRequest);
  // A task with no results (the candidate stopped early) has no mean cost; the mix cost is then incomplete.
  const mean = (t: 'placement' | 'judge' | 'tutor'): number | undefined => {
    const rs = by(t).filter((r) => !r.error);
    return rs.length ? rs.reduce((n, r) => n + costOf(model, r.usage), 0) / rs.length : undefined;
  };
  const [mp, mj, mt] = [mean('placement'), mean('judge'), mean('tutor')];
  const per1000 =
    mp === undefined || mj === undefined || mt === undefined
      ? 'n/a (incomplete)'
      : `$${(1000 * (MIX.placement * mp + MIX.judge * mj + MIX.tutor * mt)).toFixed(2)}`;
  return [
    model.replace('@cf/', '') + (stoppedEarly ? ' (stopped early)' : ''),
    pct(jsonRuns.filter((r) => r.valid).length, jsonRuns.length),
    pct(by('placement').filter((r) => r.correct).length, by('placement').length),
    pct(by('judge').filter((r) => r.correct).length, by('judge').length),
    pct(by('tutor').filter((r) => r.correct).length, by('tutor').length),
    pct(sr.filter((r) => r.correct).length, sr.length),
    pct(results.filter((r) => r.empty).length, results.length),
    pct(results.filter((r) => r.error).length, results.length),
    `${Math.round(percentile(results.filter((r) => !r.error).map((r) => r.ms), 0.5))} ms`,
    per1000,
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const env = readDotEnv(resolve(ROOT, '.env.server'));
  if (!env.CF_ACCOUNT_ID || !env.CF_AI_TOKEN) throw new Error('CF_ACCOUNT_ID and CF_AI_TOKEN must be set in .env.server');
  const creds = { id: env.CF_ACCOUNT_ID, token: env.CF_AI_TOKEN };

  const wanted = flag('models')?.split(',').map((m) => m.trim());
  const models = CANDIDATES.filter((m) => !wanted || wanted.some((w) => m.endsWith(w)));
  const tokens: Record<Task, number> = Object.fromEntries((Object.keys(ROUTES) as Task[]).map((t) => [t, ROUTES[t].maxTokens])) as Record<Task, number>;
  for (const kv of flag('tokens')?.split(',') ?? []) { const [k, v] = kv.split('='); tokens[k as Task] = Number(v); }
  const only = new Set((flag('only') ?? 'placement,judge,tutor,feedback').split(','));

  if (args.includes('--probe')) {
    for (const m of models) console.log(JSON.stringify(await probe(m, creds, tokens.tutor)));
    return;
  }

  const cases = parse(readFileSync(resolve(ROOT, 'tests/eval/cases.yaml'), 'utf8')) as Cases;
  const contentDir = contentDirFrom(args);
  if (contentDir !== FIXTURE_CONTENT && [...only].some((t) => t !== 'placement')) {
    throw new Error('Only placement cases can run on --content other than the fixtures; add --only placement');
  }
  console.log(`content: ${contentDir}; maxTokens: ${JSON.stringify(tokens)}; cases: ${Object.values(cases).reduce((n, c) => n + c.length, 0)}`);
  const all = await Promise.all(models.map(async (m) => ({ m, ...(await runModel(m, cases, tokens, only, creds, contentDir)) })));

  const head = ['Model', 'JSON valid', 'Placement ok', 'Judge ok', 'Tutor ok', 'Refuses solutions', 'Empty reply', 'Errors', 'p50 latency', '$/1000 learners'];
  console.log('\n' + table([head, ...all.map((r) => summarise(r.m, r.results, r.stoppedEarly))]));
  const spend = all.reduce((n, r) => n + r.results.reduce((s, c) => s + costOf(r.m, c.usage), 0), 0);
  console.log(`\nEstimated eval spend: $${spend.toFixed(4)}`);
  for (const r of all) {
    const bad = r.results.filter((c) => !c.correct || !c.valid);
    if (bad.length) console.log(`\n${r.m} misses: ` + bad.map((c) => `${c.id}${c.error ? `[${c.error}]` : c.valid ? '' : '[invalid]'}`).join(', '));
  }
  const out = flag('out');
  if (out) writeFileSync(resolve(out), JSON.stringify(all, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error((e as Error).message); process.exit(1); });
}
