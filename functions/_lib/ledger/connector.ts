import type { Env } from "../env";
import { LEDGER_BASE } from "../config";
import { signRequest } from "./sign";
import type { PathId } from "../../../src/shared/types";

const TIMEOUT_MS = 3000;

/** Timeout, network failure or a 5xx from the ledger. */
export class ConnectorUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorUnavailable";
  }
}

/** A 4xx answer from the ledger (bad signature, missing capability, unknown program). */
export class ConnectorError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

/**
 * Fields follow the plugin's course-server/status route (Status_Route::payload plus the connector
 * module's additions). The route reports no Sensei/certificate state or trusted-key list, so those
 * stay null/empty until it does.
 */
export interface LedgerStatus {
  versions: Record<string, string>;
  roles: string[];
  sensei: string | null;
  certificates: string | null;
  sodium: "native" | "compat" | null;
  trustedKeys: string[];
  connectorSecretSha256?: string;
  /** The homePage Learning Ledger names learner actors by (the site's home URL). */
  actorHomePage?: string;
}

/** Progress of one learner, keyed by path id (courses) and by Sensei post id as a string (lessons). */
export interface SenseiProgress {
  enrolled: string[];
  completedLessons: string[];
  testedOutLessons: string[];
  completedCourses: string[];
  certificates: string[];
}

export type PackageResult =
  | { status: 304 }
  | { status: 200; etag: string; version: number; zip: Uint8Array };

function nonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class ConnectorClient {
  constructor(
    private env: Env,
    private fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async status(): Promise<LedgerStatus> {
    const res = await this.send("GET", "/course-server/status");
    const j = (await res.json()) as Record<string, unknown>;
    const connector = (j.connector ?? {}) as Record<string, unknown>;
    const versions: Record<string, string> = {};
    for (const [k, v] of [
      ["plugin", j.plugin_version],
      ["wordpress", j.wp_version],
      ["php", j.php_version],
    ] as const) {
      if (typeof v === "string") versions[k] = v;
    }
    const out: LedgerStatus = {
      versions,
      roles: Array.isArray(j.roles)
        ? j.roles.filter((r): r is string => typeof r === "string")
        : [],
      sensei: null,
      certificates: null,
      sodium: j.sodium === "native" || j.sodium === "compat" ? j.sodium : null,
      trustedKeys: [],
    };
    if (typeof connector.secret_sha256 === "string")
      out.connectorSecretSha256 = connector.secret_sha256;
    if (typeof connector.actor_home_page === "string")
      out.actorHomePage = connector.actor_home_page;
    return out;
  }

  async getPackage(program: string, etag?: string): Promise<PackageResult> {
    const res = await this.send(
      "GET",
      `/course-server/packages/${encodeURIComponent(program)}`,
      etag ? { "If-None-Match": etag } : {},
    );
    if (res.status === 304) return { status: 304 };
    return {
      status: 200,
      etag: res.headers.get("ETag") ?? "",
      version: Number(res.headers.get("X-Package-Version") ?? 0),
      zip: new Uint8Array(await res.arrayBuffer()),
    };
  }

  /** POST course-server/learners: a new anonymous learner and its actor (the ledger nests it as account). */
  async createLearner(): Promise<{ userId: number; actor: { homePage: string; name: string } }> {
    const res = await this.send("POST", "/course-server/learners");
    const j = (await res.json()) as { user_id?: unknown; actor?: { account?: { homePage?: unknown; name?: unknown } } };
    const account = j.actor?.account;
    if (typeof j.user_id !== "number" || typeof account?.homePage !== "string" || typeof account.name !== "string")
      throw new ConnectorUnavailable("ledger returned an unusable learner");
    return { userId: j.user_id, actor: { homePage: account.homePage, name: account.name } };
  }

  /** POST learners/{id}/enrolments {course}: the ledger takes the Sensei course post id, taken from SENSEI_COURSE_IDS. */
  async enrol(userId: number, courseKey: PathId): Promise<void> {
    await this.send(
      "POST",
      `/course-server/learners/${userId}/enrolments`,
      { "Content-Type": "application/json" },
      new TextEncoder().encode(JSON.stringify({ course: this.courseId(courseKey) })),
    );
  }

  /**
   * GET learners/{id}/progress?program=<ledger program post id>.
   */
  async progress(userId: number, program: string): Promise<SenseiProgress> {
    const res = await this.send(
      "GET",
      `/course-server/learners/${userId}/progress?program=${encodeURIComponent(program)}`,
    );
    const j = (await res.json()) as { courses?: Array<Record<string, unknown>> };
    const byId = new Map(Object.entries(this.courseIds()).map(([k, v]) => [v, k]));
    const out: SenseiProgress = { enrolled: [], completedLessons: [], testedOutLessons: [], completedCourses: [], certificates: [] };
    for (const c of j.courses ?? []) {
      const key = byId.get(Number(c.course)) ?? String(c.course);
      out.enrolled.push(key);
      for (const l of Array.isArray(c.completed) ? c.completed : []) out.completedLessons.push(String(l));
      for (const l of Array.isArray(c.tested_out) ? c.tested_out : []) out.testedOutLessons.push(String(l));
      if (c.course_completed === true) out.completedCourses.push(key);
      if (c.certificate) out.certificates.push(key);
    }
    return out;
  }

  /** GET learners/{id}/certificates/{course}: the ledger's certificate PDF as a response (404 surfaces as ConnectorError). */
  async certificate(userId: number, courseKey: PathId): Promise<Response> {
    return this.send("GET", `/course-server/learners/${userId}/certificates/${this.courseId(courseKey)}`);
  }

  /**
   * DELETE learners/{id}: removes the WordPress user, its connector rows and (queued if need be) its LRS actors.
   * revokeBadges false (Learning Ledger 0.1.7+) keeps the badges the learner claimed; the query is part of the signed
   * path. Left out when true, the ledger's default.
   */
  async deleteLearner(userId: number, opts?: { revokeBadges?: boolean }): Promise<void> {
    const query = opts?.revokeBadges === false ? "?revokeBadges=false" : "";
    await this.send("DELETE", `/course-server/learners/${userId}${query}`);
  }

  private courseIds(): Record<string, number> {
    try {
      const v = JSON.parse(this.env.SENSEI_COURSE_IDS ?? "{}") as Record<string, unknown>;
      return Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => Number.isInteger(e[1])));
    } catch {
      return {};
    }
  }

  private courseId(key: PathId): number {
    const id = this.courseIds()[key];
    if (id === undefined) throw new ConnectorError(0, `no Sensei course id configured for ${key}`);
    return id;
  }

  /** Signed request with a 3 s timeout. Resolves for 2xx and 304; throws otherwise. */
  protected async send(
    method: string,
    route: string,
    extra: Record<string, string> = {},
    body = new Uint8Array(),
  ): Promise<Response> {
    const { CONNECTOR_SIGNING_KEY: key, CONNECTOR_KEY_ID: keyId } = this.env;
    if (!key || !keyId)
      throw new ConnectorUnavailable("connector signing key is not configured");
    const url = new URL(LEDGER_BASE + route);
    // Batcache in front of WordPress keys on the URL alone, so a repeated signed GET would be replayed to anyone.
    // A fresh `nc` makes every GET/HEAD URL unique; it is part of the signed path.
    if (method === "GET" || method === "HEAD") url.searchParams.set("nc", crypto.randomUUID());
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      const headers = await signRequest({
        method,
        path: url.pathname + url.search,
        body,
        keyId,
        privateKeyPkcs8B64: key,
        now: Math.floor(Date.now() / 1000),
        nonce: nonce(),
      });
      res = await this.fetchFn(url.href, {
        method,
        headers: { ...headers, ...extra },
        body: body.length ? body : undefined,
        signal: ctl.signal,
      });
    } catch (e) {
      throw new ConnectorUnavailable(
        ctl.signal.aborted
          ? "ledger request timed out"
          : `ledger request failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 500)
      throw new ConnectorUnavailable(`ledger answered ${res.status}`);
    if (res.status >= 400)
      throw new ConnectorError(res.status, `ledger answered ${res.status}`);
    return res;
  }
}
