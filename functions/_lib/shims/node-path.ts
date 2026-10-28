// Web shim for `node:path` in the Functions bundle (scripts/vendor-shims.ts). Only the vendored Node-only
// code imports it, and none of that runs here.
const unavailable = (name: string) => (..._: unknown[]): never => {
  throw new Error(`path.${name} is not available in Functions (Node only)`);
};
export const dirname = unavailable('dirname');
export const join = unavailable('join');
