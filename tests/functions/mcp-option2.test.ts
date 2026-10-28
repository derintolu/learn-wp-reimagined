// /api/mcp with SERVER_FLAGS.agentOnStandard: the course-xapi-mcp reference server with record option 2
// (author-lrs custody), signed in with our OAuth access tokens. Agent calls take the studio's decide-and-record path.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../../dev/sqliteD1';
import * as route from '../../functions/api/mcp';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { getContent, setContentForTests } from '../../functions/_lib/content';
import { ensureOAuthSchema } from '../../functions/_lib/db';
import * as decide from '../../functions/_lib/events/decide';
import { deriveStatementId } from '../../functions/_lib/events/ids';
import { gateMcp, MCP_LIMITS } from '../../functions/_lib/mcp/gate';
import { EXT_CHOSEN_BY } from '../../src/shared/xapi';
import { issueTokens, sha256Hex } from '../../functions/_lib/oauth/store';
import { OFFICIAL_COURSE_ID, OFFICIAL_ID_OFFSET, auIdOf, officialActor } from '../../functions/_lib/record/official';
import { createSession, type Session } from '../../functions/_lib/session/session';
import { getRegistration } from '../../functions/_lib/record/registration';
import { ensureRecordSchema } from '../../functions/_lib/db';
import { ADL_VERBS, CXM_EXT, CXM_VERBS, EXTENSION_ID, STATE_IDS, TOOL_NAMES, activityIds } from '../../vendor/course-xapi-mcp/core/constants.ts';
import { connectMcp, routeFetch, type Era } from '../helpers/mcpClient';
import { fakeLrs } from '../helpers/fakeLrs';
import type { D1Like, Env } from '../../functions/_lib/env';

const LESSON = 'bt-what-is-a-block-theme';
const NEXT = 'bt-style-css-and-theme-json';
const CANONICAL = 'https://learnwp.sqwrlz.com';
const LEGACY = 'https://learn-wp-reimagined.space.fast';
const lesson = () => getContent().lessons[LESSON];
const fixedThemeJson = () => getContent().paths['block-theme'].finalFiles!['theme.json'];

let db: D1Like;
let env: Env;
let lrs: ReturnType<typeof fakeLrs>;
let open: { close(): Promise<void> }[] = [];
const flags = { ...SERVER_FLAGS };

// Access tokens are bearer secrets: nothing on this path may log one.
const logs: unknown[][] = [];
const tokens: string[] = [];
beforeAll(() => {
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation((...a) => void logs.push(a));
});
afterAll(() => {
  const text = JSON.stringify(logs);
  for (const t of tokens) expect(text).not.toContain(t);
  vi.restoreAllMocks();
});

beforeEach(() => {
  db = createSqliteD1();
  env = { DB: db, SESSION_KEY: 'k'.repeat(32), LRS_KEY: 'ck_test', LRS_SECRET: 'cs_test' } as Env;
  lrs = fakeLrs();
  vi.stubGlobal('fetch', lrs.fetch);
  Object.assign(SERVER_FLAGS, flags, { agentOnStandard: true, lrsShadow: true });
});
afterEach(async () => {
  await Promise.all(open.map((c) => c.close()));
  open = [];
  Object.assign(SERVER_FLAGS, flags);
  vi.unstubAllGlobals();
  // A spy left by a failed test must not carry its calls into the next one.
  if (vi.isMockFunction(decide.decideEvents)) vi.mocked(decide.decideEvents).mockRestore();
});

/** A studio session and an access token for it, as the consent page and token endpoint would issue them. */
async function signIn(): Promise<{ session: Session; token: string }> {
  const { session } = await createSession(env, Date.now());
  await ensureOAuthSchema(db);
  const { accessToken } = await issueTokens(env, { actorName: session.actorName, wpUserId: 0, registration: '' }, 'c'.repeat(32), crypto.randomUUID(), Date.now());
  tokens.push(accessToken);
  return { session, token: accessToken };
}

async function agent(era: Era, token: string, url = `${CANONICAL}/api/mcp`) {
  const s = await connectMcp(routeFetch(route, env), era, url, { token });
  open.push(s.client);
  return s;
}
type Call = Awaited<ReturnType<typeof agent>>['call'];

