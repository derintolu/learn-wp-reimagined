import { EVENTS_MAX, type EventResult, type ServerEvent } from '../shared/events';

/** Beats are batched and sent this often; they never hold up the learner. */
export const BEAT_FLUSH_MS = 30_000;
/** How long a single send waits for the course server before the local statements are kept. */
export const SEND_TIMEOUT_MS = 8000;

type NewEvent = ServerEvent extends infer E ? (E extends { eventId: string } ? Omit<E, 'eventId'> : never) : never;
type BeatEvent = Extract<ServerEvent, { type: 'beatViewed' }>;

const newEventId = () => crypto.randomUUID();

/**
 * Sends the studio's events to the course server (`POST /api/events`). Returns the server's answer
 * for an event, or null when the server can't be reached or refuses it, so the caller can fall back
 * to local statements. An eventId is made once per event and reused on any resend.
 */
export class EventClient {
  private beats: BeatEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private learnerId: () => string) {
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this.beacon());
  }

  queueBeat(lessonId: string, beatIndex: number): void {
    this.beats.push({ eventId: newEventId(), type: 'beatViewed', lessonId, beatIndex });
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, BEAT_FLUSH_MS);
  }

  async send(e: NewEvent): Promise<EventResult | null> {
    const event = { ...e, eventId: newEventId() } as ServerEvent;
    // Queued beats go first, so the server sees events in the order they happened.
    const results = await this.post([...this.drain(), event]);
    return results.get(event.eventId) ?? null;
  }

  async flush(): Promise<void> {
    const beats = this.drain();
    if (beats.length) await this.post(beats);
  }

  private drain(): BeatEvent[] {
    clearTimeout(this.timer);
    this.timer = undefined;
    const out = this.beats;
    this.beats = [];
    return out;
  }

  /** Posts in batches of at most EVENTS_MAX. Beats in a batch that fails are queued again. */
  private async post(events: ServerEvent[]): Promise<Map<string, EventResult>> {
    const out = new Map<string, EventResult>();
    for (let i = 0; i < events.length; i += EVENTS_MAX) {
      const chunk = events.slice(i, i + EVENTS_MAX);
      const results = await this.postChunk(chunk);
      if (!results) {
        for (const ev of chunk) if (ev.type === 'beatViewed') this.beats.push(ev);
        continue;
      }
      for (const r of results) out.set(r.eventId, r);
    }
    return out;
  }

  private async postChunk(events: ServerEvent[]): Promise<EventResult[] | null> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ learnerId: this.learnerId(), events }),
        signal: ctl.signal,
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { results?: unknown };
      return Array.isArray(j.results) ? (j.results as EventResult[]) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** On pagehide: hand the queued beats to the browser and don't wait for an answer. */
  private beacon(): void {
    const beats = this.drain();
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
