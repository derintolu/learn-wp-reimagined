// Drives a scripted set of learners through a site's real HTTP API, as the studio would, then reads the shadow
// comparison (GET /api/admin/shadow) once the LRS outbox has drained. For the shadow comparison (Task 33, ruling
// R51), the Sensei latency check (Task 42) and Task 53.
//
//   npx tsx scripts/drive-learners.ts <baseUrl> [--learners N] [--keep]
//
// ADMIN_TOKEN comes from the environment, else from ENV_FILE (default .env.server); it is never printed. Each
// learner makes a session (POST /api/session, cookie lwr_sid) and sends its events to POST /api/events, beats
// batched ahead of the next event. Together the default three cover placement with a waived lesson, opening,
// beats and leaving, checkpoints answered with the authored fallback options (learner-chosen, no decisionId; the
// skip no fallback offers is refused, which is intended), planted bugs caught with the snapshot's reference fix,
// a code checkpoint and completions. No AI endpoint is called. The last learner deletes itself
// (DELETE /api/session) before the report; the others are deleted after it, unless --keep.
// Exit 1 on an unexpected event result, a shadow diff, an unreadable report or a failed delete.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSnapshot } from './content-pull';
import { waitForComplete, type WaitOptions } from './latency-probe';
import { packageToBundle } from '../src/shared/package';
import { EVENTS_MAX, type EventResult, type ServerEvent } from '../src/shared/events';
import type { ContentBundle, Lesson, Outcome } from '../src/shared/types';

const SNAPSHOT = fileURLToPath(new URL('../content/snapshot', import.meta.url));
const POLL_MS = 5000;
/** Task 42's bound: the outbox should have drained to the LRS within 90 s. */
const DRAIN_MS = 90_000;
const REQUEST_TIMEOUT_MS = 30_000;
const SHOW_DIFFS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Course {
  bundle: ContentBundle;
  /** Each lesson's referenceSolution from the snapshot, which the bundle does not keep per lesson. */
  solutions: Record<string, { files?: Record<string, string>; bugFix?: string }>;
}

/** The committed course snapshot, read from disk. */
export function loadCourse(dir = SNAPSHOT): Course {
  const files = readSnapshot(dir);
  const bundle = packageToBundle(files);
  const solutions: Course['solutions'] = {};
  for (const id of Object.keys(bundle.lessons)) {
    const raw = files[`cxm/lessons/${id}.json`];
    const rs = raw ? (JSON.parse(raw) as { referenceSolution?: Course['solutions'][string] }).referenceSolution : undefined;
    if (rs) solutions[id] = rs;
  }
  return { bundle, solutions };
}

/** 'passed' also wants the code checks to pass; 'not-allowed' is a refusal the script means to provoke. */
export type Expect = 'ok' | 'passed' | 'not-allowed';
export interface Step {
  event: ServerEvent;
  expect?: Expect;
}

const newId = () => crypto.randomUUID();

function lessonOf(c: Course, id: string): Lesson {
  if (!Object.hasOwn(c.bundle.lessons, id)) throw new Error(`the snapshot has no lesson ${id}`);
  return c.bundle.lessons[id];
}

const opened = (lessonId: string): Step => ({ event: { eventId: newId(), type: 'lessonOpened', lessonId } });
const left = (lessonId: string): Step => ({ event: { eventId: newId(), type: 'lessonLeft', lessonId } });
const completed = (lessonId: string): Step => ({ event: { eventId: newId(), type: 'lessonCompleted', lessonId } });
const beats = (l: Lesson): Step[] => l.beats.map((_, beatIndex) => ({ event: { eventId: newId(), type: 'beatViewed', lessonId: l.id, beatIndex } }));

/** A learner-chosen answer: the fallback option's label as the response, never a decisionId. */
function answer(l: Lesson, outcome: Outcome, o: { files?: Record<string, string>; expect?: Expect } = {}): Step {
  if (!l.checkpoint?.branches.some((b) => b.outcome === outcome)) throw new Error(`${l.id} has no ${outcome} branch`);
  const response = l.checkpoint.fallback.find((f) => f.outcome === outcome)?.label ?? '';
  return {
    event: { eventId: newId(), type: 'checkpointAnswered', lessonId: l.id, response, outcome, ...(o.files ? { files: o.files } : {}) },
    ...(o.expect ? { expect: o.expect } : {}),
  };
}

/** The planted bug, fixed with the snapshot's referenceSolution.bugFix. */
function catchBug(c: Course, l: Lesson): Step {
  const fix = c.solutions[l.id]?.bugFix;
  if (!l.bug || fix === undefined) throw new Error(`${l.id} has no planted bug with a reference fix`);
  return { event: { eventId: newId(), type: 'codeSubmitted', lessonId: l.id, target: 'bug', file: l.bug.file, files: { [l.bug.file]: fix } }, expect: 'passed' };
}