async function playBeats(call: Call) {
  let r = await call('next_beat');
  for (let guard = 0; guard < 20 && r.data.step === 'beat'; guard++) {
    r = await call('next_beat', r.data.beat.question ? { learner_reply: 'I think it shows up in the Site Editor.' } : {});
  }
  return r;
}

async function toCheckpoint(call: Call) {
  await toBug(call);
  await call('check_code', { file: 'theme.json', content: fixedThemeJson() });
  expect((await call('next_beat')).data.step).toBe('checkpoint');
  return call('submit_checkpoint', { response: 'style.css and templates/index.html.' });
}

async function toBug(call: Call) {
  expect((await call('start_placement')).isError).toBe(false);
  expect((await call('choose_placement', { pathKey: 'block-theme', startLessonKey: LESSON, skip: [], reason: 'New to themes.' })).isError).toBe(false);
  const bug = await playBeats(call);
  expect(bug.data.step).toBe('bug');
  return bug;
}

const rpc = (method: string, params: unknown, id = 1) => ({ jsonrpc: '2.0', id, method, params });
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  route.POST(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...headers },
      body: JSON.stringify(body),
    }),
    { params: {}, env },
  );

/** Every official statement recorded: still queued, or already drained to the LRS (the route drains inline). */
const recorded = async () => [
  ...lrs.statements,
  ...(await db.prepare('SELECT body FROM lrs_outbox ORDER BY created').all<{ body: string }>()).results.map((r) => JSON.parse(r.body)),
];

