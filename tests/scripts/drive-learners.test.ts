import { describe, expect, it } from 'vitest';
import { drive, learnerScript, loadCourse, parseArgs, readAdminToken, type ShadowReport } from '../../scripts/drive-learners';
import { EVENTS_MAX, parseEvents, type EventResult, type ServerEvent } from '../../src/shared/events';
import { runChecks } from '../../src/shared/checks';

const TOKEN = 'admin-secret-token-value';
const course = loadCourse();
const ALL_KINDS: ServerEvent['type'][] = ['placed', 'beatViewed', 'checkpointAnswered', 'codeSubmitted', 'lessonCompleted', 'lessonOpened', 'lessonLeft'];

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** What the course server would answer, enough to tell a learner-chosen branch the fallbacks don't offer. */
function decide(e: ServerEvent): EventResult {
  const fail = (error: 'unknown-lesson' | 'invalid' | 'not-allowed'): EventResult => ({ eventId: e.eventId, ok: false, error });
  const ok = (extra: object = {}): EventResult => ({ eventId: e.eventId, ok: true, statements: [], ...extra });
  if (e.type === 'placed') return ok();
  const lesson = course.bundle.lessons[e.lessonId];
  if (!lesson) return fail('unknown-lesson');
  if (e.type === 'codeSubmitted') {
    const checks = e.target === 'bug' ? lesson.bug?.fixChecks : lesson.checkpoint?.checks;
    return checks ? ok({ passed: runChecks(checks, e.files).passed }) : fail('invalid');
  }
  if (e.type === 'checkpointAnswered') {
    const cp = lesson.checkpoint;
    if (!cp || !cp.branches.some((b) => b.outcome === e.outcome)) return fail('invalid');
    if (cp.kind === 'code' && e.outcome === 'advance') return cp.checks && e.files && runChecks(cp.checks, e.files).passed ? ok() : fail('not-allowed');
    if (e.decisionId) return fail('not-allowed');
    return cp.fallback.some((f) => f.outcome === e.outcome) || (cp.kind === 'code' && e.outcome === 'review') ? ok() : fail('not-allowed');
  }
  return ok();
}

interface FakeOptions {
  diffs?: ShadowReport['diffs'];
  shadowStatus?: number;
  /** Results for these event types come back refused, as an unexpected failure. */
  refuse?: ServerEvent['type'][];
}

