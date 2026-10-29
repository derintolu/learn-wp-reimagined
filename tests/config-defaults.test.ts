// The one place that asserts how the flags ship. Every other test sets the flag state it needs
// (tests/helpers/flags.ts), so flipping a phase (R30 order) changes this file and nothing else.
import { describe, expect, it } from 'vitest';
import { FEATURES, phaseOn } from '../src/config';
import { SERVER_FLAGS } from '../functions/_lib/config';

describe('shipped flag defaults', () => {
  it('client FEATURES', () => {
    expect(FEATURES).toEqual({
      agent: true,
      serverEvents: true,
      sessions: true,
      wordpressContent: true,
      senseiLearners: true,
      lrsShadow: true,
      agentOnStandard: true,
      officialRecord: true,
      badges: false,
      senseiCertificates: false,
    });
  });

  it('server SERVER_FLAGS', () => {
    expect(SERVER_FLAGS).toEqual({
      serverEvents: true,
      sessions: true,
      mcpOnStandard: true,
      senseiLearners: true,
      lrsShadow: true,
      wordpressContent: true,
      senseiCertificates: false,
      badges: false,
      officialRecord: true,
      agentOnStandard: true,
    });
  });

  it('the phases on, in R30 order', () => {
    expect((['wordpressContent', 'senseiLearners', 'lrsShadow', 'officialRecord', 'agentOnStandard', 'badges'] as const).filter(phaseOn)).toEqual([
      'wordpressContent',
      'senseiLearners',
      'lrsShadow',
      'officialRecord',
      'agentOnStandard',
    ]);
  });
});
