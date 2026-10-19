import { describe, it, expect } from 'vitest';
import { GET } from '../../functions/api/status';
import { createSqliteD1 } from '../../dev/sqliteD1';

describe('GET /api/status', () => {
  it('reports ai off when not configured', async () => {
    const res = await GET(new Request('http://x/api/status'), {
      params: {},
      env: { DB: createSqliteD1() },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ai: 'off', reason: 'not-configured' });
  });
});
