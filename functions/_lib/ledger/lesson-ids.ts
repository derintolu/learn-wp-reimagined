import type { Env } from "../env";

/** Sensei lesson post id (as a string) to studio lesson id, from env SENSEI_LESSON_IDS (studio id to post id). */
export function lessonKeyBySenseiId(env: Pick<Env, "SENSEI_LESSON_IDS">): Record<string, string> {
  try {
    const v = JSON.parse(env.SENSEI_LESSON_IDS ?? "{}") as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, id] of Object.entries(v)) if (Number.isInteger(id)) out[String(id)] = key;
    return out;
  } catch {
    return {};
  }
}
