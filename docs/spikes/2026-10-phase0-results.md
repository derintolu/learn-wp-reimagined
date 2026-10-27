# Phase 0 spike results (2026-10-27)

Probe runner: `SPIKE_TOKEN=... npx tsx spikes/phase0/probe.ts https://lwr-spike-20261027.space.fast https://learn-wp-reimagined-lrs.space.fast`.
The LRS-host probes ran against the LRS space's own URL because `lrs.sqwrlz.com` is not connected (see "Custom domain" below).
Design references: §13 phase 0 list, §13.1 consequences.

## Probes

| # | Probe id | Result | Evidence | Consequence (§13.1) |
| --- | --- | --- | --- | --- |
| 1 | `wp-json-through-rewrites` | Pass | Spike space (rewrites, no `fallback`): `GET /wp-json/lwr-spike/v1/ping` 200 `application/json`; `/wp-admin/` 302 to `wp-login.php`; `/courses/` is a WordPress 404 page. Space A (read-only GETs, via its existing Open link session): `/wp-json/` 200 JSON (414 KB), `/wp-admin/` 302 to `wp-login.php`, but `/courses/`, `/learn/x` and `/.well-known/oauth-protected-resource` return the 2.3 KB app shell. | No change. `/wp-json` and `/wp-admin` get through today's fallback. Sensei's front-end pages (`/courses/`, etc.) do not: they need the explicit rewrites the spike uses (no `fallback`) before phase 3 makes them visible. |
| 2 | `functions-self-fetch` | Pass | `GET /api/selfcall` 200 with inner status 200 (the Function fetched its own space's `/wp-json/lwr-spike/v1/ping`). | No change. Abilities with a machine token not needed for this. |
| 3 | `well-known-oauth` | Pass | `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` 200 `application/json` `{"spike":true,"path":"/api/wk"}` via `sf.jsonc` rewrites to a Function. | No change. Root `.well-known` OAuth metadata can be served by Functions in front of WordPress. |
| 4 | `sensei-installed` | Pass | WP-CLI `plugin install sensei-lms --version=4.26.4 --activate` and `sensei-certificates --version=2.6.0 --activate` succeeded; ping reports PHP 8.5.12, Sensei 4.26.4, Certificates 2.6.0; `plugin is-active` succeeded for both. | No change. No pin-down needed. |
| 4b | `certificate-headless` | Fail (inconclusive) | First run: `bytes=0`, `certificate: null`; the guessed renderer classes do not exist. Real renderer is `WooThemes_Sensei_PDF_Certificate::generate_pdf()`; certificates are only issued when the course has `_course_certificate_template` and its status becomes `complete`. After the one permitted iteration (commit 8c65b7f): `bytes=0`, `template: 0`, `certificate: 0`, `error: null`. Options `sensei_certificates_version` and `sensei_certificate_templates_installer` are absent, so the Certificates installer never ran after WP-CLI activation and no example template exists. The spike then creates one with `sensei_create_master_certificate_template()`, but that template is `private` and its `get_posts( post_status => any )` lookup runs logged out, so WP_Query hides it. Likely fix (not applied, iteration limit): query `post_status => array( 'publish', 'private' )`, or run the installer (`do_action( 'sensei_certificates_run_installer' )`). | Not yet decided. The PDF render path was never reached, so this is neither a yes nor a no. Until it is rerun, plan for the §13.1 fallback: the panel shows that the certificate exists, and the pages say so. Also, provisioning (phase 3) must run the Certificates installer or create a template explicitly, because WP-CLI activation does not. |
| 5 | `lrs-host-basic-auth` | Pass (space URL only) | `GET https://learn-wp-reimagined-lrs.space.fast/wp-json/lwr-spike/v1/ping` with `Authorization: Basic ...` gave `basic_auth_seen: true`. Not tested on `lrs.sqwrlz.com`. | Basic auth passes through on a second claimed public space. The custom hostname part is still open (see below). |
| 6 | `sodium` | Pass | ping `sodium: true` (PHP 8.5.12). | No change. `sodium_compat` not needed. |
| 7 | `did-json` | Fail | `GET /.well-known/did.json` on the LRS space returns 404 `text/html` with a WordPress "Page not found" page, so the path does reach WordPress. The spike plugin registers no `did.json` handler, so `id` could not match `did:web:lrs.sqwrlz.com`. Not tested on `lrs.sqwrlz.com`. | Partly answered: `.well-known` reaches WordPress on the space hostname, so a plugin-served `did.json` should work. The `did:web:lrs.sqwrlz.com` issuer still needs the custom domain. Decide before any badge is issued (§13.1). |
| 8 | `user-create-route` | Pass | Gated `POST /wp-json/lwr-spike/v1/users` returned 201 with a numeric `id`, role `subscriber`, created logged out. | No change. |
| - | `functions-wait-until` (extra) | Fail as judged | `/api/ctx` returns handler context keys `params, env, ctx`. The probe looks for a top-level `waitUntil`. Spacefast docs say `context` carries `params`, `env` and `ctx`, so `waitUntil` probably lives at `context.ctx.waitUntil`. Not verified. | Unconfirmed. Until a probe checks `context.ctx.waitUntil`, use the §13.1 outbox path for `/api/events`: answer first, post after. |

## Platform finding

- A Functions site cannot be published as a plain archive through `POST /v1/publish`. A static archive ignores `functions/`. Declaring `runtime.kind: "functions"` fails with `config_runtime_entry_missing` ("requires compiled worker metadata. Publish with sf or MCP"). What worked: a source archive with a `package.json` `build` script that copies the site into `dist`. Spacefast's remote build compiled the `functions/` router (routes `/api/ctx`, `/api/selfcall`, `/api/wk`). Running `npx spacefast publish` from this session was blocked by the local permission policy.
- WordPress on a new space answers only after a first version is published. Before that it returns `content_admin_space_not_found`.

## Spaces created

| Slug | Id | URLs | Access | Notes |
| --- | --- | --- | --- | --- |
| `lwr-spike-20261027` | `spc_93e0d7f2178d40aaa91b3acce8774023` | https://lwr-spike-20261027.space.fast/ | Claimed (team derin-team), public grant `grt_76240f2932b7458593395257f0cc3348` (`/**`, live, page.view) | Throwaway, left up. Live version `ver_0c8d2e3267044fd49c5e4f98338cbe2e` (remote build `bld_a3b14f84899e489f9105c228e4b61330`). Serves `spikes/phase0/site` plus `/lwr-spike.zip`. |
| `learn-wp-reimagined-lrs` | `spc_3527a5a9c58a4d3e96053d8dfcea2b76` | https://learn-wp-reimagined-lrs.space.fast/ | Claimed (team derin-team), public grant `grt_f2485d771ef34c3088a485d92e665cba` (`/**`, live, page.view) | Real LRS space. Live version `ver_7c6818b55d0045daa937892c399b3f78` is a one-line placeholder `index.html` (needed to bring WordPress up). |

No change was made to `learn-wp-reimagined` (GETs only, through its existing Open link) or `fresh-widget`.

## Custom domain and DNS

- No DNS record was created.
- Spacefast refused to register the domain. `POST /v1/domains {"name":"lrs.sqwrlz.com"}` returned 403 `forbidden` ("This credential is not allowed to perform this operation", requestId `785e4ed48c00388befa7594dfec7fdf5`), and `GET /v1/domains` returns the same 403. The account token can't manage domains.
- Spacefast's records are generated per hostname after the domain is assigned to a space, so their values can't be known without that step. Per https://spacefast.com/docs/domains, a subdomain needs more than one record: a `TXT` `_stattic-verify.lrs.sqwrlz.com` (team verification) plus `A` (and `AAAA` when offered) for `lrs.sqwrlz.com`. Spacefast never asks for a CNAME. That is more than the one record approved.
- Current public DNS: `lrs.sqwrlz.com` resolves through a CNAME to `uixie.porkbun.com` (likely a wildcard or parked record). Spacefast says every observed `A` record must point at Spacefast, so this may need removing.
- To finish: Derin adds `lrs.sqwrlz.com` to `learn-wp-reimagined-lrs` (dashboard, Domains, Add domain, or a token with domain permission), approves the records it lists (TXT + A [+ AAAA], unproxied), then probes 5 and 7 are rerun against `https://lrs.sqwrlz.com`.

## What is installed where

| Space | Installed (WP-CLI, all succeeded) |
| --- | --- |
| `lwr-spike-20261027` | Sensei LMS 4.26.4 (active), Sensei LMS Certificates 2.6.0 (active), LWR Spike (from `https://lwr-spike-20261027.space.fast/lwr-spike.zip`, commit 8c65b7f, active), option `lwr_spike_token_sha256` (hash only) |
| `learn-wp-reimagined-lrs` | LWR Spike only (same zip, active), option `lwr_spike_token_sha256` (hash only) |

Test data on the spike space from the probe runs: a few `spike_*` subscriber users, "Spike course" and "Spike lesson" posts, and one private "Example Template" certificate template.
