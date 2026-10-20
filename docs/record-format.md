# Learning record format

## Decision: xAPI target

Statements target **IEEE 9274.1.1-2023 (xAPI 2.0)**. Statements omit the optional `version` property: an LRS sets it itself, and a 1.0.x LRS rejects `"2.0.0"`.

- The ADL xAPI-Spec repository (master) still documents 1.0.3 (revision of 2016-09-21); xAPI became a published IEEE standard (9274.1.1-2023) on 2023-10-10, and ADL LRS v2.0.0 implements it. Sources: https://github.com/adlnet/xAPI-Spec, https://adlnet.gov/news/2023/11/22/xAPI-Officially-Becomes-a-Published-IEEE-Standard, https://github.com/adlnet/ADL_LRS/releases.
- The 1.0.3 text says Learning Record Providers SHOULD NOT set `version`. Every field we use is unchanged from 1.0.3, so the statements are accepted by 1.0.x and 2.0 LRSs alike.
- Verb IRIs use the ADL vocabulary `http://adlnet.gov/expapi/verbs/<name>` (experienced, answered, passed, failed, completed; the pattern is confirmed by the Globebyte, Cornerstone and jxapi references). Custom verb: `branched` = `${XAPI_BASE}/xapi/verbs/branched`.

`XAPI_BASE` defaults to `https://learn-wp-reimagined.space.fast` and is used as the actor account home page and the activity id prefix (`${XAPI_BASE}/activities/<segments>`). Each segment is `encodeURIComponent`-encoded, so file names with spaces, `#` or `?` still yield valid IRIs.

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
| `fileLessons?` | File name to the lesson id it was last edited in. Set by `fileEdited` events that carry a `lessonId`. Records without it (from before this field existed) are still valid. The finale uses it to decide whether an edit is used (R25). It is not part of xAPI. |
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

## Extensions

The `branched` statement's `result.extensions` use IRI keys (xAPI requires this):

- `${XAPI_BASE}/xapi/extensions/outcome`: the checkpoint outcome (`advance`, `review` or `skip`).
- `${XAPI_BASE}/xapi/extensions/from-lesson`: the activity id IRI of the lesson the checkpoint was in.

## Example statement

```json
{
  "id": "5b0c6a3e-1f0e-4a52-9d4e-0f2a1c7d9a11",
  "actor": { "objectType": "Agent", "account": { "homePage": "https://learn-wp-reimagined.space.fast", "name": "0d1f7c0a-6c5e-4b4f-8a0e-2f6c1b9e3d77" } },
  "verb": { "id": "http://adlnet.gov/expapi/verbs/completed", "display": { "en-US": "completed" } },
  "object": { "objectType": "Activity", "id": "https://learn-wp-reimagined.space.fast/activities/lessons/what-is-a-block-theme", "definition": { "name": { "en-US": "What is a block theme?" } } },
  "result": { "completion": true },
  "context": { "contextActivities": { "parent": [ { "objectType": "Activity", "id": "https://learn-wp-reimagined.space.fast/activities/paths/block-theme" } ] } },
  "timestamp": "2026-10-19T12:00:00.000Z"
  }
```

## Privacy

`result.response` on `answered` statements holds the learner's own free-text answer, so it travels wherever the learner exports the record.

The actor is anonymous: an `account` whose `name` is a random UUID. No `mbox`, no name, no email. The record stays on the learner's device unless they export it; statements can be sent unchanged to a learning record store.
