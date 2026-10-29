/** Feature flags. `serverEvents` sends the studio's events to the course server, which builds the record's statements. `sessions` gives each learner a studio session on the course server and offers "Delete my data". `wordpressContent` shows the copy that says the lessons live in Sensei (phase 3). `senseiLearners` describes the anonymous Sensei account made at the first recorded step (phase 4). `agentOnStandard` changes the agent copy and hand-off to sign-in when the agent asks (no record handle); it needs the standard MCP server and its OAuth routes. `lrsShadow` mirrors SERVER_FLAGS.lrsShadow for the pages only: it shows the privacy sentence for the copy of each step kept in the LRS while it is tested (phase 5). `senseiCertificates` mirrors SERVER_FLAGS.senseiCertificates for the pages only: with it off, the badges copy says the studio can't yet download Sensei's certificate. `officialRecord` describes the record kept in the LRS (phase 6): where it lives, how long it is kept, export and delete. `badges` shows path badges in the record menu and on completed lessons, and the claim page at /badges/claim (needs the LRS). `agent` turns on "Bring your own agent": /connect, the record menu entries and the copy that points there. */
export const FEATURES = { agent: true, serverEvents: true, sessions: true, wordpressContent: true, senseiLearners: true, lrsShadow: true, agentOnStandard: false, officialRecord: true, badges: false, senseiCertificates: false } as const;

/** The phase flags in the order they ship (ruling R30); badges come after officialRecord. */
const PHASES = ['wordpressContent', 'senseiLearners', 'lrsShadow', 'officialRecord', 'agentOnStandard'] as const;
export type Phase = (typeof PHASES)[number] | 'badges';

/**
 * A later phase's copy and behaviour assume the earlier ones are on. True only when the phase and every
 * phase before it are on. Badges need officialRecord and the phases before it, not agentOnStandard.
 */
export const phaseOn = (phase: Phase): boolean => {
  const upTo = phase === 'badges' ? PHASES.indexOf('officialRecord') : PHASES.indexOf(phase);
  return (phase !== 'badges' || FEATURES.badges) && PHASES.slice(0, upTo + 1).every((p) => FEATURES[p]);
};

export const REPO_URL = 'https://github.com/derintolu/learn-wp-reimagined';
