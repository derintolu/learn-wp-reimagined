# Stream plan: plan-b-agent

**Goal:** "Bring your own agent". Serve the course as a remote MCP server (Streamable HTTP) built on learning-mcp, keep agent progress as real xAPI in a durable rate-limited relay, and let the learner carry their place between the site and their agent.

**The plan of record** is `docs/superpowers/plans/2026-10-20-plan-b-bring-your-own-agent.md`. It holds the rulings (controller rulings R-a to R-e, builder rulings R-B1 to R-B12, each with its cost if wrong), the review focus, and the ten tasks with their tests:

1. Spike: vendored learning-mcp served from a Spacefast Function (`/api/mcp`), bundled by `scripts/assemble.ts`, checked with the SDK client.
2. Upstream learning-mcp fixes on branch `plan-b-fixes`: nested file names, store errors become tool errors.
3. Course conversion from the site's content, validated with `parseCourse`.
4. `D1RecordStore`: compare-and-set, hashed handles, 30-day expiry, daily sweep.
5. The real `/api/mcp`: body cap, per-handle, creation and global rate limits, no AI.
6. Handoff, record and delete endpoints, and the client helpers.
7. `planImport` / `applyImport`: agent record into the site record, with conflicts.
8. The `/connect` page.
9. "Continue in your agent" and "Bring back your agent's progress" in the RecordPanel menu; `FEATURES.agent = true`.
10. A private-deploy readiness checklist (written, not executed).

**How it's tested:** each task is test-first with Vitest (SQLite D1 for the store and endpoints, the official MCP SDK client in both protocol eras for the server, Testing Library for the UI), then `npm test`, `npx tsc --noEmit`, `npm run build`, a local SDK-client check against the dev server on port 5175, and agent-browser screenshots at 1440x900 and 390x844.