describe.each(['legacy', 'modern'] as const)('/api/mcp option 2 (%s era)', (era) => {
  it('get_status reports custody author-lrs', async () => {
    const { token } = await signIn();
    const { client, call } = await agent(era, token);
    const ext = (client.getServerCapabilities() as any)?.extensions?.[EXTENSION_ID];
    expect(ext).toMatchObject({ custody: 'author-lrs', official: true, allowPractice: false });
    const st = await call('get_status');
    expect(st.isError).toBe(false);
    expect(st.data).toMatchObject({ custody: 'author-lrs', official: true, course: { id: OFFICIAL_COURSE_ID } });
    expect(st.data.cxm).toMatchObject({ custody: 'author-lrs', official: true });
  });

  it('link_record is not listed', async () => {
    const { token } = await signIn();
    const { client } = await agent(era, token);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.sort()).toEqual([...TOOL_NAMES].sort());
    expect(names).not.toContain('link_record');
  });

  it('an agent check_code is recorded through decideEvents', async () => {
    const { session, token } = await signIn();
    const spy = vi.spyOn(decide, 'decideEvents');
    const { call } = await agent(era, token);
    await toBug(call);
    const before = spy.mock.calls.flatMap((c) => c[2].map((e) => e.eventId));
    spy.mockClear();
    const miss = await call('check_code', { file: 'theme.json', content: '{ "nope": true }' });
    expect(miss.data).toMatchObject({ passed: false, fix_attempts: 1, delivery: 'delivered' });
    expect(spy).toHaveBeenCalledTimes(1);
    const [, actorName, events, , opts] = spy.mock.calls[0]!;
    expect(actorName).toBe(session.actorName);
    expect(opts?.session?.actorName).toBe(session.actorName);
    const checked = events.filter((e) => e.type === 'codeSubmitted');
    expect(checked).toEqual([{ eventId: expect.any(String), type: 'codeSubmitted', lessonId: LESSON, target: 'bug', file: 'theme.json', files: { 'theme.json': '{ "nope": true }' } }]);

    // The official statement is the studio's (official.ts), under the session's actor and its LRS registration.
    const registration = (await db.prepare('SELECT registration FROM sessions WHERE actor_name = ?').bind(session.actorName).first<{ registration: string }>())!.registration;
    expect(registration).toMatch(/^[0-9a-f-]{36}$/);
    const fileIri = activityIds.file(auIdOf(LESSON), 'theme.json');
    const failed = (await recorded()).find((s) => s.object.id === fileIri);
    expect(failed).toMatchObject({ actor: officialActor(session.actorName), verb: { id: ADL_VERBS.failed }, context: { registration } });
    expect(failed.id).toBe(await deriveStatementId(checked[0]!.eventId, OFFICIAL_ID_OFFSET + 4));

    spy.mockClear();
    const fixed = await call('check_code', { file: 'theme.json', content: fixedThemeJson() });
    expect(fixed.data).toMatchObject({ passed: true, caught: true });
    expect(spy.mock.calls[0]![2].filter((e) => e.type === 'codeSubmitted')).toMatchObject([{ target: 'bug', files: { 'theme.json': fixedThemeJson() } }]);
    expect((await recorded()).some((s) => s.verb.id === CXM_VERBS.caught && s.object.id === activityIds.bug(auIdOf(LESSON), lesson().bug!.id))).toBe(true);
    // Only the course server's own statements are recorded: none of the reference engine's (an event's id is the
    // id of the engine statement it came from) reaches the LRS.
    const engineIds = new Set([...before, ...spy.mock.calls.flatMap((c) => c[2].map((e) => e.eventId))]);
    expect(lrs.statements.length).toBeGreaterThan(0);
    expect(lrs.statements.filter((s) => engineIds.has(s.id))).toEqual([]);
    spy.mockRestore();
  });

  it('an agent branch is recorded learner-chosen, and the next connection resumes from the LRS', async () => {
    const { session, token } = await signIn();
    const { call } = await agent(era, token);
    await toCheckpoint(call);
    const spy = vi.spyOn(decide, 'decideEvents');
    spy.mockClear();
    const br = await call('choose_branch', { branch: 'advance', rationale: 'Names both files.' });
    expect(br.data).toMatchObject({ success: true, next_lesson: { key: NEXT } });
    const answered = spy.mock.calls.flatMap((c) => c[2]).filter((e) => e.type === 'checkpointAnswered');
    expect(answered).toEqual([{ eventId: expect.any(String), type: 'checkpointAnswered', lessonId: LESSON, response: 'style.css and templates/index.html.', outcome: 'advance' }]);
    const results = (await Promise.all(spy.mock.results.map((r) => r.value))).flat();
    expect(results.find((r: { eventId: string }) => r.eventId === answered[0]!.eventId)).toMatchObject({ ok: true, chosenBy: 'learner' });
    // Our server runs no judge on this path: no judge decision is minted, and the record says the learner chose.
    expect((await db.prepare('SELECT COUNT(*) AS n FROM decisions').first<{ n: number }>())!.n).toBe(0);
    const branched = (await recorded()).filter((s) => s.verb.id === CXM_VERBS.branched && s.actor.account.name === session.actorName);
    expect(branched).toHaveLength(1);
    expect(branched[0].result.extensions[EXT_CHOSEN_BY]).toBe('learner');
    expect(branched[0].result.extensions[CXM_EXT.rationale]).toBe('The learner chose this option.');
    spy.mockRestore();

    // The working state is an LRS State document under the registration; a new connection continues there.
    const reg = (await db.prepare('SELECT registration FROM sessions WHERE actor_name = ?').bind(session.actorName).first<{ registration: string }>())!.registration;
    const key = [OFFICIAL_COURSE_ID, JSON.stringify(officialActor(session.actorName)), reg, STATE_IDS.learner].join('|');
    expect((lrs.state.get(key) as any)?.cursor).toMatchObject({ lessonKey: NEXT, phase: 'beats' });
    const again = await agent(era, token);
    expect((await again.call('next_beat')).data).toMatchObject({ step: 'beat', lesson: { key: NEXT } });
  });

  it('a branch outside the checkpoint\'s authored fallback options is refused, naming the allowed ones', async () => {
    const { token } = await signIn();
    const { call } = await agent(era, token);
    const sub = await toCheckpoint(call);
    // The engine would allow skip (the rubric's branch), but no fallback option lists it.
    expect(sub.data.allowed_branches.map((b: { key: string }) => b.key)).toContain('skip');
    const spy = vi.spyOn(decide, 'decideEvents');
    spy.mockClear();
    const refused = await call('choose_branch', { branch: 'skip', rationale: 'Knows themes.' });
    expect(refused.isError).toBe(true);
    expect(refused.data.error).toMatch(/skip/);
    expect(refused.data.error).toMatch(/advance, review/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect((await recorded()).filter((s) => s.verb.id === CXM_VERBS.branched)).toEqual([]);
    // Nothing changed: the learner is still at the branch, and an authored option goes through.
    expect((await call('choose_branch', { branch: 'review', rationale: 'Unsure of the files.' })).data).toMatchObject({ success: false });
  });

  it('the same branch event delivered twice is recorded once', async () => {
    const { session, token } = await signIn();
    const { call } = await agent(era, token);
    await toCheckpoint(call);
    // Recorded, then the answer is lost: the engine keeps the step as pending and sends it again on the next call.
    const real = decide.decideEvents;
    const spy = vi.spyOn(decide, 'decideEvents');
    spy.mockClear();
    spy.mockImplementationOnce(async (...a) => {
      await real(...a);
      throw new Error('lost');
    });
    expect((await call('choose_branch', { branch: 'advance', rationale: 'Names both files.' })).data).toMatchObject({ delivery: 'pending' });
    await call('next_beat');
    const sent = spy.mock.calls.map((c) => c[2].filter((e) => e.type === 'checkpointAnswered').map((e) => e.eventId)).filter((ids) => ids.length > 0);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).toHaveLength(1);
    spy.mockRestore();
    const branched = (await recorded()).filter((s) => s.verb.id === CXM_VERBS.branched && s.actor.account.name === session.actorName);
    expect(new Set(branched.map((s) => s.id)).size).toBe(1);
    const outcomes = await db.prepare('SELECT verb FROM official_outcomes WHERE actor_name = ?').bind(session.actorName).all<{ verb: string }>();
    expect(outcomes.results.filter((r) => r.verb === 'passed')).toHaveLength(1);
  });

  it('get_record reads the LRS, and restart_course moves the registration the studio records under', async () => {
    const { session, token } = await signIn();
    const { call } = await agent(era, token);
    await toBug(call);
    const regOf = async () => (await db.prepare('SELECT registration FROM sessions WHERE actor_name = ?').bind(session.actorName).first<{ registration: string }>())!.registration;
    const first = await regOf();
    const rec = await call('get_record');
    expect(rec.isError).toBe(false);
    expect(rec.data.record.official).toBe(true);
    expect(rec.data.record.statements.length).toBeGreaterThan(0);
    expect(rec.data.record.statements.every((s: any) => s.actor.account.name === session.actorName && s.context.registration === first)).toBe(true);

    expect((await call('restart_course')).data).toMatchObject({ restarted: true });
    const second = await regOf();
    expect(second).not.toBe(first);
    const pointer = [OFFICIAL_COURSE_ID, JSON.stringify(officialActor(session.actorName)), '', STATE_IDS.registration].join('|');
    expect(lrs.state.get(pointer)).toEqual({ registration: second });
    expect((await call('start_placement')).isError).toBe(false);
    await call('choose_placement', { pathKey: 'block-theme', startLessonKey: LESSON, skip: [], reason: 'Again.' });
    const placed = (await recorded()).filter((s) => s.verb.id === CXM_VERBS.placed).map((s) => s.context.registration);
    expect(placed).toEqual([first, second]);
  });

  it('get_lesson never includes the bug explanation or fix checks before caught or reveal_bug after 3 failed attempts', async () => {
    const secrets = () => [lesson().bug!.explanation, ...lesson().bug!.fixChecks.map((c) => c.message)];
    const leaks = (r: unknown) => secrets().filter((s) => JSON.stringify(r).includes(s.slice(0, 40)));
    const { token } = await signIn();
    const { call } = await agent(era, token);
    const outline = await call('get_lesson', { lessonKey: LESSON });
    expect(outline.data.has_planted_bug).toBe(true);
    expect(leaks(outline.raw)).toEqual([]);
    expect(JSON.stringify(outline.raw)).not.toMatch(/fixChecks|explanation|referenceSolution/);
    const bug = await toBug(call);
    expect(leaks(bug.raw)).toEqual([]);
    for (let i = 1; i <= 3; i++) {
      expect((await call('reveal_bug')).isError).toBe(true);
      const miss = await call('check_code', { file: 'theme.json', content: `{ "try": ${i} }` });
      expect(miss.data).toMatchObject({ passed: false, fix_attempts: i, can_reveal: i >= 3 });
      expect(leaks(miss.raw)).toEqual([]);
      expect(leaks((await call('get_lesson', { lessonKey: LESSON })).raw)).toEqual([]);
    }
    const shown = await call('reveal_bug');
    expect(shown.data).toMatchObject({ revealed: true, file: 'theme.json', explanation: lesson().bug!.explanation });
  });

  it('get_badges returns the claim page URL, never a claim link', async () => {
    const { token } = await signIn();
    const { call } = await agent(era, token);
    const r = await call('get_badges');
    expect(r.isError).toBe(false);
    expect(r.data.claimPage).toBe(`${CANONICAL}/badges/claim`);
    expect(JSON.stringify(r.raw)).not.toMatch(/claim-links|lrs\.sqwrlz\.com/);
    expect(lrs.calls.filter((c) => c.url.includes('claim-links'))).toEqual([]);
  });
});

