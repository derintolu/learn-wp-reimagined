// Sensei latency probe: how long after a lesson completes does /api/sensei show it complete?
//
//   npx tsx scripts/latency-probe.ts [base-url] [runs]
//
// Each run creates a session (POST /api/session, cookie lwr_sid), completes a short lesson through
// /api/events, polls /api/sensei every 2 s until that lesson shows complete, then deletes the learner
// (DELETE /api/session), also on failure. Pass: p95 <= 90 000 ms. Defaults to https://learnwp.sqwrlz.com.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const DEFAULT_BASE = 'https://learnwp.sqwrlz.com';
export const PASS_MS = 90_000;
const POLL_MS = 2000;
const TIMEOUT_MS = 180_000;
const LESSON_ID = 'intro';

/** Nearest-rank 95th percentile; 0 for no samples. */
export function p95(ms: number[]): number {
  if (ms.length === 0) return 0;
  const s = [...ms].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(s.length * 0.95) - 1)];
}

const median = (ms: number[]) => {
  const s = [...ms].sort((a, b) => a - b);
  return s.length ? s[Math.max(0, Math.ceil(s.length * 0.5) - 1)] : 0;
};

export interface Clock {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}
export interface WaitOptions extends Clock {
  pollMs?: number;
  timeoutMs?: number;
}
export interface ProbeOptions extends WaitOptions {
  fetch?: typeof fetch;
  lessonId?: string;
}

/** Polls `isComplete` every pollMs until it is true; returns the elapsed ms, or throws after timeoutMs. */
export async function waitForComplete(
  isComplete: () => Promise<boolean>,
  lessonId: string,
  { pollMs = POLL_MS, timeoutMs = TIMEOUT_MS, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }: WaitOptions = {},
): Promise<number> {
  const start = now();
  for (;;) {
    if (await isComplete()) return now() - start;
    if (now() - start + pollMs > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for ${lessonId} to show complete`);
    await sleep(pollMs);
  }
}

// The /api/sensei shape is not final: accept a `completed` id list or a `lessons` map with `complete`.
function showsComplete(body: unknown, lessonId: string): boolean {
  const b = body as { completed?: unknown; lessons?: Record<string, { complete?: boolean }> } | null;
  if (Array.isArray(b?.completed) && b.completed.includes(lessonId)) return true;
  return b?.lessons?.[lessonId]?.complete === true;
}

async function once(base: string, opts: ProbeOptions): Promise<number> {
  const f = opts.fetch ?? fetch;
  const lessonId = opts.lessonId ?? LESSON_ID;
  const created = await f(`${base}/api/session`, { method: 'POST' });
  if (!created.ok) throw new Error(`session create failed: ${created.status}`);
  const sid = /lwr_sid=[^;,\s]+/.exec(created.headers.get('set-cookie') ?? '')?.[0];
  if (!sid) throw new Error('no lwr_sid cookie in session response');
  const headers = { cookie: sid, 'content-type': 'application/json' };
  try {
    const sent = await f(`${base}/api/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ events: [{ eventId: crypto.randomUUID(), type: 'lessonCompleted', lessonId }] }),
    });
    if (!sent.ok) throw new Error(`events failed: ${sent.status}`);
    return await waitForComplete(
      async () => {
        const r = await f(`${base}/api/sensei`, { headers });
        return r.ok && showsComplete(await r.json().catch(() => null), lessonId);
      },
      lessonId,
      opts,
    );
  } finally {
    await f(`${base}/api/session`, { method: 'DELETE', headers }).catch(() => undefined);
  }
}

export async function probe(base: string, runs = 20, opts: ProbeOptions = {}): Promise<{ p50: number; p95: number; max: number }> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) times.push(await once(base.replace(/\/$/, ''), opts));
  return { p50: median(times), p95: p95(times), max: Math.max(0, ...times) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base = DEFAULT_BASE, runs = '20'] = process.argv.slice(2);
  probe(base, Number(runs)).then(
    (r) => {
      console.log(JSON.stringify(r));
      console.log(r.p95 <= PASS_MS ? 'PASS' : `FAIL: p95 ${r.p95} ms exceeds ${PASS_MS} ms`);
      process.exitCode = r.p95 <= PASS_MS ? 0 : 1;
    },
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    },
  );
}
