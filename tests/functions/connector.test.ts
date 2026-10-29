import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorClient,
  ConnectorError,
  ConnectorUnavailable,
} from "../../functions/_lib/ledger/connector";
import type { Env } from "../../functions/_lib/env";

const SEED_HEX =
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const KEY = Buffer.from(
  "302e020100300506032b657004220420" + SEED_HEX,
  "hex",
).toString("base64");
const env = {
  DB: {} as Env["DB"],
  CONNECTOR_SIGNING_KEY: KEY,
  CONNECTOR_KEY_ID: "kid1",
} as Env;

afterEach(() => vi.useRealTimers());

describe("ConnectorClient", () => {
  it("getPackage sends If-None-Match and maps 304", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 304 }));
    const r = await new ConnectorClient(
      env,
      fetchFn as unknown as typeof fetch,
    ).getPackage("learn-wp-reimagined", '"abc"');
    expect(r).toEqual({ status: 304 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://learnwp.sqwrlz.com/wp-json/learning-ledger/v1/course-server/packages/learn-wp-reimagined",
    );
    const h = init.headers as Record<string, string>;
    expect(h["If-None-Match"]).toBe('"abc"');
    expect(h["X-Learning-Ledger-Key"]).toBe("kid1");
    expect(h["X-Learning-Ledger-Signature"]).toBeTruthy();
  });

  it("maps a 200 to etag, version and zip bytes", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(new Uint8Array([80, 75, 3, 4]), {
          status: 200,
          headers: { ETag: '"e1"', "X-Package-Version": "7" },
        }),
    );
    const r = await new ConnectorClient(
      env,
      fetchFn as unknown as typeof fetch,
    ).getPackage("p");
    expect(r).toEqual({
      status: 200,
      etag: '"e1"',
      version: 7,
      zip: new Uint8Array([80, 75, 3, 4]),
    });
    const h = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(h["If-None-Match"]).toBeUndefined();
  });

  it("maps the status route payload", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            plugin_version: "1.2.3",
            wp_version: "6.9",
            php_version: "8.3.1",
            roles: ["learner"],
            sodium: "native",
            connector: { secret_sha256: "ff00" },
          }),
          { status: 200 },
        ),
    );
    const s = await new ConnectorClient(
      env,
      fetchFn as unknown as typeof fetch,
    ).status();
    expect(s).toEqual({
      versions: { plugin: "1.2.3", wordpress: "6.9", php: "8.3.1" },
      roles: ["learner"],
      sensei: null,
      certificates: null,
      sodium: "native",
      trustedKeys: [],
      connectorSecretSha256: "ff00",
    });
  });

  it("maps connector.actor_home_page when it is a string", async () => {
    const mk = (connector: unknown) =>
      new ConnectorClient(
        env,
        (async () => new Response(JSON.stringify({ connector }), { status: 200 })) as unknown as typeof fetch,
      ).status();
    expect((await mk({ actor_home_page: "https://learnwp.sqwrlz.com" })).actorHomePage).toBe(
      "https://learnwp.sqwrlz.com",
    );
    expect((await mk({ actor_home_page: 5 })).actorHomePage).toBeUndefined();
    expect((await mk({})).actorHomePage).toBeUndefined();
  });

  it("throws ConnectorUnavailable on a 5xx and ConnectorError on a 4xx", async () => {
    const mk = (s: number) =>
      new ConnectorClient(
        env,
        (async () =>
          new Response("x", { status: s })) as unknown as typeof fetch,
      );
    await expect(mk(503).status()).rejects.toBeInstanceOf(ConnectorUnavailable);
    await expect(mk(401).status()).rejects.toBeInstanceOf(ConnectorError);
  });

  it("throws ConnectorUnavailable when the signing key is not configured", async () => {
    const c = new ConnectorClient(
      { DB: {} as Env["DB"] } as Env,
      vi.fn() as unknown as typeof fetch,
    );
    await expect(c.status()).rejects.toBeInstanceOf(ConnectorUnavailable);
  });

  it("throws ConnectorUnavailable after 3 s", async () => {
    vi.useFakeTimers();
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        if (init.signal!.aborted) rej(new Error("aborted"));
        init.signal!.addEventListener("abort", () => rej(new Error("aborted")));
      })) as unknown as typeof fetch;
    const p = new ConnectorClient(env, hang).status();
    const assertion = expect(p).rejects.toBeInstanceOf(ConnectorUnavailable);
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });
});

