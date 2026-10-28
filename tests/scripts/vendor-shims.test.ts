import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NODE_SHIMS, badgesRedirect, nodeShim } from '../../scripts/vendor-shims';

const at = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

describe('vendor shims', () => {
  it("resolves only server/tools.ts's badges index import to the awards module", () => {
    expect(badgesRedirect('../badges/index.ts', at('vendor/course-xapi-mcp/server/tools.ts'))).toBe(at('vendor/course-xapi-mcp/badges/awards.ts'));
    expect(badgesRedirect('../badges/index.ts', at('vendor/course-xapi-mcp/server/app.ts'))).toBeUndefined();
    expect(badgesRedirect('./awards.ts', at('vendor/course-xapi-mcp/server/tools.ts'))).toBeUndefined();
  });

  it('shims Node built-ins for vendored course-xapi-mcp code only', () => {
    expect(nodeShim('node:vm', at('vendor/course-xapi-mcp/core/checks.ts'))).toBe(NODE_SHIMS['node:vm']);
    expect(nodeShim('node:crypto', at('vendor/course-xapi-mcp/server/server.ts'))).toBe(NODE_SHIMS['node:crypto']);
    expect(nodeShim('node:vm', at('functions/_lib/mcp/handler.ts'))).toBeUndefined();
    expect(nodeShim('node:os', at('vendor/course-xapi-mcp/server/server.ts'))).toBeUndefined();
  });

  it('the vm shim runs exactly the regex test the checks use, and nothing else', async () => {
    const { createContext, runInContext } = await import('../../functions/_lib/shims/node-vm');
    const ctx = createContext({ pattern: 'a+b', flags: 'i', text: 'xAAB' });
    expect(runInContext('new RegExp(pattern, flags).test(text)', ctx)).toBe(true);
    expect(() => runInContext('process.exit()', ctx)).toThrow(/not available/);
  });
});