function solutionFiles(c: Course, l: Lesson): Record<string, string> {
  const files = c.solutions[l.id]?.files;
  if (!files) throw new Error(`${l.id} has no reference files`);
  return files;
}

const SCRIPTS: ((c: Course) => Step[])[] = [
  // Placed past the first lesson of the learner path (waived, Tested Out); passes a free-text checkpoint;
  // catches a planted bug and passes a code checkpoint.
  (c) => {
    const path = c.bundle.paths.learner;
    const posts = lessonOf(c, 'ln-posts-and-pages');
    const blocks = lessonOf(c, 'ln-blocks');
    const files = solutionFiles(c, blocks);
    return [
      { event: { eventId: newId(), type: 'placed', placement: { pathId: path.id, startLessonId: path.lessons[1], skip: [path.lessons[0]], reason: 'Has used the dashboard before.' } } },
      opened(posts.id), ...beats(posts), answer(posts, 'advance'), completed(posts.id), left(posts.id),
      opened(blocks.id), ...beats(blocks), catchBug(c, blocks),
      { event: { eventId: newId(), type: 'codeSubmitted', lessonId: blocks.id, target: 'checkpoint', file: blocks.checkpoint!.file!, files }, expect: 'passed' },
      answer(blocks, 'advance', { files }), completed(blocks.id), left(blocks.id),
    ];
  },
  // Reviews, then catches the bug and advances on the first block-theme lesson; completes a lesson with no checkpoint.
  (c) => {
    const first = lessonOf(c, 'bt-what-is-a-block-theme');
    const ship = lessonOf(c, 'bt-ship-it');
    return [
      opened(first.id), ...beats(first), answer(first, 'review'), catchBug(c, first), answer(first, 'advance'), completed(first.id), left(first.id),
      opened(ship.id), ...beats(ship), completed(ship.id), left(ship.id),
    ];
  },
  // Asks for the skip branch (which would jump a lesson) with no decisionId: no fallback offers it, so it is refused
  // (R34). Then catches the bug, reviews and advances.
  (c) => {
    const l = lessonOf(c, 'vc-actions-and-filters');
    return [
      opened(l.id), ...beats(l), answer(l, 'skip', { expect: 'not-allowed' }), catchBug(c, l), answer(l, 'review'), answer(l, 'advance'), completed(l.id), left(l.id),
    ];
  },
];

/** Learner i's script; scripts repeat past the third learner. Event ids are made here, once per event. */
export function learnerScript(i: number, c: Course): Step[] {
  return SCRIPTS[i % SCRIPTS.length](c);
}

export interface LearnerSummary {
  index: number;
  actor: string;
  sent: number;
  ok: number;
  refusedAsIntended: number;
  failed: number;
  failures: string[];
  deleted: boolean;
}

type Fact = { lessonId: string; kind: string };
export interface ShadowReport {
  day: string;
  actors: number;
  diffs: { actor: string; missingInLrs: Fact[]; extraInLrs: Fact[] }[];
  truncated?: boolean;
}

export interface DriveOptions extends WaitOptions {
  adminToken: string;
  fetch?: typeof fetch;
  learners?: number;
  keep?: boolean;
  course?: Course;
  log?: (line: string) => void;
  requestTimeoutMs?: number;
}

