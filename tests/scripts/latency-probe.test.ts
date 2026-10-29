import { describe, expect, it } from 'vitest';
import { p95, probe, waitForComplete, LESSON_ID, PASS_MS } from '../../scripts/latency-probe';
import { loadCourse } from '../../scripts/drive-learners';

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

describe('p95', () => {
  it('uses the nearest-rank percentile', () => {
    const ms = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    expect(p95(ms)).toBe(1900);
    expect(p95([5])).toBe(5);
    expect(p95([300, 100, 200])).toBe(300);
  });
  it('is 0 for no samples and does not mutate its input', () => {
    expect(p95([])).toBe(0);
    const a = [3, 1, 2];
    p95(a);
    expect(a).toEqual([3, 1, 2]);
  });
});

describe('waitForComplete', () => {
  it('polls every interval until the lesson shows complete', async () => {
    let t = 0;
    let polls = 0;
    const waited: number[] = [];
    const ms = await waitForComplete(async () => ++polls >= 3, 'l1', {
      pollMs: 2000,
      timeoutMs: 90_000,
      now: () => t,
      sleep: async (d) => { waited.push(d); t += d; },
    });
    expect(polls).toBe(3);
    expect(waited).toEqual([2000, 2000]);
    expect(ms).toBe(4000);
  });
  it('throws when the lesson never completes within the timeout', async () => {
    let t = 0;
    await expect(
      waitForComplete(async () => false, 'l1', { pollMs: 2000, timeoutMs: 10_000, now: () => t, sleep: async (d) => { t += d; } }),
    ).rejects.toThrow(/timed out/i);
  });
});

describe('probe', () => {
  function fake(completeAfter: number, calls: string[], deleteStatus = 200, eventsStatus = 200, nc: string[] = [], result: object = { ok: true }) {
    let polls = 0;
    let lesson = '';
    const f = async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      const key = `${init?.method ?? 'GET'} ${u.pathname}`;
      calls.push(key);
      if (key === 'POST /api/session') polls = 0;
      if (key === 'POST /api/session') return json({ actor: {} }, { 'set-cookie': 'lwr_sid=abc; Path=/; HttpOnly' });
      expect((init?.headers as Record<string, string>).cookie).toContain('lwr_sid=abc');
      if (key === 'POST /api/events') {
        const e = JSON.parse(String(init?.body)).events[0];
        lesson = e.lessonId;
        return eventsStatus === 200 ? json({ results: [{ eventId: e.eventId, ...result }] }) : new Response('x', { status: eventsStatus });
      }
      if (key === 'GET /api/sensei') {
        nc.push(u.searchParams.get('nc') ?? '');
        // The route's shape: completedLessons named by studio lesson id.
        return json({ enrolled: [], completedLessons: ++polls >= completeAfter ? [lesson] : [], testedOutLessons: [] });
      }
      if (key === 'DELETE /api/session') return deleteStatus === 200 ? json({ ok: true }) : new Response('x', { status: deleteStatus });
      return new Response('no', { status: 404 });
    };
    return f as typeof fetch;
  }
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (d: number) => { t += d; } };
  };

  it('runs the flow per run and reports percentiles, deleting the learner each time', async () => {
    const calls: string[] = [];
    const r = await probe('https://example.test', 3, { fetch: fake(2, calls), ...clock() });
    expect(r).toEqual({ p50: 2000, p95: 2000, max: 2000, leaked: 0 });
    expect(calls.filter((c) => c === 'DELETE /api/session')).toHaveLength(3);
    expect(calls.filter((c) => c === 'POST /api/events')).toHaveLength(3);
    expect(PASS_MS).toBe(90_000);
  });

  it('deletes the learner even when polling times out', async () => {
    const calls: string[] = [];
    await expect(
      probe('https://example.test', 1, { fetch: fake(Infinity, calls), timeoutMs: 6000, ...clock() }),
    ).rejects.toThrow(/timed out/i);
    expect(calls.at(-1)).toBe('DELETE /api/session');
  });

  it('counts a failed DELETE as a leaked learner', async () => {
    const calls: string[] = [];
    const r = await probe('https://example.test', 2, { fetch: fake(1, calls, 500), ...clock() });
    expect(r.leaked).toBe(2);
  });

  it('counts a DELETE network error as leaked and mentions it when the run fails', async () => {
    const calls: string[] = [];
    const inner = fake(Infinity, calls);
    const f = (async (u: string | URL | Request, i?: RequestInit) =>
      i?.method === 'DELETE' ? Promise.reject(new Error('net')) : inner(u, i)) as typeof fetch;
    await expect(probe('https://example.test', 1, { fetch: f, timeoutMs: 4000, ...clock() })).rejects.toThrow(/leaked/);
  });

  it('still deletes when events fails', async () => {
    const calls: string[] = [];
    await expect(probe('https://example.test', 1, { fetch: fake(1, calls, 200, 500), ...clock() })).rejects.toThrow(/events failed/);
    expect(calls.at(-1)).toBe('DELETE /api/session');
  });

  it('completes a real lesson that a completion alone satisfies (moveOn Completed)', async () => {
    const lesson = loadCourse().bundle.lessons[LESSON_ID];
    expect(lesson).toBeDefined();
    expect(lesson.checkpoint).toBeUndefined();
  });

  it('defaults to that lesson and busts the cache on every poll', async () => {
    const nc: string[] = [];
    const r = await probe('https://example.test', 2, { fetch: fake(3, [], 200, 200, nc), ...clock() });
    expect(r.p95).toBe(4000);
    expect(nc).toHaveLength(6);
    expect(nc.every((v) => /^[0-9a-f-]{16,}$/.test(v))).toBe(true);
    expect(new Set(nc).size).toBe(nc.length);
  });

  it('fails, and still deletes, when the server refuses the completion', async () => {
    const calls: string[] = [];
    await expect(
      probe('https://example.test', 1, { fetch: fake(1, calls, 200, 200, [], { ok: false, error: 'unknown-lesson' }), ...clock() }),
    ).rejects.toThrow(/unknown-lesson/);
    expect(calls).not.toContain('GET /api/sensei');
    expect(calls.at(-1)).toBe('DELETE /api/session');
  });

  it('rejects runs that are not positive integers', async () => {
    for (const n of [0, -1, NaN]) await expect(probe('https://example.test', n, { fetch: fake(1, []) })).rejects.toThrow(/runs/);
  });

  it('passes an abort signal on every request', async () => {
    const signals: unknown[] = [];
    const inner = fake(1, []);
    const f = (async (u: string | URL | Request, i?: RequestInit) => (signals.push(i?.signal), inner(u, i))) as typeof fetch;
    await probe('https://example.test', 1, { fetch: f, ...clock() });
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });
});