function fakeSite(o: FakeOptions = {}) {
  const calls: string[] = [];
  const batches: { actor: string; events: ServerEvent[] }[] = [];
  const live = new Map<string, string>();
  let n = 0;
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? 'GET';
    const key = `${method} ${u.pathname}`;
    calls.push(key);
    const headers = new Headers(init?.headers);
    const sid = /lwr_sid=([^;]+)/.exec(headers.get('cookie') ?? '')?.[1];
    if (key === 'POST /api/session') {
      const id = `sid${++n}`;
      const name = crypto.randomUUID();
      live.set(id, name);
      return json({ actor: { homePage: 'https://learnwp.sqwrlz.com', name } }, 200, {
        'set-cookie': `lwr_sid=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
      });
    }
    if (key === 'DELETE /api/session') {
      if (sid) live.delete(sid);
      return json({ deleted: true });
    }
    if (key === 'POST /api/events') {
      if (!sid || !live.has(sid)) return json({ error: 'no-session' }, 401);
      const parsed = parseEvents(JSON.parse(String(init?.body)));
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      batches.push({ actor: live.get(sid)!, events: parsed.events });
      return json({
        results: parsed.events.map((e) => (o.refuse?.includes(e.type) ? { eventId: e.eventId, ok: false, error: 'invalid' } : decide(e))),
      });
    }
    if (key === 'GET /api/admin/shadow') {
      if (headers.get('authorization') !== `Bearer ${TOKEN}`) return json({ error: 'unauthorized' }, 401);
      if (o.shadowStatus) return json({ error: 'x' }, o.shadowStatus);
      const day = u.searchParams.get('day');
      return json({ day, actors: live.size, diffs: o.diffs ?? [] });
    }
    return json({ error: 'not found' }, 404);
  };
  return { fetch: f as typeof fetch, calls, batches, live };
}

const quiet = () => {
  const lines: string[] = [];
  return { lines, log: (s: string) => lines.push(s) };
};
const clock = () => {
  let t = Date.parse('2026-10-28T12:00:00Z');
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
};

describe('learner scripts', () => {
  it('fix each planted bug with the snapshot reference solution, so the catch passes', () => {
    const bugs = [0, 1, 2].flatMap((i) => learnerScript(i, course)).filter((s) => s.event.type === 'codeSubmitted' && s.event.target === 'bug');
    expect(bugs.length).toBeGreaterThan(0);
    for (const s of bugs) {
      const e = s.event as Extract<ServerEvent, { type: 'codeSubmitted' }>;
      const lesson = course.bundle.lessons[e.lessonId];
      expect(e.file).toBe(lesson.bug!.file);
      expect(runChecks(lesson.bug!.fixChecks, e.files).passed).toBe(true);
    }
  });

  it('answer free-text checkpoints with authored fallback labels and no decisionId', () => {
    const answers = [0, 1, 2].flatMap((i) => learnerScript(i, course)).map((s) => s.event).filter((e) => e.type === 'checkpointAnswered');
    expect(new Set(answers.map((e) => e.outcome))).toEqual(new Set(['advance', 'review', 'skip']));
    for (const e of answers) {
      expect(e).not.toHaveProperty('decisionId');
      const cp = course.bundle.lessons[e.lessonId].checkpoint!;
      expect(cp.branches.map((b) => b.outcome)).toContain(e.outcome);
      const label = cp.fallback.find((f) => f.outcome === e.outcome)?.label;
      if (label) expect(e.response).toBe(label);
    }
  });

  it('use only lessons from the snapshot', () => {
    for (const i of [0, 1, 2]) {
      for (const { event: e } of learnerScript(i, course)) {
        if (e.type === 'placed') {
          expect(course.bundle.paths[e.placement.pathId].lessons).toContain(e.placement.startLessonId);
          expect(e.placement.skip.length).toBeGreaterThan(0);
        } else expect(course.bundle.lessons).toHaveProperty(e.lessonId);
      }
    }
  });
});

describe('drive', () => {
  it('sends every event kind across the default learners, with unique ids, and never calls the AI endpoints', async () => {
    const site = fakeSite();
    const { log } = quiet();
    const r = await drive('https://site.test/', { fetch: site.fetch, adminToken: TOKEN, log, ...clock() });
    expect(r.exitCode).toBe(0);
    const events = site.batches.flatMap((b) => b.events);
    for (const kind of ALL_KINDS) expect(events.some((e) => e.type === kind), kind).toBe(true);
    const ids = events.map((e) => e.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(new Set(site.calls)).toEqual(new Set(['POST /api/session', 'POST /api/events', 'GET /api/admin/shadow', 'DELETE /api/session']));
    expect(site.calls.filter((c) => c === 'POST /api/session')).toHaveLength(3);
    expect(new Set(site.batches.map((b) => b.actor)).size).toBe(3);
    for (const b of site.batches) expect(b.events.length).toBeLessThanOrEqual(EVENTS_MAX);
  });

  it('sends queued beats ahead of the next event, as the studio does', async () => {
    const site = fakeSite();
    await drive('https://site.test', { fetch: site.fetch, adminToken: TOKEN, log: quiet().log, ...clock() });
    expect(site.batches.some((b) => b.events.length === 1 && b.events[0].type === 'beatViewed')).toBe(false);
    for (const b of site.batches) {
      const firstOther = b.events.findIndex((e) => e.type !== 'beatViewed');
      expect(b.events.slice(firstOther).filter((e) => e.type === 'beatViewed')).toHaveLength(0);
      expect(b.events.filter((e) => e.type !== 'beatViewed')).toHaveLength(1);
    }
  });

  it('counts the refused learner-chosen skip as intended, not failed', async () => {
    const site = fakeSite();
    const out = quiet();
    const r = await drive('https://site.test', { fetch: site.fetch, adminToken: TOKEN, log: out.log, ...clock() });
    expect(r.exitCode).toBe(0);
    expect(r.learners.reduce((n, l) => n + l.refusedAsIntended, 0)).toBeGreaterThan(0);
    expect(r.learners.every((l) => l.failed === 0 && l.ok + l.refusedAsIntended === l.sent)).toBe(true);
  });

  it('deletes the last learner in its script before the report, and the others after it', async () => {
    const site = fakeSite();
    await drive('https://site.test', { fetch: site.fetch, adminToken: TOKEN, log: quiet().log, ...clock() });
    const firstShadow = site.calls.indexOf('GET /api/admin/shadow');
    const deletes = site.calls.flatMap((c, i) => (c === 'DELETE /api/session' ? [i] : []));
    expect(deletes).toHaveLength(3);
    expect(deletes.filter((i) => i < firstShadow)).toHaveLength(1);
    expect(site.live.size).toBe(0);
  });

  it('with keep, deletes no learner', async () => {
    const site = fakeSite();
    const r = await drive('https://site.test', { fetch: site.fetch, adminToken: TOKEN, keep: true, log: quiet().log, ...clock() });
    expect(r.exitCode).toBe(0);
    expect(site.calls).not.toContain('DELETE /api/session');
    expect(site.live.size).toBe(3);
  });

  it('drives the asked number of learners', async () => {
    const site = fakeSite();
    const r = await drive('https://site.test', { fetch: site.fetch, adminToken: TOKEN, learners: 5, log: quiet().log, ...clock() });
    expect(r.exitCode).toBe(0);
    expect(r.learners).toHaveLength(5);
    expect(site.calls.filter((c) => c === 'POST /api/session')).toHaveLength(5);
  });

  it('exits 1 when the shadow report shows a diff, and prints it without secrets', async () => {
    const site = fakeSite({ diffs: [{ actor: 'a1', missingInLrs: [{ lessonId: 'ln-blocks', kind: 'caught' }], extraInLrs: [] }] });
    const out = quiet();
    const r = await drive('https://site.test', { fetch: site.fetch, adminToken: TOKEN, log: out.log, pollMs: 5000, timeoutMs: 90_000, ...clock() });
    expect(r.exitCode).toBe(1);
    const text = out.lines.join('\n');
    expect(text).toMatch(/1 actor\(s\) with diffs: 1 missing in LRS, 0 extra in LRS/);
    expect(text).toContain('a1 missingInLrs caught ln-blocks');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toMatch(/sid\d/);
    // It polled for the 90 s the outbox may need to drain, then gave up.
    expect(site.calls.filter((c) => c === 'GET /api/admin/shadow').length).toBeGreaterThan(5);
  });

  it('exits 1 when the report cannot be read', async () => {
    for (const shadowStatus of [500, 401]) {
      const site = fakeSite({ shadowStatus });
      const r = await drive('https://site.test', { fetch: site.fetch, adminToken: TOKEN, log: quiet().log, ...clock() });
      expect(r.exitCode).toBe(1);
      expect(site.live.size).toBe(0);
    }
    const site = fakeSite();
    const r = await drive('https://site.test', { fetch: site.fetch, adminToken: 'wrong', log: quiet().log, ...clock() });
    expect(r.exitCode).toBe(1);
  });

  it('exits 1 when an event the script expects to pass is refused', async () => {
    const site = fakeSite({ refuse: ['lessonCompleted'] });
    const r = await drive('https://site.test', { fetch: site.fetch, adminToken: TOKEN, log: quiet().log, ...clock() });
    expect(r.exitCode).toBe(1);
    expect(r.learners.some((l) => l.failed > 0)).toBe(true);
  });

  it('prints per learner the events sent and results', async () => {
    const site = fakeSite();
    const out = quiet();
    const r = await drive('https://site.test', { fetch: site.fetch, adminToken: TOKEN, log: out.log, ...clock() });
    const sent = site.batches.reduce((n, b) => n + b.events.length, 0);
    expect(r.learners.reduce((n, l) => n + l.sent, 0)).toBe(sent);
    expect(out.lines.filter((l) => /^learner \d+ .*: \d+ events sent, \d+ ok, \d+ refused as intended, \d+ failed$/.test(l))).toHaveLength(3);
    expect(out.lines.join('\n')).toMatch(/shadow report: 0 actor\(s\) with diffs/);
  });
});

describe('parseArgs and readAdminToken', () => {
  it('reads the base url, --learners and --keep', () => {
    expect(parseArgs(['https://x.test'])).toEqual({ base: 'https://x.test', learners: 3, keep: false });
    expect(parseArgs(['https://x.test', '--learners', '5', '--keep'])).toEqual({ base: 'https://x.test', learners: 5, keep: true });
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(['https://x.test', '--learners', '0'])).toThrow(/learners/);
  });
  it('takes ADMIN_TOKEN from the environment, else from ENV_FILE', () => {
    expect(readAdminToken({ ADMIN_TOKEN: 'a' }, () => 'ADMIN_TOKEN=b\n')).toBe('a');
    expect(readAdminToken({ ENV_FILE: 'x' }, (f) => (f === 'x' ? 'OTHER=1\nADMIN_TOKEN= b \n' : ''))).toBe('b');
    expect(readAdminToken({}, () => '')).toBe('');
  });
});
