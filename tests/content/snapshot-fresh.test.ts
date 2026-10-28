import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_DIR, pullSnapshot, readSnapshot } from '../../scripts/content-pull';
import { readConnectorEnv } from '../../scripts/keys';
import { ConnectorClient } from '../../functions/_lib/ledger/connector';

// A live pull from the course server; only when asked for: CONTENT_PULL_CHECK=1 npx vitest run tests/content/snapshot-fresh.test.ts
describe.skipIf(process.env.CONTENT_PULL_CHECK !== '1')('content/snapshot is fresh', () => {
  it('a fresh pull from the course server equals the committed snapshot', async () => {
    const env = readConnectorEnv(process.env.ENV_FILE ?? '.env.server') as unknown as ConstructorParameters<typeof ConnectorClient>[0];
    const dir = mkdtempSync(join(tmpdir(), 'pull-'));
    await pullSnapshot(new ConnectorClient(env), dir);
    expect(readSnapshot(dir)).toEqual(readSnapshot(SNAPSHOT_DIR));
  });
});
