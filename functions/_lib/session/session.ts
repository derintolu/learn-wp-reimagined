import type { Env } from '../env';
import { ensureSchema } from '../db';
import { SERVER_FLAGS } from '../config';
import { ConnectorClient, ConnectorUnavailable } from '../ledger/connector';
import { XAPI_BASE } from '../../../src/shared/xapi';
import { ENROL_RETRY_MS, enrolHealth } from './enrol';

export const SESSION_COOKIE = 'lwr_sid';
export const SESSION_IDLE_MS = 180 * 24 * 60 * 60 * 1000;
export const TOUCH_EVERY_MS = 3_600_000;
const MAX_AGE_S = 15_552_000;

export interface Session {
  sidHash: string;
  actorName: string;
  wpUserId: number | null;
  createdAt: number;
  touchedAt: number;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hashSid(key: string, value: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(value)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function cookieValue(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) {
      const v = part.slice(i + 1).trim();
      return v && v.length <= 128 ? v : null;
    }
  }
  return null;
}

interface Row {
  sid_hash: string;
  actor_name: string;
  wp_user_id: number | string | null;
  created: number | string;
  touched: number | string;
}

export async function readSession(req: Request, env: Env, now: number): Promise<Session | null> {
  if (!env.SESSION_KEY) return null;
  const value = cookieValue(req);
  if (!value) return null;
  await ensureSchema(env.DB);
  const sidHash = await hashSid(env.SESSION_KEY, value);
  const row = await env.DB
    .prepare('SELECT sid_hash, actor_name, wp_user_id, created, touched FROM sessions WHERE sid_hash = ?')
    .bind(sidHash)
    .first<Row>();
  if (!row) return null;
  const session: Session = {
    sidHash,
    actorName: row.actor_name,
    wpUserId: row.wp_user_id == null ? null : Number(row.wp_user_id),
    createdAt: Number(row.created),
    touchedAt: Number(row.touched),
  };
  // An over-age session is left for the retention sweep, whose eraseLearner removes it everywhere.
  if (now - session.touchedAt > SESSION_IDLE_MS) return null;
  if (now - session.touchedAt >= TOUCH_EVERY_MS) {
    await env.DB.prepare('UPDATE sessions SET touched = ? WHERE sid_hash = ?').bind(now, sidHash).run();
    session.touchedAt = now;
  }
  return session;
}

export async function createSession(
  env: Env,
  now: number,
  actorName?: string,
  connector: Pick<ConnectorClient, 'createLearner' | 'deleteLearner'> = new ConnectorClient(env),
): Promise<{ session: Session; cookie: string; actor?: { homePage: string; name: string } }> {
  if (!env.SESSION_KEY) throw new Error('SESSION_KEY is not set');
  await ensureSchema(env.DB);
  const value = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const sidHash = await hashSid(env.SESSION_KEY, value);
  // With senseiLearners on, nothing is recorded until a WordPress learner exists: ConnectorUnavailable
  // propagates before any row is written.
  const learner = SERVER_FLAGS.senseiLearners ? await connector.createLearner() : null;
  // Learning Ledger names the actor by WordPress home_url() and maps an actor back to its user only on that
  // homePage; every official statement and GET /api/session name XAPI_BASE. A WordPress whose `home` option is
  // another host would make two identities, so the learner is refused (and removed) until `home` is fixed.
  if (learner && learner.actor.homePage !== XAPI_BASE) {
    console.error('sensei learner refused: the ledger actor homePage is not XAPI_BASE; set the WordPress home option');
    await connector.deleteLearner(learner.userId).catch(() => {});
    throw new ConnectorUnavailable('ledger actor homePage is not the site');
  }
  const session: Session = {
    sidHash,
    actorName: learner ? learner.actor.name : (actorName ?? crypto.randomUUID()),
    wpUserId: learner ? learner.userId : null,
    createdAt: now,
    touchedAt: now,
  };
  try {
    await env.DB
      .prepare('INSERT INTO sessions (sid_hash, actor_name, wp_user_id, created, touched) VALUES (?, ?, ?, ?, ?)')
      .bind(sidHash, session.actorName, session.wpUserId, now, now)
      .run();
  } catch (e) {
    if (learner) await connector.deleteLearner(learner.userId).catch(() => {});
    throw e;
  }
  return { session, actor: learner?.actor, cookie: `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_S}` };
}

/**
 * A session made before senseiLearners was on has no WordPress learner. With the flag on, make one on its first
 * event and store it on the row. The session keeps its own actor name: our records keep one identity, and the
 * ledger's actor name for this learner is not used. The conditional UPDATE lets only one of two concurrent
 * requests keep its learner: the loser deletes the one it made and reads the winner's. A connector failure
 * leaves the session without a learner (the event still succeeds) and backs off like enrolment does.
 */
export async function ensureLearner(
  env: Env,
  s: Session,
  now: number,
  connector?: Pick<ConnectorClient, 'createLearner' | 'deleteLearner'>,
): Promise<number | null> {
  if (!SERVER_FLAGS.senseiLearners || s.wpUserId != null) return s.wpUserId;
  if (now < enrolHealth.downUntil) return null;
  const c = connector ?? new ConnectorClient(env);
  let learner: { userId: number; actor: { homePage: string; name: string } };
  try {
    learner = await c.createLearner();
  } catch (e) {
    console.error('sensei learner for an older session failed', (e as Error)?.message);
    if (e instanceof ConnectorUnavailable) enrolHealth.downUntil = now + ENROL_RETRY_MS;
    return null;
  }
  if (learner.actor.homePage !== XAPI_BASE) {
    console.error('sensei learner refused: the ledger actor homePage is not XAPI_BASE; set the WordPress home option');
    await c.deleteLearner(learner.userId).catch(() => {});
    enrolHealth.downUntil = now + ENROL_RETRY_MS;
    return null;
  }
  const r = await env.DB
    .prepare('UPDATE sessions SET wp_user_id = ? WHERE sid_hash = ? AND wp_user_id IS NULL')
    .bind(learner.userId, s.sidHash)
    .run();
  if (r.meta.changes === 1) {
    s.wpUserId = learner.userId;
    return learner.userId;
  }
  await c.deleteLearner(learner.userId).catch(() => {});
  const row = await env.DB.prepare('SELECT wp_user_id FROM sessions WHERE sid_hash = ?').bind(s.sidHash).first<{ wp_user_id: number | string | null }>();
  s.wpUserId = row?.wp_user_id == null ? null : Number(row.wp_user_id);
  return s.wpUserId;
}

export async function deleteSession(env: Env, s: Session): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE sid_hash = ?').bind(s.sidHash).run();
}

export function clearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * The cmi5 registration cached on this session (the `registration` column, added by ensureRecordSchema).
 * The LRS State document is authoritative; this only saves the round trip.
 */
export async function cachedRegistration(env: Env, s: Session): Promise<string | null> {
  const row = await env.DB.prepare('SELECT registration FROM sessions WHERE sid_hash = ?').bind(s.sidHash).first<{ registration: string | null }>();
  return row?.registration ?? null;
}

export async function cacheRegistration(env: Env, s: Session, registration: string): Promise<void> {
  await env.DB.prepare('UPDATE sessions SET registration = ? WHERE sid_hash = ?').bind(registration, s.sidHash).run();
}
