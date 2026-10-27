/** Feature flags. `serverEvents` sends the studio's events to the course server, which builds the record's statements. `agent` turns on "Bring your own agent": /connect, the record menu entries and the copy that points there. */
export const FEATURES = { agent: true, serverEvents: true } as const;

export const REPO_URL = 'https://github.com/derintolu/learn-wp-reimagined';
