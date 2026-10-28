import { FEATURES } from '../../src/config';

type Flags = { -readonly [K in keyof typeof FEATURES]: boolean };
const flags = FEATURES as Flags;
const initial: Flags = { ...flags };

/** The phases in R30 order, as src/config.ts ships them. */
export const PHASE_ORDER = ['wordpressContent', 'senseiLearners', 'lrsShadow', 'officialRecord', 'agentOnStandard'] as const;

/** Turn on `phase` and every phase before it (R30 order). */
export function phasesUpTo(phase: (typeof PHASE_ORDER)[number]): void {
  for (const p of PHASE_ORDER.slice(0, PHASE_ORDER.indexOf(phase) + 1)) flags[p] = true;
}

/** Set any flags directly. */
export function setFlags(f: Partial<Flags>): void {
  Object.assign(flags, f);
}

/** Put every flag back as src/config.ts ships it. */
export function restoreFlags(): void {
  Object.assign(flags, initial);
}