describe('/api/mcp option 2: the agent and the studio share the learner\'s files and place', () => {
  const T = '2026-10-28T10:00:00.000Z';
  async function studioLearner() {
    const { session, token } = await signIn();
    const reg = await getRegistration(env, session);
    const key = (stateId: string) => [OFFICIAL_COURSE_ID, JSON.stringify(officialActor(session.actorName)), reg, stateId].join('|');
    return { session, token, reg, key };
  }

  it('a learner who used the studio starts the agent at the studio\'s beat, with its files and completed lessons', async () => {
    const { session, token, reg, key } = await studioLearner();
    lrs.state.set(key('lwr-files'), { files: { 'theme.json': '{"studio":true}' }, times: { 'theme.json': T } });
    lrs.state.set(key('lwr-resume'), { current: { pathId: 'block-theme', lessonId: NEXT, beatIndex: 1 }, updatedAt: T });
    await ensureRecordSchema(db);
    for (const verb of ['completed', 'passed'])
      await db
        .prepare('INSERT INTO official_outcomes (actor_name, registration, activity_id, verb, event_id) VALUES (?, ?, ?, ?, ?)')
        .bind(session.actorName, reg, activityIds.au(auIdOf(LESSON)), verb, 'evt-studio')
        .run();
    const { call } = await agent('modern', token);
    const r = await call('next_beat');
    expect(r.isError).toBe(false);
    expect(r.data).toMatchObject({ step: 'beat', lesson: { key: NEXT }, position: { beat: 2 } });
    const engine = lrs.state.get(key(STATE_IDS.learner)) as any;
    expect(engine.files).toEqual({ 'theme.json': '{"studio":true}' });
    expect(engine.au[LESSON]).toMatchObject({ completed: true, passed: true });
    expect(engine.registration).toBe(reg);
  });

  it('an agent edit reaches the studio document, newest per file; a later studio edit reaches the agent', async () => {
    const { token, key } = await studioLearner();
    lrs.state.set(key('lwr-files'), { files: { 'style.css': 'a{}' }, fileLessons: { 'style.css': LESSON }, times: { 'style.css': T } });
    const { call } = await agent('modern', token);
    await toBug(call);
    expect((await call('check_code', { file: 'theme.json', content: fixedThemeJson() })).isError).toBe(false);
    const studio = lrs.state.get(key('lwr-files')) as any;
    expect(studio.files).toEqual({ 'style.css': 'a{}', 'theme.json': fixedThemeJson() });
    expect(studio.fileLessons).toEqual({ 'style.css': LESSON, 'theme.json': LESSON });
    expect(studio.times['style.css']).toBe(T);
    expect(Date.parse(studio.times['theme.json'])).toBeGreaterThan(Date.parse(T));

    // The studio edits style.css afterwards; the agent's next call works on that copy.
    lrs.state.set(key('lwr-files'), { ...studio, files: { ...studio.files, 'style.css': 'b{}' }, times: { ...studio.times, 'style.css': new Date().toISOString() } });
    await call('next_beat');
    expect((lrs.state.get(key(STATE_IDS.learner)) as any).files).toEqual({ 'style.css': 'b{}', 'theme.json': fixedThemeJson() });
    expect((lrs.state.get(key('lwr-files')) as any).files['style.css']).toBe('b{}');
  });

  it('a learner new to both still starts at placement with no files', async () => {
    const { token, key } = await studioLearner();
    const { call } = await agent('modern', token);
    expect((await call('next_beat')).isError).toBe(true);
    expect((await call('start_placement')).isError).toBe(false);
    expect(lrs.state.has(key('lwr-files'))).toBe(false);
  });
});

