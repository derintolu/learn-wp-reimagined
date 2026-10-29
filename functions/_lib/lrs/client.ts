import { LRS_API, LRS_XAPI } from '../config';
import type { Env } from '../env';
import type { XapiStatement } from '../../../vendor/learning-mcp/core/index.ts';

export type Actor = XapiStatement['actor'];

export interface StateKey {
  activityId: string;
  agent: Actor;
  /** Absent for a learner-wide document, such as the standard's current-registration pointer. */
  registration?: string;
  stateId: string;
}

/** One badge of a registration, as Learning Ledger's `GET /badges` lists it. */
export interface BadgeSummary {
  id: string;
  achievement: { id: string | null; name: string | null; image: string | null };
  status: string;
  created_at: string;
}

/**
 * The LRS did not answer in time, answered 5xx, 429 (rate limited) or 408, or has no credentials here.
 * Callers queue and retry; nothing is given up on.
 */
export class LrsUnavailable extends Error {
  constructor(message = 'the LRS is unavailable') {
    super(message);
    this.name = 'LrsUnavailable';
  }
}

/** The LRS refused a request (4xx). The message never includes credentials. */
export class LrsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'LrsError';
    this.status = status;
  }
}

const TIMEOUT_MS = 3000;
const XAPI_VERSION = '2.0.0';

/**
 * Client for Learning Ledger's LRS. Every call carries HTTP Basic credentials and the xAPI
 * version header, has a 3 s timeout, and never follows a redirect (it would carry the
 * credential elsewhere). Nothing here logs.
 */
export class LrsClient {
  constructor(
    private readonly env: Env,
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async send(url: string, init: { method: string; headers?: Record<string, string>; body?: BodyInit | Uint8Array }): Promise<Response> {
    const { LRS_KEY, LRS_SECRET } = this.env;
    if (!LRS_KEY || !LRS_SECRET) throw new LrsUnavailable('the LRS credentials are not configured');
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: init.method,
        headers: {
          Authorization: `Basic ${btoa(`${LRS_KEY}:${LRS_SECRET}`)}`,
          'X-Experience-API-Version': XAPI_VERSION,
          ...init.headers,
        },
        body: init.body as BodyInit | undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new LrsUnavailable('the LRS did not answer');
    }
    if (res.status >= 500 || res.status === 429 || res.status === 408) throw new LrsUnavailable(`the LRS failed (HTTP ${res.status})`);
    return res;
  }

  private fail(res: Response): LrsError {
    return new LrsError(res.status, `the LRS rejected the request (HTTP ${res.status})`);
  }

