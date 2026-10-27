# Launch checklist

Written down, not executed. Source: Plan B Task 10
(`docs/superpowers/plans/2026-10-20-plan-b-bring-your-own-agent.md`), plus Plan C additions.
Do not deploy or make the space public until Derin says so.

## Private-deploy readiness

Set `URL` to the deployed space origin and `MCP_HEADERS_FILE` to a 0600 JSON file of headers (see the access item). Never print header or handle values. The `sf` CLI was not installed where this was written, so its flags are not confirmed: run `sf <command> --help` before each use and fix any arguments below.

- [ ] `CRON_SECRET` is set as a secret. Pass: the sweep endpoint answers 401 (not 503 `not-configured`) to an unauthenticated POST/GET (`curl -s -o /dev/null -w "%{http_code}" $URL/api/mcp-sweep`, with access headers if private).
- [ ] Bundle sizes. Run `npm run build` and `ls -l dist/functions/api/*.js dist/functions/api/*/*.js`. Pass: `mcp.js`, `agent/*.js` and `mcp-sweep.js` are all listed and each is under 8388608 bytes.
- [ ] Private publish, then `sf runtime status` and `sf crons ls`. Pass: runtime reports healthy for `learn-wp-reimagined`; `crons ls` shows `/api/mcp-sweep` on `daily`.
- [ ] Non-browser access for the private space (machine audience or handoff cookie). Write the headers to a scratch file and `chmod 600` it, then `export MCP_HEADERS_FILE=/path/to/headers.json`. Pass: `curl -s -o /dev/null -w "%{http_code}" -H @<file> $URL/api/status` is 200 (not a login redirect).
- [ ] `verify-mcp.ts`, both eras: `npx tsx scripts/verify-mcp.ts $URL/mcp legacy` and `npx tsx scripts/verify-mcp.ts $URL/mcp modern`. Pass: each exits 0 and prints the server name and tool names.
- [ ] Inspector CLI: `npx @modelcontextprotocol/inspector --cli $URL/mcp --transport http --method tools/list` (add `--header "Name: value"` for a private space; confirm with `--help`). Pass: JSON listing the course tools, no error.
- [ ] Claude Code: `claude mcp add --transport http learn-wp-reimagined $URL/mcp --header "Name: value"`, then `claude mcp list`. Pass: `learn-wp-reimagined` shows Connected.
- [ ] Live handoff round trip: in the app open a lesson, Your record, "Continue in your agent"; save the handle to a 0600 file without printing it. Run `npx tsx scripts/verify-mcp.ts $URL/mcp modern --handle-file <file> --export /tmp/rec.json`. Pass: it prints the lesson the record continues at and writes the export; importing that export on `/connect` restores the progress.
- [ ] Cron: `sf crons run` for `/api/mcp-sweep` with the bearer header (`authorization: Bearer <CRON_SECRET>`). Pass: HTTP 200 with a sweep summary, not 401/503.
- [ ] Logs hold no handle. Pull recent logs to a file (find the command with `sf --help`) and run `grep -c "lr_" <logfile>`. Pass: `0`.
- [ ] `sf share check --as public` while still private. Pass: output is `none`.

## Before publishing

- [ ] Commit the four approved docs: `docs/content-accuracy-learner.md`, `docs/content-accuracy-vibe-coder.md`, `docs/model-eval.md` and `docs/launch-checklist.md`. The How this works and Proposal pages link to them.
- [ ] Recheck the connector steps in `src/agent/clients.ts:19-20` against vendor docs (menus move often).
- [ ] If lesson content changed after Task 9, re-run the full placement eval.
- [ ] Remove the leftover `.claude/worktrees/` (Derin's call).

## Launch day

- [ ] Decide the IRI namespace.
- [ ] Confirm the GPLv3 note.
- [ ] Make the space public.
- [ ] Test the Claude.ai, ChatGPT and Cursor connectors once public.
- [ ] Recheck `/connect` against vendor docs.
- [ ] Review `MCP_LIMITS` against the first day's `hits`.

## Watch and fix

- [ ] Spec section 1 says the AI-Powered WordPress course has 23 lessons; the live course shows 19 lessons plus 4 quizzes. Correct the spec if Derin agrees.
- [ ] The total-beginner placement case used to loop to the token cap in evals. With low reasoning effort and the beginner rule it passed on real content (14/14, docs/model-eval.md). Still watch placement fallbacks in the first day's logs.

- [ ] `index.html` has no canonical link (ruling R10): one static canonical would have pointed every SPA route at the home page. Add per-route canonicals if search ever matters.
