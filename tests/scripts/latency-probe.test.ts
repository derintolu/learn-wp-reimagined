import { describe, expect, it } from 'vitest';
import { p95, probe, waitForComplete, PASS_MS } from '../../scripts/latency-probe';

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
  function fake(completeAfter: number, calls: string[]) {
    let polls = 0;
    const f = async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      const key = `${init?.method ?? 'GET'} ${u.pathname}`;
      calls.push(key);
      if (key === 'POST /api/session') polls = 0;
      if (key === 'POST /api/session') return json({ actor: {} }, { 'set-cookie': 'lwr_sid=abc; Path=/; HttpOnly' });
      expect((init?.headers as Record<string, string>).cookie).toContain('lwr_sid=abc');
      if (key === 'POST /api/events') return json({ results: [{ ok: true }] });
      if (key === 'GET /api/sensei') return json({ completed: ++polls >= completeAfter ? ['intro'] : [] });
      if (key === 'DELETE /api/session') return json({ ok: true });
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
    const r = await probe('https://example.test', 3, { fetch: fake(2, calls), lessonId: 'intro', ...clock() });
    expect(r).toEqual({ p50: 2000, p95: 2000, max: 2000 });
    expect(calls.filter((c) => c === 'DELETE /api/session')).toHaveLength(3);
    expect(calls.filter((c) => c === 'POST /api/events')).toHaveLength(3);
    expect(PASS_MS).toBe(90_000);
  });

  it('deletes the learner even when polling times out', async () => {
    const calls: string[] = [];
    await expect(
      probe('https://example.test', 1, { fetch: fake(Infinity, calls), lessonId: 'intro', timeoutMs: 6000, ...clock() }),
    ).rejects.toThrow(/timed out/i);
    expect(calls.at(-1)).toBe('DELETE /api/session');
  });
});