describe('/api/mcp option 2: HTTP', () => {
  const init = rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });

  it('no token → 401 with resource metadata', async () => {
    for (const [url, origin] of [
      [`${CANONICAL}/api/mcp`, CANONICAL],
      [`${LEGACY}/api/mcp`, LEGACY],
      ['http://localhost/api/mcp', CANONICAL],
    ]) {
      const res = await post(url, init);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`);
    }
    // An unknown or malformed token is the same as none.
    for (const authorization of ['Bearer ' + 'x'.repeat(43), 'Bearer nope', 'Basic abc']) {
      const res = await post(`${LEGACY}/api/mcp`, init, { authorization });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${LEGACY}/.well-known/oauth-protected-resource"`);
    }
  });

  it('an old practice handle gets a clear error pointing to sign-in', async () => {
    const call = rpc('tools/call', { name: 'next_beat', arguments: { handle: 'lr_' + 'a'.repeat(32) } });
    const res = await post(`${CANONICAL}/api/mcp`, call);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
    expect(((await res.json()) as any).error.message).toMatch(/sign in/i);
    const { token } = await signIn();
    const signed = await post(`${CANONICAL}/api/mcp`, rpc('tools/call', { name: 'get_status', arguments: { handle: 'cxp_' + 'b'.repeat(32) } }), { authorization: `Bearer ${token}` });
    const body = (await signed.json()) as any;
    expect(body.error.message).toMatch(/sign/i);
    expect(body.error.message).toMatch(/handle/i);
  });

  it('teaches the course the server serves now, as its full package', async () => {
    const changed = structuredClone(getContent());
    changed.lessons[LESSON]!.title = 'What makes a block theme (revised)';
    setContentForTests(changed);
    try {
      const { token } = await signIn();
      const { call } = await agent('modern', token);
      expect((await call('get_lesson', { lessonKey: LESSON })).data).toMatchObject({ lesson: { key: LESSON, title: 'What makes a block theme (revised)' } });
    } finally {
      setContentForTests(null);
    }
  });

  it('refuses another site, and an erased learner cannot write', async () => {
    const { session, token } = await signIn();
    expect((await post(`${CANONICAL}/api/mcp`, init, { authorization: `Bearer ${token}`, origin: 'https://evil.example' })).status).toBe(403);
    const { call } = await agent('modern', token);
    await db.prepare('DELETE FROM sessions WHERE actor_name = ?').bind(session.actorName).run();
    const r = await call('start_placement');
    expect(r.isError).toBe(true);
  });

  it('rate limits are keyed by the token hash, not a handle', async () => {
    const { token } = await signIn();
    const other = (await signIn()).token;
    const h = await sha256Hex(token);
    const calls = (n: number) =>
      new Request(`${CANONICAL}/api/mcp`, {
        method: 'POST',
        body: JSON.stringify(Array.from({ length: n }, (_, i) => rpc('tools/call', { name: 'get_status', arguments: {} }, i))),
      });
    const now = Date.now();
    expect((await gateMcp(calls(MCP_LIMITS.perHandle.limit), env, now, { tokenHash: h })).ok).toBe(true);
    const over = await gateMcp(calls(1), env, now, { tokenHash: h });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.res.status).toBe(429);
    expect((await gateMcp(calls(1), env, now, { tokenHash: await sha256Hex(other) })).ok).toBe(true);
    const keys = (await db.prepare('SELECT k FROM hits').all<{ k: string }>()).results.map((r) => r.k);
    expect(keys).toContain('mcp:t:' + h.slice(0, 32));
    expect(keys.every((k) => !k.includes(token))).toBe(true);
  });
});

describe('SERVER_FLAGS.agentOnStandard off', () => {
  it("today's practice connector, unchanged: no token needed, handles resolve", async () => {
    SERVER_FLAGS.agentOnStandard = false;
    const s = await connectMcp(routeFetch(route, env), 'modern');
    open.push(s.client);
    const ext = (s.client.getServerCapabilities() as any)?.extensions?.[EXTENSION_ID];
    expect(ext).toMatchObject({ custody: 'practice', official: false });
    const start = await s.call('start_placement');
    expect(start.data.handle).toMatch(/^cxp_/);
    expect((await s.call('get_status', { handle: start.data.handle })).data.custody).toBe('practice');
    expect(lrs.calls).toEqual([]);
  });
});
