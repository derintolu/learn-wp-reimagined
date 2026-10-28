import { clientId } from '../clientId';
import { FEATURES, phaseOn } from '../config';
import { ensureSession, forgetSession } from './session';
import { EVENTS_MAX, type EventResult, type ServerEvent } from '../shared/events';

/** Beats are batched and sent this often; they never hold up the learner. */
export const BEAT_FLUSH_MS = 30_000;
/** How long a single send waits for the course server before the local statements are kept. */
export const SEND_TIMEOUT_MS = 8000;

type NewEvent = ServerEvent extends infer E ? (E extends { eventId: string } ? Omit<E, 'eventId'> : never) : never;
type LeftEvent = Extract<ServerEvent, { type: 'lessonLeft' }>;
type BeatEvent = Extract<ServerEvent, { type: 'beatViewed' }>;

const newEventId = () => crypto.randomUUID();

/** Where non-beat events that never reached the course server wait to be resent (with phaseOn('lrsShadow')). */
export const OUTBOX_KEY = 'lwr-event-outbox';
const OUTBOX_MAX = 100;
type Kept = Exclude<ServerEvent, BeatEvent>;

function loadOutbox(): Kept[] {
  try {
    const v = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((e): e is Kept => !!e && typeof e.eventId === 'string' && typeof e.type === 'string' && e.type !== 'beatViewed') : [];
  } catch {
    return [];
  }
}
function saveOutbox(events: Kept[]): void {
  try {
    if (events.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(events.slice(-OUTBOX_MAX)));
    else localStorage.removeItem(OUTBOX_KEY);
  } catch {
    // Without storage a failed event is not resent, as before.
  }
}

/** A failed request worth trying again with the same events: no answer, a timeout, no session, a limit or a 5xx. */
const retryable = (status: number | null) => status === null || status === 401 || status === 408 || status === 429 || status >= 500;

/**
 * Sends the studio's events to the course server (`POST /api/events`). Returns the server's answer
 * for an event, or null when the server can't be reached or refuses it, so the caller can fall back
 * to local statements. An eventId is made once per event and reused on any resend.
 */
export class EventClient {
  private beats: BeatEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The lesson the studio has open, so leaving (or closing the tab) can say which one ended. */
  private open: { lessonId: string; left: LeftEvent } | null = null;

