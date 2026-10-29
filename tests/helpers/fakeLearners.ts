import { XAPI_BASE } from '../../src/shared/xapi';

/**
 * A stand-in for the Learning Ledger connector's learner calls, for createSession: every session gets a WordPress
 * learner (Sensei learners are always on), and these tests do not exercise the connector itself.
 */
export function fakeLearners() {
  let next = 1000;
  const made: number[] = [];
  const deleted: number[] = [];
  return {
    made,
    deleted,
    async createLearner() {
      const userId = ++next;
      made.push(userId);
      return { userId, actor: { homePage: XAPI_BASE, name: crypto.randomUUID() } };
    },
    async deleteLearner(userId: number) {
      deleted.push(userId);
    },
  };
}
