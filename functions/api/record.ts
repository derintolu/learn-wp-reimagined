import type { Handler } from '../_lib/env';
import { getContent } from '../_lib/content';
import { LrsClient } from '../_lib/lrs/client';
import { recordRoute } from '../_lib/record/guard';
import { loadStatements, readCachedRecord, writeCachedRecord } from '../_lib/record/read';
import { projectOfficial } from '../../src/shared/official';

const NO_STORE = { 'cache-control': 'no-store' };

/** The learner's official record, projected from the LRS and cached until their next decided event. */
export const GET: Handler = (req, ctx) =>
  recordRoute(req, ctx, async (session) => {
    const { env } = ctx;
    const cached = await readCachedRecord(env, session.actorName);
    if (cached) return new Response(cached, { headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE } });
    const client = new LrsClient(env);
    const { registration, statements } = await loadStatements(env, session, client);
    const now = Date.now();
    const record = projectOfficial(statements, getContent(), await client.listBadges(registration), new Date(now).toISOString());
    const body = JSON.stringify(record);
    await writeCachedRecord(env, session.actorName, body, now);
    return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE } });
  });
