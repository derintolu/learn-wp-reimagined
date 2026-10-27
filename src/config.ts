/** Feature flags. `serverEvents` sends the studio's events to the course server, which builds the record's statements. `sessions` gives each learner a studio session on the course server and offers "Delete my data". `wordpressContent` shows the copy that says the lessons live in Sensei (phase 3). `agent` turns on "Bring your own agent": /connect, the record menu entries and the copy that points there. */
export const FEATURES = { agent: true, serverEvents: true, sessions: false, wordpressContent: false } as const;

export const REPO_URL = 'https://github.com/derintolu/learn-wp-reimagined';