interface Driven extends LearnerSummary {
  cookie: string;
  clientId: string;
  learnerId: string;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function judge(step: Step, r: EventResult | undefined): 'ok' | 'refused' | string {
  const want = step.expect ?? 'ok';
  if (want === 'not-allowed') return r && !r.ok && r.error === 'not-allowed' ? 'refused' : `expected not-allowed, got ${r ? (r.ok ? 'ok' : r.error) : 'no result'}`;
  if (!r) return 'no result';
  if (!r.ok) return r.error;
  if (want === 'passed' && r.passed !== true) return 'the code checks did not pass';
  return 'ok';
}

export async function drive(baseUrl: string, opts: DriveOptions): Promise<{ exitCode: 0 | 1; learners: LearnerSummary[]; report: ShadowReport | null }> {
  const n = opts.learners ?? 3;
  if (!Number.isInteger(n) || n <= 0) throw new Error(`learners must be a positive integer, got ${n}`);
  const base = baseUrl.replace(/\/+$/, '');
  const raw = opts.fetch ?? fetch;
  const f: typeof fetch = (url, init) => raw(url, { ...init, signal: AbortSignal.timeout(opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS) });
  const log = opts.log ?? ((s: string) => console.log(s));
  const now = opts.now ?? Date.now;
  const course = opts.course ?? loadCourse();
  const problems: string[] = [];
  const learners: Driven[] = [];
  const startDay = dayOf(now());

  const headers = (l: Driven) => ({ cookie: l.cookie, 'content-type': 'application/json', 'x-client-id': l.clientId });

  async function post(l: Driven, events: ServerEvent[]): Promise<Map<string, EventResult>> {
    const out = new Map<string, EventResult>();
    for (let i = 0; i < events.length; i += EVENTS_MAX) {
      const chunk = events.slice(i, i + EVENTS_MAX);
      l.sent += chunk.length;
      const res = await f(`${base}/api/events`, { method: 'POST', headers: headers(l), body: JSON.stringify({ learnerId: l.learnerId, events: chunk }) }).catch(() => null);
      if (!res?.ok) {
        problems.push(`learner ${l.index}: POST /api/events answered ${res ? res.status : 'network error'}`);
        continue;
      }
      const body = (await res.json().catch(() => null)) as { results?: EventResult[] } | null;
      for (const r of Array.isArray(body?.results) ? body.results : []) out.set(r.eventId, r);
    }
    return out;
  }

  async function run(l: Driven, steps: Step[]): Promise<void> {
    let beats: Step[] = [];
    const settle = (sent: Step[], results: Map<string, EventResult>) => {
      for (const s of sent) {
        const verdict = judge(s, results.get(s.event.eventId));
        if (verdict === 'ok') l.ok++;
        else if (verdict === 'refused') l.refusedAsIntended++;
        else {
          l.failed++;
          l.failures.push(`${s.event.type} ${'lessonId' in s.event ? s.event.lessonId : s.event.placement.pathId}: ${verdict}`);
        }
      }
    };
    for (const s of steps) {
      // Beats wait for the next event and go ahead of it, as the studio's queue sends them.
      if (s.event.type === 'beatViewed') {
        beats.push(s);
        continue;
      }
      const batch = [...beats, s];
      beats = [];
      settle(batch, await post(l, batch.map((b) => b.event)));
    }
    if (beats.length) settle(beats, await post(l, beats.map((b) => b.event)));
  }

  async function start(index: number): Promise<Driven> {
    const clientId = crypto.randomUUID();
    const res = await f(`${base}/api/session`, { method: 'POST', headers: { 'x-client-id': clientId } });
    if (!res.ok) throw new Error(`learner ${index}: session create failed: ${res.status}`);
    const cookie = /lwr_sid=[^;,\s]+/.exec(res.headers.get('set-cookie') ?? '')?.[0];
    if (!cookie) throw new Error(`learner ${index}: no lwr_sid cookie in the session response (a learner may have been leaked)`);
    const actor = String(((await res.json().catch(() => null)) as { actor?: { name?: unknown } } | null)?.actor?.name ?? '');
    // The server names the actor from the session and ignores the body's learnerId; the studio sends one anyway.
    const learnerId = UUID.test(actor) ? actor : crypto.randomUUID();
    return { index, actor, cookie, clientId, learnerId, sent: 0, ok: 0, refusedAsIntended: 0, failed: 0, failures: [], deleted: false };
  }

  async function remove(l: Driven): Promise<void> {
    const res = await f(`${base}/api/session`, { method: 'DELETE', headers: headers(l) }).catch(() => null);
    if (res?.ok) l.deleted = true;
    else problems.push(`learner ${l.index}: delete failed (${res ? res.status : 'network error'}); it may have been leaked`);
  }

  async function readReport(): Promise<ShadowReport | 'fatal' | null> {
    const days = [...new Set([startDay, dayOf(now())])];
    const merged: ShadowReport = { day: days.join(', '), actors: 0, diffs: [] };
    for (const day of days) {
      const res = await f(`${base}/api/admin/shadow?day=${day}`, { headers: { authorization: `Bearer ${opts.adminToken}` } }).catch(() => null);
      if (res && (res.status === 400 || res.status === 401 || res.status === 403)) {
        problems.push(`shadow report: ${res.status} (check ADMIN_TOKEN)`);
        return 'fatal';
      }
      const body = res?.ok ? ((await res.json().catch(() => null)) as ShadowReport | null) : null;
      if (!body || !Array.isArray(body.diffs) || typeof body.actors !== 'number') return null;
      merged.actors += body.actors;
      merged.diffs.push(...body.diffs);
      if (body.truncated) merged.truncated = true;
    }
    return merged;
  }

  let report: ShadowReport | null = null;
  try {
    for (let i = 0; i < n; i++) {
      const l = await start(i);
      learners.push(l);
      await run(l, learnerScript(i, course));
      if (i === n - 1 && !opts.keep) await remove(l);
    }
    const kept = learners.filter((l) => !l.deleted && l.ok > 0).length;
    let fatal = false;
    try {
      await waitForComplete(
        async () => {
          const r = await readReport();
          if (r === 'fatal') return (fatal = true);
          if (r) report = r;
          return !!r && r.diffs.length === 0 && r.actors >= kept;
        },
        'the shadow report',
        { pollMs: opts.pollMs ?? POLL_MS, timeoutMs: opts.timeoutMs ?? DRAIN_MS, now, sleep: opts.sleep },
      );
    } catch (e) {
      // Timed out: what the last readable report says stands.
      if (!(e instanceof Error && /timed out/.test(e.message))) throw e;
    }
    if (fatal) report = null;
    else if (!report) problems.push(`shadow report could not be read`);
    else if ((report as ShadowReport).actors < kept) problems.push(`shadow report names ${(report as ShadowReport).actors} actor(s), fewer than the ${kept} learner(s) kept`);
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  } finally {
    if (!opts.keep) for (const l of learners) if (!l.deleted) await remove(l);
  }

  for (const l of learners) {
    log(`learner ${l.index} (actor ${l.actor}): ${l.sent} events sent, ${l.ok} ok, ${l.refusedAsIntended} refused as intended, ${l.failed} failed`);
    for (const why of l.failures) log(`  failed: ${why}`);
  }
  const shown = report as ShadowReport | null;
  if (shown) {
    const missing = shown.diffs.reduce((k, d) => k + d.missingInLrs.length, 0);
    const extra = shown.diffs.reduce((k, d) => k + d.extraInLrs.length, 0);
    log(`shadow report: ${shown.diffs.length} actor(s) with diffs: ${missing} missing in LRS, ${extra} extra in LRS (${shown.day}; ${shown.actors} actor(s) recorded)`);
    const entries = shown.diffs.flatMap((d) => [
      ...d.missingInLrs.map((x) => `${d.actor} missingInLrs ${x.kind} ${x.lessonId}`),
      ...d.extraInLrs.map((x) => `${d.actor} extraInLrs ${x.kind} ${x.lessonId}`),
    ]);
    for (const e of entries.slice(0, SHOW_DIFFS)) log(`  ${e}`);
    if (entries.length > SHOW_DIFFS) log(`  ... and ${entries.length - SHOW_DIFFS} more`);
    if (shown.truncated) log('  (the LRS had more statements than one page for some actor)');
  }
  const deleted = learners.filter((l) => l.deleted).length;
  log(opts.keep ? `kept ${learners.length} learner(s) (--keep)` : `deleted ${deleted} of ${learners.length} learner(s)`);
  for (const p of problems) log(`problem: ${p}`);

  const failed = problems.length > 0 || learners.some((l) => l.failed > 0) || !shown || shown.diffs.length > 0;
  log(failed ? 'FAIL' : 'PASS');
  return { exitCode: failed ? 1 : 0, learners: learners.map(({ cookie: _c, clientId: _i, learnerId: _l, ...s }) => s), report: shown };
}

export function parseArgs(argv: string[]): { base: string; learners: number; keep: boolean } {
  const usage = 'usage: npx tsx scripts/drive-learners.ts <baseUrl> [--learners N] [--keep]';
  let base = '';
  let learners = 3;
  let keep = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep') keep = true;
    else if (a === '--learners') {
      learners = Number(argv[++i]);
      if (!Number.isInteger(learners) || learners <= 0) throw new Error(`--learners must be a positive integer\n${usage}`);
    } else if (!a.startsWith('--') && !base) base = a;
    else throw new Error(usage);
  }
  if (!base) throw new Error(usage);
  return { base, learners, keep };
}

/** ADMIN_TOKEN from the environment, else from ENV_FILE (default .env.server); '' when neither has it. */
export function readAdminToken(
  env: Record<string, string | undefined> = process.env,
  read: (file: string) => string = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : ''),
): string {
  return env.ADMIN_TOKEN?.trim() || (/^ADMIN_TOKEN=(.*)$/m.exec(read(env.ENV_FILE ?? '.env.server'))?.[1].trim() ?? '');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    const adminToken = readAdminToken();
    if (!adminToken) throw new Error('ADMIN_TOKEN is not set (environment, or ENV_FILE, default .env.server)');
    const r = await drive(args.base, { adminToken, learners: args.learners, keep: args.keep });
    process.exitCode = r.exitCode;
  })().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
