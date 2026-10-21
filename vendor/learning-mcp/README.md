# Vendored: learning-mcp

This folder is a pinned copy of [learning-mcp](https://github.com/derintolu/learning-mcp) by Derin Tolu: `packages/core/src` (as `core/`) and `packages/server/src/server.ts` (as `server/server.ts`). `VENDORED.json` records the source commit, the file list and the one change made here (the server imports core by a relative path).

Don't edit these files. Change learning-mcp and re-vendor:

```bash
npx tsx scripts/vendor-learning-mcp.ts <path-to-learning-mcp-checkout> <commit>
```

## Licence

- learning-mcp's code is **GPL-2.0-or-later** ([LICENSE](LICENSE)), the same licence as this site.
- The course server is built on the official MCP TypeScript SDK (`@modelcontextprotocol/server` 2.3.1), which is **Apache-2.0**. Apache-2.0 code can be combined with GPL code under GPL version 3, but not under version 2. The "or later" in both licences allows that, so the bundled connector function (`dist/functions/api/mcp.js`, which includes the SDK) is effectively distributed under **GPLv3**. The rest of the site, which does not include the SDK, stays GPL-2.0-or-later.
