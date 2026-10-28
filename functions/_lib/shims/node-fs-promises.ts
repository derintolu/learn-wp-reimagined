// Web shim for `node:fs/promises` in the Functions bundle (scripts/vendor-shims.ts). Only the vendored
// Node-only code imports it (Directory* stores, private files, readDir), and none of that runs here.
const unavailable = (name: string) => async (..._: unknown[]): Promise<never> => {
  throw new Error(`fs.${name} is not available in Functions (Node only)`);
};
export const chmod = unavailable('chmod');
export const mkdir = unavailable('mkdir');
export const open = unavailable('open');
export const readdir = unavailable('readdir');
export const readFile = unavailable('readFile');
export const rename = unavailable('rename');
export const rm = unavailable('rm');
export const writeFile = unavailable('writeFile');
