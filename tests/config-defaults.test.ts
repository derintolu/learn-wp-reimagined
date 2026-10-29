// Every phase flag is gone (Task 52): the behaviour they switched is always on. Only the product toggle `agent` remains.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as client from '../src/config';
import * as server from '../functions/_lib/config';

const PHASE_FLAGS = ['serverEvents', 'sessions', 'wordpressContent', 'senseiLearners', 'lrsShadow', 'officialRecord', 'agentOnStandard', 'badges', 'senseiCertificates', 'mcpOnStandard'];

describe('no phase flag remains', () => {
  it('client FEATURES holds only the agent toggle, and there is no phaseOn', () => {
    expect(client.FEATURES).toEqual({ agent: true });
    expect('phaseOn' in client).toBe(false);
  });

  it('the server has no SERVER_FLAGS', () => {
    expect('SERVER_FLAGS' in server).toBe(false);
  });

  it('neither config file defines a phase flag', () => {
    for (const f of ['src/config.ts', 'functions/_lib/config.ts']) {
      const text = readFileSync(f, 'utf8');
      expect(text).not.toMatch(/SERVER_FLAGS|phaseOn/);
      for (const flag of PHASE_FLAGS) expect(text).not.toMatch(new RegExp(`\\b${flag}\\s*:`));
    }
  });
});
