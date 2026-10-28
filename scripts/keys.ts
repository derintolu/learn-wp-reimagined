// Generates the course server's Ed25519 connector key into an env file. Never prints a secret.
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const KEY = 'CONNECTOR_SIGNING_KEY';
const ID = 'CONNECTOR_KEY_ID';

function readValue(text: string, name: string): string {
  return new RegExp(`^${name}=(.*)$`, 'm').exec(text)?.[1].trim() ?? '';
}

function setValue(text: string, name: string, value: string): string {
  const re = new RegExp(`^${name}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, () => `${name}=${value}`);
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${name}=${value}\n`;
}

/** Base64 of the raw 32-byte Ed25519 public key, the form `connector trust-key --public-key` expects. */
function rawPublicKeyB64(pkcs8B64: string): string {
  const pub = createPublicKey(createPrivateKey({ key: Buffer.from(pkcs8B64, 'base64'), format: 'der', type: 'pkcs8' }));
  return pub.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
}

/** Reads the two connector values from an env file, for building a ConnectorClient. Never printed. */
export function readConnectorEnv(envFile: string): { CONNECTOR_SIGNING_KEY: string; CONNECTOR_KEY_ID: string } {
  const text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  return { CONNECTOR_SIGNING_KEY: readValue(text, KEY), CONNECTOR_KEY_ID: readValue(text, ID) };
}

/** Writes CONNECTOR_SIGNING_KEY (PKCS8 base64) and CONNECTOR_KEY_ID only when absent. Safe to re-run. */
export function generateKeys(envFile = '.env.server'): { publicKeyB64: string } {
  let text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  let priv = readValue(text, KEY);
  let changed = false;
  if (!priv) {
    const { privateKey } = generateKeyPairSync('ed25519');
    priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    text = setValue(text, KEY, priv);
    changed = true;
  }
  if (!readValue(text, ID)) {
    text = setValue(text, ID, 'course-server');
    changed = true;
  }
  if (changed) {
    writeFileSync(envFile, text, { mode: 0o600 });
    chmodSync(envFile, 0o600); // mode above only applies when the file is created
  }
  return { publicKeyB64: rawPublicKeyB64(priv) };
}

if (process.argv[1]?.endsWith('keys.ts')) {
  const { publicKeyB64 } = generateKeys(process.argv[2] ?? '.env.server');
  console.log(`Public key (safe to share): ${publicKeyB64}`);
}
