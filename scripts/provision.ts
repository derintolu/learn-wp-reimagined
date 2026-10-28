// Idempotent Space A provisioning through WP-CLI. Only public values appear in arguments.
// CLI: npx tsx scripts/provision.ts space-a   (SPACE_A_ID, SPACEFAST_TOKEN, LEDGER_ZIP_URL, BACKEND_VIEW_ZIP_URL,
// optional PROGRAM_ID from `wp learning-ledger program list`)
import type { LedgerStatus } from '../functions/_lib/ledger/connector';
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
  /** Base the plugin appends `/content-changed` to. */
  pingBase?: string;
}

export const KEY_ID = 'course-server';
export const PING_BASE = 'https://learnwp.sqwrlz.com/api';

const EMPTY: LedgerStatus = { versions: {}, roles: [], sensei: null, certificates: null, sodium: null, trustedKeys: [] };

export async function provisionSpaceA(
  api: SpacefastApi,
  status: () => Promise<LedgerStatus>,
  cfg: ProvisionConfig,
): Promise<StepReport[]> {
  const run = (args: string[]) => api.wpCli(cfg.spaceId, args).then((r) => r.ok, () => false);
  // Before the Ledger plugin is installed the status route does not exist: that means "nothing yet".
  const read = () => status().catch(() => EMPTY);
  const active = (slug: string) => () => run(['plugin', 'is-active', slug]);

  interface Step {
    name: string;
    args?: string[];
    skip: (s: LedgerStatus) => boolean | Promise<boolean>;
    unavailable?: boolean;
  }
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
    { name: 'trust-key', args: ['learning-ledger', 'connector', 'trust-key', `--id=${KEY_ID}`, `--public-key=${cfg.publicKeyB64}`], skip: (s) => s.trustedKeys.includes(KEY_ID) },
    cfg.programId === undefined
      ? { name: 'content-ping', skip: () => true, unavailable: true }
      : { name: 'content-ping', args: ['learning-ledger', 'program', 'update', String(cfg.programId), `--course-server-url=${cfg.pingBase ?? PING_BASE}`], skip: () => false },
  ];

  const report: StepReport[] = [];
  let current = await read();
  for (const step of steps) {
    if (step.unavailable || (await step.skip(current))) {
      report.push({ name: step.name, state: 'skipped' });
      continue;
    }
    const ok = await run(step.args!);
    report.push({ name: step.name, state: ok ? 'done' : 'failed', args: step.args });
    if (!ok) break;
    current = await read();
  }
  return report;
}

async function main(): Promise<void> {
  if (process.argv[2] !== 'space-a') throw new Error('usage: tsx scripts/provision.ts space-a');
  const need = (k: string) => process.env[k] || (() => { throw new Error(`${k} is not set`); })();
  const { generateKeys } = await import('./keys');
  const { ConnectorClient } = await import('../functions/_lib/ledger/connector');
  const { publicKeyB64 } = generateKeys(process.env.ENV_FILE ?? '.env.server');
  const env = { CONNECTOR_SIGNING_KEY: process.env.CONNECTOR_SIGNING_KEY, CONNECTOR_KEY_ID: process.env.CONNECTOR_KEY_ID };
  const client = new ConnectorClient(env as never);
  const report = await provisionSpaceA(httpSpacefastApi(need('SPACEFAST_TOKEN')), () => client.status(), {
    spaceId: need('SPACE_A_ID'),
    ledgerZipUrl: need('LEDGER_ZIP_URL'),
    backendViewZipUrl: need('BACKEND_VIEW_ZIP_URL'),
    publicKeyB64,
    programId: process.env.PROGRAM_ID ? Number(process.env.PROGRAM_ID) : undefined,
  });
  for (const s of report) console.log(`${s.state.padEnd(8)} ${s.name}`);
  if (report.some((s) => s.state === 'failed')) process.exit(1);
}

if (process.argv[1]?.endsWith('provision.ts')) void main();
