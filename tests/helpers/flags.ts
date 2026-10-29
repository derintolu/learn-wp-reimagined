import { FEATURES } from '../../src/config';
import { SERVER_FLAGS } from '../../functions/_lib/config';

type Flags = { -readonly [K in keyof typeof FEATURES]: boolean };
const flags = FEATURES as Flags;
const initial: Flags = { ...flags };

type ServerFlags = { [K in keyof typeof SERVER_FLAGS]: boolean };
const serverInitial: ServerFlags = { ...SERVER_FLAGS };

/** The phases in R30 order, as src/config.ts ships them. */
export const PHASE_ORDER = ['wordpressContent', 'senseiLearners', 'lrsShadow', 'officialRecord', 'agentOnStandard'] as const;

/**
 * Every flag the phases turn on one at a time (R30), off. A test that depends on one of them sets it
 * (from this or explicitly) rather than relying on how config.ts ships it.
 */
export const PHASES_OFF = {
  senseiLearners: false,
  lrsShadow: false,
  officialRecord: false,
  agentOnStandard: false,
  badges: false,
  senseiCertificates: false,
} as const;

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

/** Set any server flags (functions/_lib/config.ts SERVER_FLAGS) directly. */
export function setServerFlags(f: Partial<ServerFlags>): void {
  Object.assign(SERVER_FLAGS, f);
}

/** Put every server flag back as functions/_lib/config.ts ships it. */
export function restoreServerFlags(): void {
  Object.assign(SERVER_FLAGS, serverInitial);
}
