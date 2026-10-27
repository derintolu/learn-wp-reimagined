// Phase 0 probe runner. Never prints or returns secrets: the gate token is read
// from SPIKE_TOKEN and only ever sent as a request header.

export type ProbeId =
  | 'wp-json-through-rewrites'
  | 'functions-self-fetch'
  | 'well-known-oauth'
  | 'sensei-installed'
  | 'certificate-headless'
  | 'lrs-host-basic-auth'
  | 'sodium'
  | 'did-json'
  | 'user-create-route'
  | 'functions-wait-until';

export interface ProbeResult {
  id: ProbeId;
  status?: number;
  contentType?: string;
  body?: string;
  bytes?: number;
  error?: string;
}

export interface ProbeVerdict {
  id: ProbeId;
  pass: boolean;
  note: string;
}

const LRS_DID = 'did:web:lrs.sqwrlz.com';

function parse(body: string | undefined): Record<string, unknown> | null {
  try {
    const v = JSON.parse(body ?? '');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isJson = (ct?: string) => /^application\/(json|[\w.+-]+\+json)\b/i.test(ct ?? '');

function judge(r: ProbeResult): { pass: boolean; note: string } {
  if (r.error) return { pass: false, note: `error: ${r.error}` };
  const ok = r.status === 200;
  const data = parse(r.body);
  switch (r.id) {
    case 'wp-json-through-rewrites':
      return ok && isJson(r.contentType) && data
        ? { pass: true, note: 'JSON from WordPress reached the browser' }
        : { pass: false, note: `got ${r.status} ${r.contentType ?? '?'} (app shell or blocked)` };
    case 'functions-self-fetch': {
      const inner = data?.status;
      return ok && inner === 200
        ? { pass: true, note: 'Function fetched its own WordPress' }
        : { pass: false, note: `inner status ${String(inner)}` };
    }
    case 'well-known-oauth':
      return ok && isJson(r.contentType) && data
        ? { pass: true, note: 'well-known routes served by Functions' }
        : { pass: false, note: `got ${r.status} ${r.contentType ?? '?'}` };
    case 'sensei-installed': {
      const pass = ok && !!data?.sensei && !!data?.certificates;
      return { pass, note: pass ? `Sensei ${String(data?.sensei)}, Certificates ${String(data?.certificates)}` : 'Sensei or Certificates missing' };
    }
    case 'certificate-headless': {
      const pass = ok && (r.bytes ?? 0) > 1000 && /^application\/pdf\b/i.test(r.contentType ?? '');
      return { pass, note: pass ? `${r.bytes} byte PDF` : `bytes=${r.bytes ?? 0} type=${r.contentType ?? '?'}` };
    }
    case 'lrs-host-basic-auth': {
      const pass = ok && data?.basic_auth_seen === true;
      return { pass, note: pass ? 'Authorization: Basic reached PHP' : 'Basic header did not reach PHP' };
    }
    case 'sodium': {
      const pass = ok && data?.sodium === true;
      return { pass, note: pass ? 'ext-sodium loaded' : 'ext-sodium missing' };
    }
    case 'did-json': {
      const typeOk = /^application\/(did\+json|json)\b/i.test(r.contentType ?? '');
      const pass = ok && typeOk && data?.id === LRS_DID;
      return { pass, note: pass ? 'did.json reached WordPress' : `got ${r.status} ${r.contentType ?? '?'} id=${String(data?.id)}` };
    }
    case 'user-create-route': {
      const pass = (r.status === 200 || r.status === 201) && typeof data?.id === 'number';
      return { pass, note: pass ? 'user created via plugin route' : `status ${r.status}` };
    }
    case 'functions-wait-until': {
      const keys = Array.isArray(data?.keys) ? (data!.keys as unknown[]) : [];
      const pass = ok && keys.includes('waitUntil');
      return { pass, note: pass ? 'waitUntil available' : `handler context keys: ${keys.join(',') || 'none'}` };
    }
  }
}

export function evaluateProbes(results: ProbeResult[]): ProbeVerdict[] {
  return results.map((r) => ({ id: r.id, ...judge(r) }));
}

const TOKEN_HEADER = 'x-lwr-spike-token';

async function hit(id: ProbeId, url: string, init: RequestInit = {}): Promise<ProbeResult> {
  try {
    const res = await fetch(url, { redirect: 'manual', ...init });
    const buf = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') ?? undefined;
    const body = /pdf|octet/i.test(contentType ?? '') ? undefined : new TextDecoder().decode(buf);
    return { id, status: res.status, contentType, body, bytes: buf.byteLength };
  } catch (e) {
    return { id, error: e instanceof Error ? e.message : 'fetch failed' };
  }
}

export async function runProbes(base: string, lrsBase: string): Promise<ProbeResult[]> {
  const b = base.replace(/\/+$/, '');
  const l = lrsBase.replace(/\/+$/, '');
  const token = process.env.SPIKE_TOKEN;
  const gated = token ? { [TOKEN_HEADER]: token } : null;
  const ping = `/wp-json/lwr-spike/v1/ping`;
  const noToken = (id: ProbeId): ProbeResult => ({ id, error: 'SPIKE_TOKEN not set' });

  const pingRes = await hit('wp-json-through-rewrites', b + ping);
  const wk1 = await hit('well-known-oauth', b + '/.well-known/oauth-protected-resource');
  const wk2 = await hit('well-known-oauth', b + '/.well-known/oauth-authorization-server');
  const wk = wk1.status === 200 ? wk2 : wk1;

  let cert: ProbeResult;
  let user: ProbeResult;
  if (gated) {
    const c = await hit('certificate-headless', b + '/wp-json/lwr-spike/v1/cert-test', { method: 'POST', headers: gated });
    const cd = parse(c.body);
    cert = c.error
      ? c
      : { id: 'certificate-headless', status: c.status, bytes: Number(cd?.bytes ?? 0), contentType: String(cd?.contentType ?? c.contentType ?? ''), body: c.body };
    user = await hit('user-create-route', b + '/wp-json/lwr-spike/v1/users', { method: 'POST', headers: gated });
  } else {
    cert = noToken('certificate-headless');
    user = noToken('user-create-route');
  }

  return [
    pingRes,
    await hit('functions-self-fetch', b + '/api/selfcall'),
    wk,
    { ...pingRes, id: 'sensei-installed' },
    cert,
    await hit('lrs-host-basic-auth', l + ping, { headers: { authorization: 'Basic ' + Buffer.from('spike:spike').toString('base64') } }),
    { ...pingRes, id: 'sodium' },
    await hit('did-json', l + '/.well-known/did.json'),
    user,
    await hit('functions-wait-until', b + '/api/ctx'),
  ];
}

// CLI: SPIKE_TOKEN=... npx tsx spikes/phase0/probe.ts <base> <lrsBase>
if (process.argv[1] && /phase0[\\/]probe\.ts$/.test(process.argv[1])) {
  const [base, lrs] = process.argv.slice(2);
  if (!base || !lrs) {
    console.error('usage: tsx spikes/phase0/probe.ts <base-url> <lrs-base-url>');
    process.exit(2);
  }
  runProbes(base, lrs).then((r) => {
    for (const v of evaluateProbes(r)) console.log(`${v.pass ? 'PASS' : 'FAIL'}  ${v.id}  ${v.note}`);
  });
}