describe("request path", () => {
  it("percent-encodes the program in the signed path", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 304 }));
    await new ConnectorClient(
      env,
      fetchFn as unknown as typeof fetch,
    ).getPackage("a b");
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toMatch(
      /packages\/a%20b$/,
    );
  });
});

describe("learner routes", () => {
  const env2 = { ...env, SENSEI_COURSE_IDS: '{"learner":12,"block-theme":13}' } as Env;
  const client = (fetchFn: unknown) => new ConnectorClient(env2, fetchFn as typeof fetch);
  const call = (f: ReturnType<typeof vi.fn>) =>
    f.mock.calls[0] as unknown as [string, RequestInit];
  const base = "https://learnwp.sqwrlz.com/wp-json/learning-ledger/v1/course-server/learners";

  it("createLearner POSTs and flattens the nested actor", async () => {
    const f = vi.fn(async () =>
      new Response(
        JSON.stringify({ user_id: 41, actor: { objectType: "Agent", account: { homePage: "https://h", name: "n-1" } } }),
        { status: 201 },
      ),
    );
    expect(await client(f).createLearner()).toEqual({ userId: 41, actor: { homePage: "https://h", name: "n-1" } });
    expect(call(f)[0]).toBe(base);
    expect(call(f)[1].method).toBe("POST");
  });

  it("enrol sends the configured Sensei course id", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await client(f).enrol(41, "block-theme");
    expect(call(f)[0]).toBe(`${base}/41/enrolments`);
    expect(new TextDecoder().decode(call(f)[1].body as Uint8Array)).toBe('{"course":13}');
    expect((call(f)[1].headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("enrol without a configured course id is a ConnectorError and sends nothing", async () => {
    const f = vi.fn();
    await expect(client(f).enrol(41, "vibe-coder")).rejects.toBeInstanceOf(ConnectorError);
    expect(f).not.toHaveBeenCalled();
  });

  it("progress maps the ledger courses to SenseiProgress", async () => {
    const f = vi.fn(async () =>
      new Response(
        JSON.stringify({
          courses: [
            { course: 12, completed: [7, 8], tested_out: [9], course_completed: true, certificate: "https://c" },
            { course: 13, completed: [], tested_out: [], course_completed: false, certificate: null },
          ],
          program_satisfied: false,
        }),
        { status: 200 },
      ),
    );
    expect(await client(f).progress(41, "5")).toEqual({
      enrolled: ["learner", "block-theme"],
      completedLessons: ["7", "8"],
      testedOutLessons: ["9"],
      completedCourses: ["learner"],
      certificates: ["learner"],
    });
    expect(call(f)[0]).toMatch(new RegExp(`^${base.replace(/[.?]/g, '\\$&')}/41/progress\\?program=5&nc=[0-9a-f-]{36}$`));
  });

  it("progress sends a fresh nc on every read, so a page cache in front of WordPress never answers it", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ courses: [] }), { status: 200 }));
    await client(f).progress(41, "5");
    await client(f).progress(41, "5");
    const nc = (f.mock.calls as unknown as [string][]).map(([u]) => new URL(u).searchParams.get("nc"));
    expect(nc[0]).toBeTruthy();
    expect(nc[0]).not.toBe(nc[1]);
  });

  it("deleteLearner DELETEs the learner", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await client(f).deleteLearner(41);
    expect(call(f)[0]).toBe(`${base}/41`);
    expect(call(f)[1].method).toBe("DELETE");
  });

  it("built without a fetchFn, calls the global fetch with no receiver (Workers)", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis)
        throw new TypeError("Illegal invocation");
      return Promise.resolve(
        new Response(JSON.stringify({ roles: [] }), { status: 200 }),
      );
    } as unknown as typeof fetch;
    try {
      const st = await new ConnectorClient(env).status();
      expect(st.roles).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
