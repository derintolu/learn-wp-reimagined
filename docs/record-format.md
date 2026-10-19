# Learning record format

## Decision: xAPI target

Statements target **IEEE 9274.1.1-2023 (xAPI 2.0)**, with statement `version` `"2.0.0"`.

- The ADL xAPI-Spec repository (master) still documents 1.0.3 (revision of 2016-09-21); xAPI became a published IEEE standard (9274.1.1-2023) on 2023-10-10, and ADL LRS v2.0.0 implements it. Sources: https://github.com/adlnet/xAPI-Spec, https://adlnet.gov/news/2023/11/22/xAPI-Officially-Becomes-a-Published-IEEE-Standard, https://github.com/adlnet/ADL_LRS/releases.
- Caveat: the 1.0.3 text says an LRS must reject statement versions not starting with `1.0.`. The IEEE 2.0 text was not freely readable during research, so the `2.0.0` statement version is inferred from ADL's 2.0.0 changes. Every field we use is unchanged from 1.0.3, so downgrading is a one-constant change (`XAPI_VERSION` in `src/shared/xapi.ts`; in 1.0.x, omit `version`).
- Verb IRIs use the ADL vocabulary `http://adlnet.gov/expapi/verbs/<name>` (experienced, answered, passed, failed, completed; the pattern is confirmed by the Globebyte, Cornerstone and jxapi references). Custom verb: `branched` = `${XAPI_BASE}/xapi/verbs/branched`.

`XAPI_BASE` defaults to `https://learn-wp-reimagined.space.fast` and is used as the actor account home page and the activity id prefix (`${XAPI_BASE}/activities/<segments>`).

## Record shape

JSON, `format: "learn-wp-reimagined/record"`, `version: 1`:

| Field | Meaning |
| --- | --- |
| `learnerId` | Random UUID. The only identity. |
| `createdAt`, `updatedAt` | ISO 8601 |
| `placement?` | Result of placement (path, start lesson, skipped lessons, reason) |
| `current?` | `{ pathId, lessonId, beatIndex }` resume point |
| `completedLessons` | Lesson ids |
| `files` | The learner's edited files, name to content |
| `statements` | xAPI statements, in order |

A record with `version` greater than 1 is rejected ("This record was made by a newer version"). Statements are validated on load.

## Verbs

| Key | IRI | Emitted when |
| --- | --- | --- |
| experienced | http://adlnet.gov/expapi/verbs/experienced | a beat is viewed |
| answered | http://adlnet.gov/expapi/verbs/answered | a checkpoint is answered |
| passed | http://adlnet.gov/expapi/verbs/passed | checkpoint outcome advance/skip, or a code check passes |
| failed | http://adlnet.gov/expapi/verbs/failed | checkpoint outcome review, or a code check fails |
| completed | http://adlnet.gov/expapi/verbs/completed | a lesson is completed (once) |
| branched | `${XAPI_BASE}/xapi/verbs/branched` | a checkpoint sends the learner to another lesson |

## Example statement

```json
{
  "id": "5b0c6a3e-1f0e-4a52-9d4e-0f2a1c7d9a11",
  "actor": { "objectType": "Agent", "account": { "homePage": "https://learn-wp-reimagined.space.fast", "name": "0d1f7c0a-6c5e-4b4f-8a0e-2f6c1b9e3d77" } },
  "verb": { "id": "http://adlnet.gov/expapi/verbs/completed", "display": { "en-US": "completed" } },
  "object": { "objectType": "Activity", "id": "https://learn-wp-reimagined.space.fast/activities/lessons/what-is-a-block-theme", "definition": { "name": { "en-US": "What is a block theme?" } } },
  "result": { "completion": true },
  "context": { "contextActivities": { "parent": [ { "objectType": "Activity", "id": "https://learn-wp-reimagined.space.fast/activities/paths/block-theme" } ] } },
  "timestamp": "2026-10-19T12:00:00.000Z",
  "version": "2.0.0"
}
```

## Privacy

The actor is anonymous: an `account` whose `name` is a random UUID. No `mbox`, no name, no email. The record stays on the learner's device unless they export it; statements can be sent unchanged to a learning record store.
