import type { Env } from '../../functions/_lib/env';

const BROKER_LIMIT = 65_536;
const values = (v: unknown[]) => v.reduce<number>((n, x) => n + (typeof x === 'string' ? Buffer.byteLength(x) : 8), 0);
const rows = (rs: unknown[]) => rs.reduce<number>((n, r) => n + values(Object.values((r ?? {}) as object)), 0);

/**
 * A D1 that refuses any operation over 65,536 bytes, like Spacefast's broker: the statement (its text plus bound
 * values) and the result it returns (every value of every row). log.max is the largest operation seen.
 */
export function brokerLimited(real: Env['DB'], log: { max: number } = { max: 0 }): Env['DB'] {
  const limit = (n: number) => {
    log.max = Math.max(log.max, n);
    if (n > BROKER_LIMIT) throw new Error(`Database operation is ${n} bytes; the limit is ${BROKER_LIMIT}.`);
  };
  const wrap = (sql: string, v: unknown[]) => {
    const check = () => limit(Buffer.byteLength(sql) + values(v));
    const q = real.prepare(sql).bind(...v);
    return {
      bind: (...nv: unknown[]) => wrap(sql, nv),
      run: async () => (check(), q.run()),
      first: async () => {
        check();
        const r = await q.first();
        limit(rows([r]));
        return r;
      },
      all: async () => {
        check();
        const r = await q.all();
        limit(rows(r.results));
        return r;
      },
    };
  };
  return { prepare: (sql: string) => wrap(sql, []) } as unknown as Env['DB'];
}
