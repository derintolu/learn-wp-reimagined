import type { Plugin, ViteDevServer } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSqliteD1 } from './sqliteD1.ts';
import type { Env } from '../functions/_lib/env.ts';

function readDotEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

async function readBody(req: import('node:http').IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

export function apiPlugin(): Plugin {
  return {
    name: 'learn-wp-dev-api',
    configureServer(server: ViteDevServer) {
      const root = server.config.root;
      const DB = createSqliteD1(resolve(root, '.data/dev.sqlite'));

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();
        try {
          const rel = url.pathname.slice('/api/'.length).replace(/\/+$/, '');
          const parts = rel.split('/').filter(Boolean);
          if (!parts.length || parts.some((p) => p.startsWith('_') || p === '..')) return next();

          const base = resolve(root, 'functions/api');
          const candidates = [resolve(base, ...parts) + '.ts', resolve(base, ...parts, 'index.ts')];
          const file = candidates.find((c) => c.startsWith(base) && existsSync(c));
          if (!file) {
            res.statusCode = 404;
            res.setHeader('content-type', 'application/json');
            return res.end(JSON.stringify({ error: { code: 'not-found', message: 'No such route' } }));
          }

          const mod = await server.ssrLoadModule(file);
          const method = (req.method ?? 'GET').toUpperCase();
          const fn = mod[method];
          if (typeof fn !== 'function') {
            res.statusCode = 405;
            res.setHeader('content-type', 'application/json');
            return res.end(JSON.stringify({ error: { code: 'method-not-allowed', message: method } }));
          }

          const env = { ...readDotEnv(resolve(root, '.env.server')), DB } as unknown as Env;
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
          }
          const body = await readBody(req);
          const request = new Request(url, { method, headers, body: body ? new Uint8Array(body) : undefined });
          const response: Response = await fn(request, { params: {}, env });

          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          server.ssrFixStacktrace(e as Error);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: { code: 'internal', message: (e as Error).message } }));
        }
      });
    },
  };
}
