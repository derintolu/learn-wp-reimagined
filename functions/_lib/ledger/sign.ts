// Ed25519 request signing for the Learning Ledger connector (WebCrypto).
// Mirrors learning-ledger src/Crypto/class-signed-request.php (c9b5915): the signed string is
// METHOD "\n" path-and-query "\n" hex(SHA-256(body)) "\n" timestamp "\n" nonce, and the signature
// travels as standard base64. Ping verification mirrors class-notification-signature.php: timestamp "." body.

export const HEADER_KEY = "X-Learning-Ledger-Key";
export const HEADER_TIMESTAMP = "X-Learning-Ledger-Timestamp";
export const HEADER_NONCE = "X-Learning-Ledger-Nonce";
export const HEADER_SIGNATURE = "X-Learning-Ledger-Signature";

/** Allowed clock skew in seconds, each way (Signed_Request::WINDOW). */
export const WINDOW_SECONDS = 300;

export type SignedHeaders = Record<
  | "X-Learning-Ledger-Key"
  | "X-Learning-Ledger-Timestamp"
  | "X-Learning-Ledger-Nonce"
  | "X-Learning-Ledger-Signature",
  string
>;

const enc = new TextEncoder();

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(body: Uint8Array): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", body as Uint8Array<ArrayBuffer>),
    ),
  );
}

export async function signRequest(i: {
  method: string;
  path: string;
  body: Uint8Array;
  keyId: string;
  privateKeyPkcs8B64: string;
  now: number;
  nonce: string;
}): Promise<SignedHeaders> {
  const timestamp = String(i.now);
  const canonical = `${i.method.toUpperCase()}\n${i.path}\n${await sha256Hex(i.body)}\n${timestamp}\n${i.nonce}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    fromB64(i.privateKeyPkcs8B64),
    "Ed25519",
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("Ed25519", key, enc.encode(canonical)),
  );
  return {
    "X-Learning-Ledger-Key": i.keyId,
    "X-Learning-Ledger-Timestamp": timestamp,
    "X-Learning-Ledger-Nonce": i.nonce,
    "X-Learning-Ledger-Signature": toB64(sig),
  };
}

/** Verify a ping from the ledger: Ed25519 over `timestamp + "." + body`, within the 5-minute window. */
export async function verifySigned(i: {
  timestamp: string;
  body: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
  now: number;
}): Promise<boolean> {
  try {
    if (
      !/^[0-9]{1,12}$/.test(i.timestamp) ||
      Math.abs(i.now - Number(i.timestamp)) > WINDOW_SECONDS
    )
      return false;
    const key = await crypto.subtle.importKey(
      "raw",
      fromB64(i.publicKeyB64),
      "Ed25519",
      false,
      ["verify"],
    );
    const prefix = enc.encode(`${i.timestamp}.`);
    const msg = new Uint8Array(new ArrayBuffer(prefix.length + i.body.length));
    msg.set(prefix, 0);
    msg.set(i.body, prefix.length);
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      fromB64(i.signatureB64),
      msg,
    );
  } catch {
    return false;
  }
}
