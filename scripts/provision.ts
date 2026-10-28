// Idempotent Space A provisioning through WP-CLI. Only public values appear in arguments.
// CLI: npx tsx scripts/provision.ts space-a   (SPACE_A_ID, SPACEFAST_TOKEN, LEDGER_ZIP_URL, BACKEND_VIEW_ZIP_URL,
// optional PROGRAM_ID from `wp learning-ledger program list`). Connector key is read from the env file
// (ENV_FILE, default .env.server). The ledger step is skipped once the plugin reports a version, so a newer
// zip is never pushed by re-running; reinstall it by hand.
import { ConnectorError, type LedgerStatus } from '../functions/_lib/ledger/connector';
import type { Env } from '../functions/_lib/env';
import { httpSpacefastApi, type SpacefastApi } from './lib/spacefast';

export interface StepReport {
  name: string;
  state: 'done' | 'skipped' | 'failed';
  args?: string[];
}

export interface ProvisionConfig {
  spaceId: string;
  ledgerZipUrl: string;
  backendViewZipUrl: string;
  publicKeyB64: string;
  /** Learning Ledger program post id. The plugin pings `<course-server-url>/content-changed`. */
  programId?: number;
  /** Trusted key id; must match the CONNECTOR_KEY_ID the client signs with. */
  keyId?: string;
  /** Base the plugin appends `/content-changed` to. */
  pingBase?: string;
}

export const KEY_ID = 'course-server';
export const PING_BASE = 'https://learnwp.sqwrlz.com/api';

const EMPTY: LedgerStatus = { versions: {}, roles: [], sensei: null, certificates: null, sodium: null, trustedKeys: [] };

interface Step {
  name: string;
  args?: string[];
  skip: (s: LedgerStatus) => boolean | Promise<boolean>;
  unavailable?: boolean;
}

/** Before the Ledger plugin is installed its route is a 404, which means "nothing yet". Anything else
 * (missing key, timeout, 5xx, bad signature) stops the run. */
function statusOr404(status: () => Promise<LedgerStatus>): () => Promise<LedgerStatus> {
  return () =>
    status().catch((e: unknown) => {
      if (e instanceof ConnectorError && e.status === 404) return EMPTY;
      throw e;
    });
}

async function runSteps(steps: Step[], read: () => Promise<LedgerStatus>, run: (args: string[]) => Promise<boolean>): Promise<StepReport[]> {
  const report: StepReport[] = [];
  let current: LedgerStatus;
  try {
    current = await read();
  } catch {
    return [{ name: 'status', state: 'failed' }];
  }
  for (const step of steps) {
    try {
      if (step.unavailable || (await step.skip(current))) {
        report.push({ name: step.name, state: 'skipped' });
        continue;
      }
      const ok = await run(step.args!);
      report.push({ name: step.name, state: ok ? 'done' : 'failed', args: step.args });
      if (!ok) break;
      current = await read();
    } catch {
      report.push({ name: step.name, state: 'failed', args: step.args });
      break;
    }
  }
  return report;
}

export async function provisionSpaceA(
  api: SpacefastApi,
  status: () => Promise<LedgerStatus>,
  cfg: ProvisionConfig,
): Promise<StepReport[]> {
  // A transport error rejects and is reported as a failed step; it is never read as "not installed".
  const keyId = cfg.keyId ?? KEY_ID;
  const run = (args: string[]) => api.wpCli(cfg.spaceId, args).then((r) => r.ok);
  const read = statusOr404(status);
  const active = (slug: string) => () => run(['plugin', 'is-active', slug]);

  const steps: Step[] = [
    { name: 'sensei', args: ['plugin', 'install', 'sensei-lms', '--version=4.26.4', '--activate'], skip: (s) => s.sensei !== null || active('sensei-lms')() },
    { name: 'certificates', args: ['plugin', 'install', 'sensei-certificates', '--version=2.6.0', '--activate'], skip: (s) => s.certificates !== null || active('sensei-certificates')() },
    // R23: WP-CLI activation does not run the Certificates installer; its option marks that it ran.
    { name: 'certificates-installer', args: ['eval', "do_action('sensei_certificates_run_installer');"], skip: () => run(['option', 'get', 'sensei_certificates_version']) },
    { name: 'ledger', args: ['plugin', 'install', cfg.ledgerZipUrl, '--activate', '--force'], skip: (s) => 'plugin' in s.versions },
    { name: 'backend-view', args: ['plugin', 'install', cfg.backendViewZipUrl, '--activate', '--force'], skip: active('lwr-backend-view') },
    // No read-back exists for the permalink structure; setting it again is harmless.
    { name: 'rewrite', args: ['rewrite', 'structure', '/%postname%/'], skip: () => false },
    { name: 'role', args: ['learning-ledger', 'role', 'enable', 'connector'], skip: (s) => s.roles.includes('connector') },
    { name: 'trust-key', args: ['learning-ledger', 'connector', 'trust-key', `--id=${keyId}`, `--public-key=${cfg.publicKeyB64}`], skip: (s) => s.trustedKeys.includes(keyId) },
    cfg.programId === undefined
      ? { name: 'content-ping', skip: () => true, unavailable: true }
      : { name: 'content-ping', args: ['learning-ledger', 'program', 'update', String(cfg.programId), `--course-server-url=${cfg.pingBase ?? PING_BASE}`], skip: () => false },
  ];

  return runSteps(steps, read, run);
}

