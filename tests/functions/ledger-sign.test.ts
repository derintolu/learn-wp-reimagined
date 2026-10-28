import { describe, expect, it } from "vitest";
import { signRequest, verifySigned } from "../../functions/_lib/ledger/sign";

// Vector generated with the plugin's own code: learning-ledger @ c9b5915,
// src/Crypto/class-signed-request.php (Signed_Request::canonical + Ed25519::sign) and
// src/Crypto/class-notification-signature.php, seed = RFC 8032 test 1
// (tests/unit/Crypto/test-ed25519.php). Ed25519 is deterministic, so the bytes are stable.
// The plugin's test file pins no signature bytes, so this vector is the one derived from it.
const SEED_HEX =
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const PKCS8_PREFIX = "302e020100300506032b657004220420";
const hexToB64 = (h: string) => Buffer.from(h, "hex").toString("base64");
const PKCS8_B64 = hexToB64(PKCS8_PREFIX + SEED_HEX);
const PUBLIC_B64 = hexToB64(
  "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
);
const KEY_ID = "21fe31dfa154a261";
const T = 1761552000;
const PATH =
  "/wp-json/learning-ledger/v1/course-server/packages/learn-wp-reimagined";
const NONCE = "AAAAAAAAAAAAAAAAAAAAAA";
const SIG =
  "rSpwXKkz1aof9TPBs/LMhTqadD/OzJi9WVIU7mccm1795cWT0AeWiT8qIawiEqweUSkry/p9uJ3zXD7C1yiIDg==";
const PING_SIG =
  "Ko7c4M8sez3o+1a2BBdVAWtU9NeX2hayKguylEGqK3gYonciKEYlYW4fsBQ8I0e//7TtV6bOLMjAXh0h2wQoBA==";
const body = new TextEncoder().encode('{"a":1}');

describe("signRequest", () => {
  it("matches the plugin's published test vector", async () => {
    const h = await signRequest({
      method: "get",
      path: PATH,
      body: new Uint8Array(),
      keyId: KEY_ID,
      privateKeyPkcs8B64: PKCS8_B64,
      now: T,
      nonce: NONCE,
    });
    expect(h).toEqual({
      "X-Learning-Ledger-Key": KEY_ID,
      "X-Learning-Ledger-Timestamp": "1761552000",
      "X-Learning-Ledger-Nonce": NONCE,
      "X-Learning-Ledger-Signature": SIG,
    });
  });
});

describe("verifySigned", () => {
  const base = {
    timestamp: String(T),
    body,
    signatureB64: PING_SIG,
    publicKeyB64: PUBLIC_B64,
  };

  it("accepts the plugin's ping signature inside the window", async () => {
    expect(await verifySigned({ ...base, now: T })).toBe(true);
    expect(await verifySigned({ ...base, now: T + 300 })).toBe(true);
  });

  it("rejects a timestamp 301 s old", async () => {
    expect(await verifySigned({ ...base, now: T + 301 })).toBe(false);
    expect(await verifySigned({ ...base, now: T - 301 })).toBe(false);
  });

  it("rejects a changed body", async () => {
    expect(
      await verifySigned({
        ...base,
        body: new TextEncoder().encode('{"a":2}'),
        now: T,
      }),
    ).toBe(false);
  });

  it("rejects a malformed signature or key without throwing", async () => {
    expect(await verifySigned({ ...base, signatureB64: "!!", now: T })).toBe(
      false,
    );
    expect(await verifySigned({ ...base, publicKeyB64: "AAAA", now: T })).toBe(
      false,
    );
  });
});