  constructor(private learnerId: () => string) {
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this.beacon());
    // Events kept from an earlier page go out with the next batch, or at the next beat flush.
    if (this.outboxOn() && loadOutbox().length) this.arm();
  }

  /**
   * With the LRS shadow on, the course server is the only writer of the official record, so a non-beat event
   * that never reached it is kept and resent with the same eventId (the server is idempotent per eventId).
   */
  private outboxOn(): boolean {
    return phaseOn('lrsShadow');
  }

  queueBeat(lessonId: string, beatIndex: number): void {
    this.beats.push({ eventId: newEventId(), type: 'beatViewed', lessonId, beatIndex });
    this.arm();
  }

  /** The learner opened a lesson. Sent in the background; nothing waits for it. */
  lessonOpened(lessonId: string): void {
    this.lessonLeft();
    this.open = { lessonId, left: { eventId: newEventId(), type: 'lessonLeft', lessonId } };
    void this.send({ type: 'lessonOpened', lessonId });
  }

  /** The learner left the open lesson (if any). Sent in the background, after any queued beats. */
  lessonLeft(): void {
    const open = this.open;
    this.open = null;
    if (open) void this.send(open.left);
  }

  private arm(): void {
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, BEAT_FLUSH_MS);
  }

  async send(e: NewEvent | LeftEvent): Promise<EventResult | null> {
    const event = { eventId: newEventId(), ...e } as ServerEvent;
    // Queued beats go first, so the server sees events in the order they happened.
    const results = await this.post([...this.drain(), event]);
    return results.get(event.eventId) ?? null;
  }

  /** Drop everything still waiting to be sent (after the learner deletes their data). */
  discard(): void {
    this.drain();
    if (this.outboxOn()) saveOutbox([]);
  }

  async flush(): Promise<void> {
    const beats = this.drain();
    if (beats.length || (this.outboxOn() && loadOutbox().length)) await this.post(beats);
  }

  private drain(): BeatEvent[] {
    clearTimeout(this.timer);
    this.timer = undefined;
    const out = this.beats;
    this.beats = [];
    return out;
  }

  /**
   * Posts in batches of at most EVENTS_MAX, kept events first. Beats in a batch that fails are queued again;
   * with the outbox on, other events in a batch that failed for a reason worth retrying are kept.
   */
  private async post(fresh: ServerEvent[]): Promise<Map<string, EventResult>> {
    const out = new Map<string, EventResult>();
    const kept = this.outboxOn() ? loadOutbox() : [];
    const ids = new Set(fresh.map((e) => e.eventId));
    const events = [...kept.filter((e) => !ids.has(e.eventId)), ...fresh];
    for (let i = 0; i < events.length; i += EVENTS_MAX) {
      const chunk = events.slice(i, i + EVENTS_MAX);
      const { results, status } = await this.postChunk(chunk);
      if (!results) {
        const failed = chunk.filter((ev): ev is BeatEvent => ev.type === 'beatViewed');
        if (failed.length) {
          this.beats.push(...failed);
          this.arm();
        }
        if (this.outboxOn()) {
          const keep = retryable(status) ? chunk.filter((ev): ev is Kept => ev.type !== 'beatViewed') : [];
          const drop = new Set(chunk.map((e) => e.eventId));
          saveOutbox([...loadOutbox().filter((e) => !drop.has(e.eventId)), ...keep]);
          if (keep.length) this.arm();
        }
        continue;
      }
      for (const r of results) out.set(r.eventId, r);
      // Answered, whether accepted or refused: nothing to resend.
      if (this.outboxOn()) saveOutbox(loadOutbox().filter((e) => !chunk.some((c) => c.eventId === e.eventId)));
    }
    return out;
  }

  private async postChunk(events: ServerEvent[]): Promise<{ results: EventResult[] | null; status: number | null }> {
    // With senseiLearners on, making the first session also makes a WordPress learner, which can be slow:
    // the send's own window starts once the session is there. Before that phase the order is as it was.
    const sessionFirst = phaseOn('senseiLearners');
    if (sessionFirst && FEATURES.sessions) await ensureSession();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS);
    try {
      // A session names the learner to the server; without one the studio still sends as before.
      if (!sessionFirst && FEATURES.sessions) await ensureSession();
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-client-id': clientId() },
        body: JSON.stringify({ learnerId: this.learnerId(), events }),
        signal: ctl.signal,
      });
      if (!res.ok) {
        // The session is gone or unknown: keep the local statements and ask for one at the next action.
        if (res.status === 401) forgetSession();
        return { results: null, status: res.status };
      }
      const j = (await res.json()) as { results?: unknown };
      return Array.isArray(j.results) ? { results: j.results as EventResult[], status: res.status } : { results: null, status: null };
    } catch {
      return { results: null, status: null };
    } finally {
      clearTimeout(timer);
    }
  }

  /** On pagehide: hand the queued beats, and the end of the open lesson, to the browser and don't wait for an answer. */
  private beacon(): void {
    const beats: ServerEvent[] = this.drain();
    if (this.open) {
      beats.push(this.open.left);
      this.open = null;
    }
    if (!beats.length || typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
    for (let i = 0; i < beats.length; i += EVENTS_MAX) {
      const body = JSON.stringify({ learnerId: this.learnerId(), events: beats.slice(i, i + EVENTS_MAX) });
      navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
    }
  }
}

let learnerIdSource: () => string = () => '';
let client: EventClient | null = null;

/** The record manager says where the learner's id lives. */
export function bindLearnerId(fn: () => string): void {
  learnerIdSource = fn;
}

export function getEventClient(): EventClient {
  client ??= new EventClient(() => learnerIdSource());
  return client;
}
