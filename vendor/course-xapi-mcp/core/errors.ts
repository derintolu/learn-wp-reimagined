// Vendored from github.com/derintolu/learning-mcp @ f545f5cd68a2c64dc96ac0b138fea6d4332de637, reference/packages/core/src/errors.ts. Do not edit here; change learning-mcp and re-vendor.
// SPDX-License-Identifier: Apache-2.0

/**
 * A store failure the agent can act on. Its message is safe to show: the server sends it as the tool error.
 * Any other error a store throws is reported only as "the record store is unavailable".
 */
export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

/** Thrown by a store when another call changed the record between this call's get and its put. */
export class StoreConflictError extends StoreError {
  constructor() {
    super('the record was changed by another call at the same time; call this tool again');
    this.name = 'StoreConflictError';
  }
}