export interface SpaceBConfig {
  spaceId: string;
  ledgerZipUrl: string;
  /** Hex SHA-256 of LRS_SECRET. The secret itself never reaches this module. */
  lrsSecretSha256: string;
  clientId?: string;
}

export const LRS_STATUS_URL = 'https://lrs.sqwrlz.com/wp-json/learning-ledger/v1/status';
export const LRS_SCOPES = 'all,void,courses/write,badges/claim-links,records/view-links,actors/erase';
/**
 * Learning Ledger rate-limits each client (class-authenticator.php; default 20 per second, burst 100). Every
 * learner's drains, State syncs and record reads share the one course-server client, so it is in the bulk class.
 */
export const LRS_RATE_CLASS = 'bulk';

/** Reads the LRS Space's public Learning Ledger status route (no auth). A non-2xx response is a ConnectorError. */
export async function lrsStatus(fetchFn: typeof fetch = fetch, url = LRS_STATUS_URL): Promise<LedgerStatus> {
  const res = await fetchFn(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new ConnectorError(res.status, `LRS status ${res.status}`);
  const j = (await res.json()) as Record<string, unknown>;
  const versions: Record<string, string> = {};
  if (typeof j.plugin_version === 'string') versions.plugin = j.plugin_version;
  const roles = Array.isArray(j.roles) ? j.roles.filter((r): r is string => typeof r === 'string') : [];
  return { ...EMPTY, versions, roles, sodium: j.sodium === 'native' || j.sodium === 'compat' ? j.sodium : null };
}

export async function provisionSpaceB(
  api: SpacefastApi,
  status: () => Promise<LedgerStatus>,
  cfg: SpaceBConfig,
): Promise<StepReport[]> {
  const id = cfg.clientId ?? KEY_ID;
  const run = (args: string[]) => api.wpCli(cfg.spaceId, args).then((r) => r.ok);
  const scopes = `--scopes=${LRS_SCOPES}`;
  const rate = `--rate-class=${LRS_RATE_CLASS}`;
  const steps: Step[] = [
    // Space B is a copy of the spike space; the spike plugin must not run beside the ledger.
    { name: 'deactivate-spike', args: ['plugin', 'deactivate', 'lwr-spike'], skip: async () => !(await run(['plugin', 'is-active', 'lwr-spike'])) },
    { name: 'ledger', args: ['plugin', 'install', cfg.ledgerZipUrl, '--activate', '--force'], skip: (s) => 'plugin' in s.versions },
    { name: 'role', args: ['learning-ledger', 'role', 'enable', 'lrs'], skip: (s) => s.roles.includes('lrs') },
    // The status route does not list clients, and `client create` fails on a duplicate. An update of the
    // scopes and rate class succeeds only when the client exists (and re-applies them), so it is the probe.
    {
      name: 'client',
      args: ['learning-ledger', 'client', 'create', `--id=${id}`, `--secret-sha256=${cfg.lrsSecretSha256}`, scopes, rate],
      skip: (s) => s.roles.includes('lrs') && run(['learning-ledger', 'client', 'update', id, scopes, rate]),
    },
  ];
  return runSteps(steps, statusOr404(status), run);
}

async function main(): Promise<void> {
  const which = process.argv[2];
  const need = (k: string) => process.env[k] || (() => { throw new Error(`${k} is not set`); })();
  const envFile = process.env.ENV_FILE ?? '.env.server';
  let report: StepReport[];
  if (which === 'space-b') {
    const { readLrsSecretSha256 } = await import('./keys');
    report = await provisionSpaceB(httpSpacefastApi(need('SPACEFAST_TOKEN')), () => lrsStatus(), {
      spaceId: need('SPACE_B_ID'),
      ledgerZipUrl: need('LEDGER_ZIP_URL'),
      lrsSecretSha256: readLrsSecretSha256(envFile),
    });
  } else if (which === 'space-a') {
    const { generateKeys, readConnectorEnv } = await import('./keys');
    const { ConnectorClient } = await import('../functions/_lib/ledger/connector');
    const { publicKeyB64 } = generateKeys(envFile);
    const connectorEnv = readConnectorEnv(envFile);
    const client = new ConnectorClient(connectorEnv as Env);
    report = await provisionSpaceA(httpSpacefastApi(need('SPACEFAST_TOKEN')), () => client.status(), {
      spaceId: need('SPACE_A_ID'),
      ledgerZipUrl: need('LEDGER_ZIP_URL'),
      backendViewZipUrl: need('BACKEND_VIEW_ZIP_URL'),
      publicKeyB64,
      keyId: connectorEnv.CONNECTOR_KEY_ID,
      programId: process.env.PROGRAM_ID ? Number(process.env.PROGRAM_ID) : undefined,
    });
  } else {
    throw new Error('usage: tsx scripts/provision.ts space-a|space-b');
  }
  for (const s of report) console.log(`${s.state.padEnd(8)} ${s.name}`);
  if (report.some((s) => s.state === 'failed')) process.exit(1);
}

if (process.argv[1]?.endsWith('provision.ts')) void main();
