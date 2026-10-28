// Web shim for `node:crypto` in the Functions bundle (scripts/vendor-shims.ts). The vendored server only
// calls randomUUID on this path; the hashing below backs the Node-only Directory stores, which are unused.
export const randomUUID = (): string => crypto.randomUUID();

const unavailable = (name: string) => () => {
  throw new Error(`crypto.${name} is not available in Functions (Node only)`);
};
export const createHash = unavailable('createHash');
export const randomInt = unavailable('randomInt');
