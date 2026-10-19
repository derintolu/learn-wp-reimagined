import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { D1Like, D1Stmt } from '../functions/_lib/env.ts';

type SqlValue = null | number | bigint | string | NodeJS.ArrayBufferView;

export function createSqliteD1(path = ':memory:'): D1Like {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);

  const stmt = (sql: string, params: unknown[] = []): D1Stmt => ({
    bind: (...v) => stmt(sql, v),
    async all<T>() {
      return { results: db.prepare(sql).all(...(params as SqlValue[])) as T[] };
    },
    async first<T>() {
      return (db.prepare(sql).get(...(params as SqlValue[])) as T | undefined) ?? null;
    },
    async run() {
      const r = db.prepare(sql).run(...(params as SqlValue[]));
      return { meta: { changes: Number(r.changes) } };
    },
  });

  return { prepare: (sql) => stmt(sql) };
}
