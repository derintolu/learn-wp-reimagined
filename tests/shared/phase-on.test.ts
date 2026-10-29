import { afterEach, describe, expect, it } from 'vitest';
import { FEATURES, phaseOn } from '../../src/config';
import { PHASE_ORDER, phasesUpTo, restoreFlags, setFlags } from '../helpers/flags';

afterEach(restoreFlags);

describe('phaseOn (R30 order)', () => {
  it('ships with wordpressContent on and every later phase off, lrsShadow included', () => {
    expect(FEATURES.lrsShadow).toBe(false);
    expect(phaseOn('wordpressContent')).toBe(true);
    for (const p of [...PHASE_ORDER.slice(1), 'badges'] as const) expect(phaseOn(p)).toBe(false);
  });

  it('a phase is on only with every earlier phase on', () => {
    for (const p of PHASE_ORDER) {
      restoreFlags();
      phasesUpTo(p);
      expect(phaseOn(p)).toBe(true);
      for (const earlier of PHASE_ORDER.slice(0, PHASE_ORDER.indexOf(p))) {
        setFlags({ [earlier]: false });
        expect(phaseOn(p)).toBe(false);
        setFlags({ [earlier]: true });
      }
    }
  });

  it('officialRecord needs lrsShadow', () => {
    setFlags({ wordpressContent: true, senseiLearners: true, officialRecord: true });
    expect(phaseOn('officialRecord')).toBe(false);
    setFlags({ lrsShadow: true });
    expect(phaseOn('officialRecord')).toBe(true);
  });

  it('badges need officialRecord and its earlier phases, not agentOnStandard', () => {
    setFlags({ badges: true });
    expect(phaseOn('badges')).toBe(false);
    phasesUpTo('officialRecord');
    expect(phaseOn('badges')).toBe(true);
    setFlags({ badges: false });
    expect(phaseOn('badges')).toBe(false);
  });
});
