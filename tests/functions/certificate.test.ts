import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SERVER_FLAGS } from '../../functions/_lib/config';
import { createSqliteD1 } from '../../dev/sqliteD1';
import { ensureSchema } from '../../functions/_lib/db';
import type { Env } from '../../functions/_lib/env';
import { POST as create } from '../../functions/api/session';
import { GET as certificate } from '../../functions/api/sensei/certificate';

const SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const SIGNING = Buffer.from('302e020100300506032b657004220420' + SEED_HEX, 'hex').toString('base64');
let env: Env;
let urls: string[];
let complete: boolean;
let pdfStatus: number;

const learner = () =>
  new Response(JSON.stringify({ user_id: 77, actor: { objectType: 'Agent', account: { homePage: 'https://ledger.example', name: 'a1' } } }), { status: 201 });
const progress = () =>
  new Response(JSON.stringify({ courses: [{ course: 13, completed: [], tested_out: [], course_completed: complete, certificate: complete ? 'x' : null }] }), { status: 200 });

async function cookie(): Promise<string> {
  const res = await create(new Request('http://x/api/session', { method: 'POST', headers: { 'cf-connecting-ip': '10.0.0.1' } }), { params: {}, env });
  return res.headers.get('set-cookie')!.split(';')[0];
}
const get = (c?: string, path = 'block-theme') =>
  certificate(new Request(`http://x/api/sensei/certificate?path=${path}`, { headers: c ? { cookie: c } : {} }), { params: {}, env });

beforeEach(async () => {
  const db = createSqliteD1();
  await ensureSchema(db);
  SERVER_FLAGS.senseiLearners = true;
  SERVER_FLAGS.senseiCertificates = true;
  complete = true;
  pdfStatus = 200;
  env = {
    DB: db,
    SESSION_KEY: 'k',
    CONNECTOR_SIGNING_KEY: SIGNING,
    CONNECTOR_KEY_ID: 'kid1',
    SENSEI_COURSE_IDS: '{"block-theme":13}',
    LEDGER_PROGRAM_ID: '5',
  };
  urls = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    urls.push(url);
    if (init.method === 'POST') return learner();
    if (url.includes('/certificates/')) return new Response(new Uint8Array([37, 80, 68, 70]), { status: pdfStatus, headers: { 'Content-Type': 'application/pdf' } });
    return progress();
  });
});
afterEach(() => {
  SERVER_FLAGS.senseiLearners = false;
  SERVER_FLAGS.senseiCertificates = false;
  vi.unstubAllGlobals();
});

describe('GET /api/sensei/certificate', () => {
  it("streams the connector's PDF", async () => {
    const res = await get(await cookie());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="block-theme-certificate.pdf"');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([37, 80, 68, 70]);
    expect(urls.at(-1)).toContain('/learners/77/certificates/13');
  });

  it('404 before course completion', async () => {
    complete = false;
    const res = await get(await cookie());
    expect(res.status).toBe(404);
    expect(urls.some((u) => u.includes('/certificates/'))).toBe(false);
  });

  it('404 when the ledger has no certificate', async () => {
    pdfStatus = 404;
    expect((await get(await cookie())).status).toBe(404);
  });

  it('401 without a session', async () => {
    expect((await get()).status).toBe(401);
  });

  it('404 when the flag is off', async () => {
    const c = await cookie();
    SERVER_FLAGS.senseiCertificates = false;
    expect((await get(c)).status).toBe(404);
  });
});
