// PKCE (RFC 7636), S256 only. Follows the standard's reference auth server
// (learning-mcp reference/packages/server/src/auth/pkce.ts, Apache-2.0), rewritten for WebCrypto.

/** A verifier is 43 to 128 unreserved characters; an S256 challenge is 43 base64url characters. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isS256Challenge(challenge: unknown): challenge is string {
  return typeof challenge === 'string' && CHALLENGE.test(challenge);
}

/** Compares two strings in time that depends only on their lengths. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyS256(verifier: string, challenge: string): Promise<boolean> {
  if (!VERIFIER.test(verifier) || !CHALLENGE.test(challenge)) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return safeEqual(b64url(digest), challenge);
}
