// "Delete my data" tells the parts of the studio that hold the learner's server-side things to forget them.
// Kept apart from session.ts so the badges and the agent hand-off can listen without an import cycle.
const listeners = new Set<() => void>();

/** Run `fn` each time the learner's data has been deleted on the server. Returns the unsubscribe function. */
export function onDataDeleted(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Called by deleteMyDataDetailed once the server has confirmed the delete. */
export function dataDeleted(): void {
  for (const fn of [...listeners]) fn();
}
