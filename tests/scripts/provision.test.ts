import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chmodSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generateKeys, generateLrsKey, readConnectorEnv } from '../../scripts/keys';
import { LRS_STATUS_URL, lrsStatus, provisionSpaceA, provisionSpaceB } from '../../scripts/provision';
import { httpSpacefastApi, type SpacefastApi } from '../../scripts/lib/spacefast';
import { ConnectorError, ConnectorUnavailable, type LedgerStatus } from '../../functions/_lib/ledger/connector';

const PUB = 'PUBKEYb64PUBKEYb64PUBKEYb64PUBKEYb64PUBKEYb64=';
const cfg = {
  spaceId: 'spc_test',
  ledgerZipUrl: 'https://example.test/learning-ledger.zip',
  backendViewZipUrl: 'https://example.test/lwr-backend-view.zip',
  publicKeyB64: PUB,
  programId: 7,
};
const EMPTY: LedgerStatus = { versions: {}, roles: [], sensei: null, certificates: null, sodium: null, trustedKeys: [] };

/** Fake API: `failing` returns ok=false for a command; `active` makes the is-active / option checks pass. */
function fake(opts: { active?: string[]; optionSet?: boolean; failOn?: string } = {}) {
  const calls: string[][] = [];
  const api: SpacefastApi = {
    async wpCli(_id, args) {
      calls.push(args);
      if (args[0] === 'plugin' && args[1] === 'is-active') return { ok: (opts.active ?? []).includes(args[2]) };
      if (args[0] === 'option' && args[1] === 'get') return { ok: !!opts.optionSet };
      return { ok: args.join(' ') !== opts.failOn };
    },
  };
  return { api, calls, installs: () => calls.filter((a) => !(a[1] === 'is-active' || a[0] === 'option')) };
}

