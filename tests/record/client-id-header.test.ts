// @vitest-environment happy-dom
// The course server rate-limits /api/events, /api/session and /api/state by clientKey, which falls back to the
// x-client-id header when the platform gives no visitor IP (functions/_lib/guards.ts). Without it every visitor
// shares one 'anon' bucket, so the studio sends the same id the AI calls send.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientId } from '../../src/ai/client';
import { EventClient } from '../../src/record/eventClient';
import { ensureSession, resetSession } from '../../src/record/session';
import { fetchFilesState } from '../../src/record/stateSync';

let seen: { url: string; id: string | null }[];
beforeEach(() => {
  seen = [];
  resetSession();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      seen.push({ url, id: new Headers(init.headers).get('x-client-id') });
      if (url === '/api/session') return new Response(JSON.stringify({ actor: { homePage: 'h', name: 'n' } }), { status: 200 });
      if (url === '/api/events') {
        const events = JSON.parse(String(init.body)).events as { eventId: string }[];
        return new Response(JSON.stringify({ results: events.map((e) => ({ eventId: e.eventId, ok: true, statements: [] })) }), { status: 200 });
      }
      return new Response(JSON.stringify({ doc: null, etag: null }), { status: 200 });
    }),
  );
});
afterEach(() => {
  resetSession();
  vi.unstubAllGlobals();
});

describe('x-client-id on the studio\'s own API calls', () => {
  it('session, events and state requests carry the browser\'s client id', async () => {
    await ensureSession();
    await new EventClient(() => 'learner').send({ type: 'lessonCompleted', lessonId: 'x' });
    await fetchFilesState();
    const id = clientId();
    for (const url of ['/api/session', '/api/events', '/api/state/files']) {
      const calls = seen.filter((c) => c.url === url);
      expect(calls.length, url).toBeGreaterThan(0);
      for (const c of calls) expect(c.id, url).toBe(id);
    }
  });
});
