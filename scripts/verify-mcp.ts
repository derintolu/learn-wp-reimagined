// Checks a running course connector with the official MCP SDK client.
//
//   npx tsx scripts/verify-mcp.ts <url> [legacy|modern] [--handle-file <path>] [--export <path>]
//
// Extra request headers (for example an access token for a private space) are read from the JSON file
// named by $MCP_HEADERS_FILE. Prints only the server name, the tool names and, with --handle-file, the
// lesson the record continues at. Never prints header values or handles.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export async function verifyMcp(
  url: string,
  era: 'legacy' | 'modern',
  headers: Record<string, string>,
  opts: { handle?: string; exportTo?: string } = {},
): Promise<{ serverName: string; tools: string[]; lessonId?: string }> {
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  const client = new Client(
    { name: 'learn-wp-verify', version: '0.0.0' },
    era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {},
  );
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    const out: { serverName: string; tools: string[]; lessonId?: string } = { serverName: client.getServerVersion()?.name ?? '', tools };
    if (opts.handle) {
      const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;
      const start = await call('start_placement', { handle: opts.handle });
      if (start.isError) throw new Error(`start_placement failed: ${start.structuredContent?.error}`);
      const beat = await call('next_beat', { handle: opts.handle });
      out.lessonId = beat.structuredContent?.lesson?.id;
      if (opts.exportTo) {
        const rec = await call('get_record', { handle: opts.handle });
        writeFileSync(opts.exportTo, JSON.stringify(rec.structuredContent.record, null, 2), { mode: 0o600 });
      }
    }
    return out;
  } finally {
    await client.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const handleFile = flag('--handle-file');
  const exportTo = flag('--export');
  const [url, era = 'legacy'] = args;
  if (!url || (era !== 'legacy' && era !== 'modern')) throw new Error('usage: verify-mcp.ts <url> [legacy|modern] [--handle-file <path>] [--export <path>]');
  const headers = process.env.MCP_HEADERS_FILE ? (JSON.parse(readFileSync(process.env.MCP_HEADERS_FILE, 'utf8')) as Record<string, string>) : {};
  const handle = handleFile ? readFileSync(handleFile, 'utf8').trim() : undefined;
  const r = await verifyMcp(url, era, headers, { handle, exportTo });
  console.log(`server: ${r.serverName}`);
  console.log(`tools (${r.tools.length}): ${r.tools.join(', ')}`);
  if (r.lessonId !== undefined) console.log(`continues at: ${r.lessonId}`);
}