describe('provisionSpaceA', () => {
  it('issues the exact arg arrays in order', async () => {
    const f = fake();
    let reads = 0;
    const report = await provisionSpaceA(f.api, async () => (reads++, EMPTY), cfg);
    expect(f.installs()).toEqual([
      ['plugin', 'install', 'sensei-lms', '--version=4.26.4', '--activate'],
      ['plugin', 'install', 'sensei-certificates', '--version=2.6.0', '--activate'],
      ['eval', "do_action('sensei_certificates_run_installer');"],
      ['plugin', 'install', cfg.ledgerZipUrl, '--activate', '--force'],
      ['plugin', 'install', cfg.backendViewZipUrl, '--activate', '--force'],
      ['rewrite', 'structure', '/%postname%/'],
      ['learning-ledger', 'role', 'enable', 'connector'],
      ['learning-ledger', 'connector', 'trust-key', '--id=course-server', '--public-key=' + PUB],
      ['learning-ledger', 'program', 'update', '7', '--course-server-url=https://learnwp.sqwrlz.com/api'],
    ]);
    expect(report.every((s) => s.state === 'done')).toBe(true);
    expect(reads).toBeGreaterThanOrEqual(report.length);
  });

  it('skips steps the status already reports', async () => {
    const f = fake({ active: ['sensei-lms', 'sensei-certificates', 'lwr-backend-view'], optionSet: true });
    const status: LedgerStatus = { ...EMPTY, versions: { plugin: '1.0.0' }, roles: ['connector'], trustedKeys: ['course-server'] };
    const report = await provisionSpaceA(f.api, async () => status, cfg);
    expect(f.installs()).toEqual([
      ['rewrite', 'structure', '/%postname%/'],
      ['learning-ledger', 'program', 'update', '7', '--course-server-url=https://learnwp.sqwrlz.com/api'],
    ]);
    expect(report.filter((s) => s.state === 'skipped').map((s) => s.name)).toEqual([
      'sensei', 'certificates', 'certificates-installer', 'ledger', 'backend-view', 'role', 'trust-key',
    ]);
  });

  it('stops and reports on the first failed step', async () => {
    const f = fake({ failOn: 'plugin install sensei-certificates --version=2.6.0 --activate' });
    const report = await provisionSpaceA(f.api, async () => EMPTY, cfg);
    expect(report.map((s) => [s.name, s.state])).toEqual([['sensei', 'done'], ['certificates', 'failed']]);
    expect(f.installs()).toHaveLength(2);
  });

  it('treats a 404 status route as nothing installed yet', async () => {
    const f = fake();
    const report = await provisionSpaceA(f.api, async () => { throw new ConnectorError(404, 'no route'); }, cfg);
    expect(report.every((s) => s.state === 'done')).toBe(true);
  });

  it('stops with a failed status step on any other status error, running nothing', async () => {
    for (const err of [new ConnectorUnavailable('connector signing key is not configured'), new ConnectorError(401, 'bad sig')]) {
      const f = fake();
      const report = await provisionSpaceA(f.api, async () => { throw err; }, cfg);
      expect(report).toEqual([{ name: 'status', state: 'failed' }]);
      expect(f.calls).toEqual([]);
    }
  });

  it('a transport error is a failed step, not "not installed"', async () => {
    const calls: string[][] = [];
    const api: SpacefastApi = { async wpCli(_i, a) { calls.push(a); throw new Error('network'); } };
    const report = await provisionSpaceA(api, async () => EMPTY, cfg);
    expect(report.map((s) => [s.name, s.state])).toEqual([['sensei', 'failed']]);
    expect(calls).toEqual([['plugin', 'is-active', 'sensei-lms']]);
  });

  it('skips the program step when no program id is given', async () => {
    const f = fake();
    const report = await provisionSpaceA(f.api, async () => EMPTY, { ...cfg, programId: undefined });
    expect(report.at(-1)).toMatchObject({ name: 'content-ping', state: 'skipped' });
  });

  it('no argument contains a value from .env.server other than the public key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prov-'));
    try {
      const envFile = join(dir, '.env.server');
      writeFileSync(envFile, 'ADMIN_TOKEN=adm-secret-123456\nSESSION_KEY=sess-secret-abcdef\n');
      const { publicKeyB64 } = generateKeys(envFile);
      const env = readFileSync(envFile, 'utf8');
      const secrets = env.split('\n').map((l) => l.split('=').slice(1).join('=')).filter((v) => v && v !== publicKeyB64 && v !== 'course-server');
      expect(secrets.length).toBeGreaterThanOrEqual(3);
      const f = fake();
      await provisionSpaceA(f.api, async () => EMPTY, { ...cfg, publicKeyB64 });
      const all = f.calls.flat().join('\n');
      for (const s of secrets) expect(all).not.toContain(s);
      expect(all).toContain(publicKeyB64);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const HASH = createHash('sha256').update('lrs-secret-value-123456').digest('hex');
const cfgB = { spaceId: 'spc_lrs', ledgerZipUrl: 'https://example.test/learning-ledger.zip', lrsSecretSha256: HASH };
const SCOPES = '--scopes=all,void,courses/write,badges/claim-links,records/view-links,actors/erase';

describe('provisionSpaceB', () => {
  it('issues the exact arg arrays in order', async () => {
    const f = fake({ active: ['lwr-spike'] });
    const report = await provisionSpaceB(f.api, async () => EMPTY, cfgB);
    expect(f.installs()).toEqual([
      ['plugin', 'deactivate', 'lwr-spike'],
      ['plugin', 'install', cfgB.ledgerZipUrl, '--activate', '--force'],
      ['learning-ledger', 'role', 'enable', 'lrs'],
      ['learning-ledger', 'client', 'create', '--id=course-server', '--secret-sha256=' + HASH, SCOPES],
    ]);
    expect(report.every((s) => s.state === 'done')).toBe(true);
  });

  it('skips steps the status already reports', async () => {
    const f = fake();
    const status: LedgerStatus = { ...EMPTY, versions: { plugin: '1.0.0' }, roles: ['lrs'] };
    const report = await provisionSpaceB(f.api, async () => status, cfgB);
    // spike inactive, ledger and role reported, client exists (the update probe succeeds)
    expect(f.installs()).toEqual([['learning-ledger', 'client', 'update', 'course-server', SCOPES]]);
    expect(report.map((s) => s.state)).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
  });

  it('creates the client when the role is on but the client is missing', async () => {
    const f = fake({ failOn: 'learning-ledger client update course-server ' + SCOPES });
    const status: LedgerStatus = { ...EMPTY, versions: { plugin: '1.0.0' }, roles: ['lrs'] };
    const report = await provisionSpaceB(f.api, async () => status, cfgB);
    expect(report.at(-1)).toMatchObject({ name: 'client', state: 'done' });
    expect(f.installs().at(-1)![2]).toBe('create');
  });

  it('stops on the first failed step', async () => {
    const f = fake({ failOn: 'learning-ledger role enable lrs' });
    const report = await provisionSpaceB(f.api, async () => EMPTY, cfgB);
    expect(report.map((s) => [s.name, s.state])).toEqual([['deactivate-spike', 'skipped'], ['ledger', 'done'], ['role', 'failed']]);
    expect(f.installs().some((a) => a[1] === 'client')).toBe(false);
  });

  it('treats a 404 status as nothing installed; any other status error runs nothing', async () => {
    const ok = await provisionSpaceB(fake().api, async () => { throw new ConnectorError(404, 'x'); }, cfgB);
    expect(ok.find((s) => s.name === 'ledger')!.state).toBe('done');
    const f = fake();
    const bad = await provisionSpaceB(f.api, async () => { throw new ConnectorError(500, 'x'); }, cfgB);
    expect(bad).toEqual([{ name: 'status', state: 'failed' }]);
    expect(f.calls).toEqual([]);
  });

  it('puts no secret in any argument, only the SHA-256 of LRS_SECRET', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prov-b-'));
    try {
      const envFile = join(dir, '.env.server');
      writeFileSync(envFile, 'ADMIN_TOKEN=adm-secret-123456\n');
      const { secretSha256 } = generateLrsKey(envFile);
      const secret = /^LRS_SECRET=(.+)$/m.exec(readFileSync(envFile, 'utf8'))![1];
      const f = fake({ active: ['lwr-spike'] });
      await provisionSpaceB(f.api, async () => EMPTY, { ...cfgB, lrsSecretSha256: secretSha256 });
      const all = f.calls.flat().join('\n');
      expect(all).not.toContain(secret);
      expect(all).not.toContain('adm-secret-123456');
      expect(all).toContain('--secret-sha256=' + secretSha256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('lrsStatus', () => {
  const mk = (status: number, body: unknown) =>
    (async (url: string) => { expect(url).toBe(LRS_STATUS_URL); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
  it('maps the public status route and throws ConnectorError on non-2xx', async () => {
    const s = await lrsStatus(mk(200, { plugin_version: '1.2.3', roles: ['lrs'], sodium: 'native' }));
    expect(s.versions).toEqual({ plugin: '1.2.3' });
    expect(s.roles).toEqual(['lrs']);
    await expect(lrsStatus(mk(404, {}))).rejects.toMatchObject({ status: 404 });
  });
});

describe('generateLrsKey', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lrs-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes LRS_KEY and a random LRS_SECRET once, 0600, returns only the hash, stable on re-run', () => {
    const f = join(dir, '.env.server');
    writeFileSync(f, 'ADMIN_TOKEN=x\n');
    chmodSync(f, 0o644);
    const a = generateLrsKey(f);
    const text = readFileSync(f, 'utf8');
    const secret = /^LRS_SECRET=([0-9a-f]{64})$/m.exec(text)![1];
    expect(text).toContain('LRS_KEY=course-server');
    expect(text).toContain('ADMIN_TOKEN=x');
    expect(a).toEqual({ secretSha256: createHash('sha256').update(secret).digest('hex') });
    expect(JSON.stringify(a)).not.toContain(secret);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    expect(generateLrsKey(f)).toEqual(a);
    expect(readFileSync(f, 'utf8')).toBe(text);
  });

  it('keeps an existing secret and fills only what is missing', () => {
    const f = join(dir, '.env.server');
    writeFileSync(f, 'LRS_SECRET=mine\n');
    expect(generateLrsKey(f).secretSha256).toBe(createHash('sha256').update('mine').digest('hex'));
    expect(readFileSync(f, 'utf8')).toContain('LRS_KEY=course-server');
  });
});

describe('generateKeys', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'keys-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes the key and id once, returns the raw 32-byte public key, and is stable on re-run', () => {
    const f = join(dir, '.env.server');
    writeFileSync(f, 'ADMIN_TOKEN=x\nCONNECTOR_SIGNING_KEY=\nCONNECTOR_KEY_ID=\n');
    const a = generateKeys(f);
    const text = readFileSync(f, 'utf8');
    expect(text).toMatch(/^CONNECTOR_SIGNING_KEY=[A-Za-z0-9+/]+=*$/m);
    expect(text).toContain('CONNECTOR_KEY_ID=course-server');
    expect(text).toContain('ADMIN_TOKEN=x');
    expect(Buffer.from(a.publicKeyB64, 'base64')).toHaveLength(32);
    expect(generateKeys(f).publicKeyB64).toBe(a.publicKeyB64);
    expect(readFileSync(f, 'utf8')).toBe(text);
  });

  it('tightens an existing 0644 file to 0600 when it writes the key', () => {
    const f = join(dir, '.env.server');
    writeFileSync(f, 'ADMIN_TOKEN=x\n');
    chmodSync(f, 0o644);
    generateKeys(f);
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });

  it('readConnectorEnv returns the file values', () => {
    const f = join(dir, '.env.server');
    generateKeys(f);
    const e = readConnectorEnv(f);
    expect(e.CONNECTOR_KEY_ID).toBe('course-server');
    expect(e.CONNECTOR_SIGNING_KEY.length).toBeGreaterThan(20);
  });

  it('creates the file when absent and never returns the private key', () => {
    const f = join(dir, 'new.env');
    const { publicKeyB64 } = generateKeys(f);
    const priv = /^CONNECTOR_SIGNING_KEY=(.+)$/m.exec(readFileSync(f, 'utf8'))![1];
    expect(publicKeyB64).not.toBe(priv);
    expect(Object.keys(generateKeys(f))).toEqual(['publicKeyB64']);
    expect(statSync(f).mode & 0o077).toBe(0);
  });
});

describe('httpSpacefastApi', () => {
  it('posts the args with the bearer token and reports success from data.status', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const mk = (status: string, httpOk = true) =>
      (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return new Response(JSON.stringify({ data: { status } }), { status: httpOk ? 200 : 500 });
      }) as unknown as typeof fetch;
    const api = httpSpacefastApi('tok-secret', mk('succeeded'));
    expect(await api.wpCli('spc_1', ['option', 'get', 'x'])).toEqual({ ok: true });
    expect(seen[0].url).toBe('https://api.spacefast.com/v1/spaces/spc_1/wp-cli');
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ args: ['option', 'get', 'x'] });
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok-secret');
    expect(await httpSpacefastApi('t', mk('failed')).wpCli('s', ['a'])).toEqual({ ok: false });
    expect(await httpSpacefastApi('t', mk('succeeded', false)).wpCli('s', ['a'])).toEqual({ ok: false });
  });
});
