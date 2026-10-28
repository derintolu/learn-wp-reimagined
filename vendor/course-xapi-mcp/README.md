# Vendored: course-xapi-mcp

This folder is a pinned copy of the course-xapi-mcp reference packages from [learning-mcp](https://github.com/derintolu/learning-mcp) by Derin Tolu: `core`, `validator`, `server`, `lrs-client`, `badges` and `bridge` (each package's `src/` becomes `<package>/`). `VENDORED.json` records the source commit, the file list, the transforms and the third-party dependencies of each package.

The copy is taken with `git archive` from the commit, never from the source checkout's working tree. Imports of `@course-xapi-mcp/<package>` (and subpaths such as `core/xapi`) are rewritten to relative paths.

Don't edit these files. Change learning-mcp and re-vendor:

```bash
npx tsx scripts/vendor-course-xapi-mcp.ts <path-to-learning-mcp-checkout> <commit> [--packages core,validator,...]
```

## Licence

course-xapi-mcp is **Apache-2.0** ([LICENSE](LICENSE), [NOTICE](NOTICE)). Apache-2.0 code can be combined with this site's GPL-2.0-or-later code under GPL version 3 (the "or later" allows it), the same arrangement as `vendor/learning-mcp`.

## Not vendored

`validator/xsd.ts` reads the XSD files from the source repo's `schema/` directory and `server/config.ts` resolves `examples/` from the source repo root; neither path exists here, so those two code paths do not work from this folder until a task supplies them.
