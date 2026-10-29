/** Feature flags. `agent` turns on "Bring your own agent": /connect, the record menu entries and the copy that points there. */
export const FEATURES = { agent: true } as const;

export const REPO_URL = 'https://github.com/derintolu/learn-wp-reimagined';

/**
 * Whether the LRS issues badges yet (ruling R57). It cannot until its course-server client is marked trusted; on the
 * LRS that is `wp learning-ledger client update course-server --trusted` (here:
 * `sf wp --space learn-wp-reimagined-lrs -- learning-ledger client update course-server --trusted`). Set this to true
 * once that has run and the pages carry the approved badge copy again.
 */
export const BADGES_ISSUING = false;

/** What the pages say where badges are promised while BADGES_ISSUING is false. */
export const BADGES_NOT_ISSUED = 'Badges are switched on but not issued yet.';