  private async readJson<T>(res: Response): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new LrsError(res.status, 'the LRS sent a reply that could not be read');
    }
  }

  private async postJson<T>(path: string, body: unknown, ok: number[]): Promise<T> {
    const res = await this.send(`${LRS_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!ok.includes(res.status)) throw this.fail(res);
    return this.readJson<T>(res);
  }

  async putStatement(s: XapiStatement): Promise<void> {
    const res = await this.send(`${LRS_XAPI}/statements?statementId=${encodeURIComponent(s.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    });
    // 204 also answers an identical re-PUT. 409 means the id holds a different statement: an error.
    if (res.status !== 204) throw this.fail(res);
  }

  async postStatements(s: XapiStatement[]): Promise<void> {
    if (s.length === 0) return;
    const res = await this.send(`${LRS_XAPI}/statements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    });
    if (!res.ok) throw this.fail(res);
  }

  /** One page. `more` is the LRS's relative paging link (path and query), absent on the last page. */
  async getStatements(q: { agent: Actor; registration?: string; since?: string; limit?: number }): Promise<{ statements: XapiStatement[]; more?: string }> {
    const p = new URLSearchParams({ agent: JSON.stringify(q.agent) });
    if (q.registration !== undefined) p.set('registration', q.registration);
    if (q.since !== undefined) p.set('since', q.since);
    if (q.limit !== undefined) p.set('limit', String(q.limit));
    const res = await this.send(`${LRS_XAPI}/statements?${p}`, { method: 'GET' });
    if (!res.ok) throw this.fail(res);
    const j = await this.readJson<{ statements?: XapiStatement[]; more?: string }>(res);
    return j.more ? { statements: j.statements ?? [], more: j.more } : { statements: j.statements ?? [] };
  }

  /** The next page, from the `more` link of a getStatements page. Only a link on the LRS's own origin is followed. */
  async getStatementsMore(more: string): Promise<{ statements: XapiStatement[]; more?: string }> {
    const base = new URL(LRS_XAPI);
    const url = new URL(more, base.origin);
    if (url.origin !== base.origin) throw new LrsError(502, 'the LRS sent a paging link to another origin');
    const res = await this.send(url.toString(), { method: 'GET' });
    if (!res.ok) throw this.fail(res);
    const j = await this.readJson<{ statements?: XapiStatement[]; more?: string }>(res);
    return j.more ? { statements: j.statements ?? [], more: j.more } : { statements: j.statements ?? [] };
  }

  private stateUrl(k: StateKey): string {
    const p = new URLSearchParams({ activityId: k.activityId, agent: JSON.stringify(k.agent) });
    if (k.registration !== undefined) p.set('registration', k.registration);
    p.set('stateId', k.stateId);
    return `${LRS_XAPI}/activities/state?${p}`;
  }

  async getState(q: StateKey): Promise<{ body: unknown; etag: string } | null> {
    const res = await this.send(this.stateUrl(q), { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) throw this.fail(res);
    return { body: await this.readJson<unknown>(res), etag: res.headers.get('ETag') ?? '' };
  }

  /** Without `ifMatch` the document is created (If-None-Match: *); with it, replaced if the ETag still matches. */
  async putState(q: StateKey, body: unknown, ifMatch?: string): Promise<{ etag: string } | { conflict: true }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ifMatch !== undefined) headers['If-Match'] = ifMatch;
    else headers['If-None-Match'] = '*';
    const res = await this.send(this.stateUrl(q), { method: 'PUT', headers, body: JSON.stringify(body) });
    if (res.status === 412) return { conflict: true };
    if (!res.ok) throw this.fail(res);
    // The LRS answers a state PUT with 204 and no ETag; read it back.
    const etag = res.headers.get('ETag') ?? (await this.getState(q))?.etag ?? '';
    return { etag };
  }

  /** Learning Ledger computes the ETag from the bytes; `etag` is the one the caller expects it to store. */
  async importCourse(zip: Uint8Array, etag: string): Promise<void> {
    const res = await this.send(`${LRS_API}/courses`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/zip' },
      body: zip,
    });
    if (res.status !== 200 && res.status !== 201) throw this.fail(res);
    const stored = await this.readJson<{ etag?: string }>(res);
    if (stored.etag !== etag) throw new LrsError(res.status, 'the LRS stored a different course package than the one sent');
  }

  /**
   * Erase an actor. Learning Ledger (c9b5915) takes no revocation option and leaves badge rows and revocation to
   * `learning_ledger/actor_erased` listeners, of which it registers none, so badges survive an erase unrevoked.
   * `revokeBadges` is sent for when it does; today it is ignored.
   */
  async eraseActor(actor: Actor, opts: { revokeBadges: boolean }): Promise<void> {
    await this.postJson('/actors/erase', { actor, revokeBadges: opts.revokeBadges }, [200]);
  }

  async mintViewLink(actor: Actor): Promise<string> {
    return (await this.postJson<{ url: string }>('/view-links', { actor }, [201])).url;
  }

  async mintClaimLink(actor: Actor, badge: string): Promise<string> {
    return (await this.postJson<{ url: string }>(`/badges/${encodeURIComponent(badge)}/claim-links`, { actor }, [201])).url;
  }

  async listBadges(registration: string): Promise<BadgeSummary[]> {
    const res = await this.send(`${LRS_API}/badges?registration=${encodeURIComponent(registration)}`, { method: 'GET' });
    if (!res.ok) throw this.fail(res);
    return this.readJson<BadgeSummary[]>(res);
  }
}
