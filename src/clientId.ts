const CLIENT_ID_KEY = 'lwr-client-id';
const CLIENT_ID_RE = /^[A-Za-z0-9-]{16,64}$/;
let memoryClientId: string | undefined;

function newClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * A random id made once per browser and sent as `x-client-id`, so the server can rate-limit
 * per visitor where the platform gives it no visitor IP (R26). Not an identity or a secret.
 * Falls back to an in-memory id when localStorage is missing or throws.
 */
export function clientId(): string {
  try {
    const stored = localStorage.getItem(CLIENT_ID_KEY);
    if (stored && CLIENT_ID_RE.test(stored)) return stored;
    const id = memoryClientId ?? newClientId();
    localStorage.setItem(CLIENT_ID_KEY, id);
    memoryClientId = id;
    return id;
  } catch {
    return (memoryClientId ??= newClientId());
  }
}

/** For tests: forget the in-memory client id. */
export function resetClientIdForTests() {
  memoryClientId = undefined;
}
