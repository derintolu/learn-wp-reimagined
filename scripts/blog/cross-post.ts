// Cross-posts a blog post to another WordPress (derintolu.com by default) as a DRAFT, over the
// REST API with an application password.
//
//   npx tsx scripts/blog/cross-post.ts <post.md> --credentials <file> [--site https://derintolu.com]
//
// The credentials file holds two lines, `user=...` and `password=...` (an application password).
// It is read, never printed, and never kept in the repo. The learnwp.sqwrlz.com post is the
// original: the cross-post opens with "Originally published on Learn WordPress, reimagined",
// linking to it. Re-running updates the same draft (matched by slug); a post with that slug that
// is no longer a draft is left alone. Nothing is ever published.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { originalLine, parsePost, postUrl, toBlocks } from './markdown.ts';

/** SEO plugins whose REST namespace means a canonical URL could be set. */
export const SEO_NAMESPACES: Record<string, string> = {
  'yoast/v1': 'Yoast SEO',
  'rankmath/v1': 'Rank Math',
  'aioseo/v1': 'All in One SEO',
};

export function readCredentials(text: string): { user: string; password: string } {
  const get = (k: string) => new RegExp(`^${k}=(.*)$`, 'm').exec(text)?.[1].trim();
  const user = get('user');
  const password = get('password');
  if (!user || !password) throw new Error('credentials file needs user= and password= lines');
  return { user, password };
}

/** The REST body for the cross-post: same title, excerpt and body, with the origin line on top. */
export function crossPostBody(source: string) {
  const post = parsePost(source);
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    status: 'draft' as const,
    content: `${originalLine(post.slug)}\n\n${toBlocks(post.body)}`,
  };
}

export function seoPlugins(namespaces: string[]): string[] {
  return namespaces.filter((n) => n in SEO_NAMESPACES).map((n) => SEO_NAMESPACES[n]);
}

async function main(argv: string[]): Promise<void> {
  const file = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const credFile = flag('--credentials');
  const site = (flag('--site') ?? 'https://derintolu.com').replace(/\/+$/, '');
  if (!file || !credFile) throw new Error('usage: cross-post.ts <post.md> --credentials <file> [--site <url>]');
  if (!site.startsWith('https://')) throw new Error('--site must be https');
  const { user, password } = readCredentials(readFileSync(credFile, 'utf8'));
  const auth = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${site}/wp-json${path}`, {
      ...init,
      headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${(body as { code?: string })?.code ?? ''}`);
    return body;
  };

  const body = crossPostBody(readFileSync(file, 'utf8'));
  const root = (await api('/')) as { namespaces?: string[] };
  const seo = seoPlugins(root.namespaces ?? []);

  const existing = (await api(
    `/wp/v2/posts?slug=${encodeURIComponent(body.slug)}&status=draft,pending,future,publish,private&context=edit&_fields=id,status`,
  )) as { id: number; status: string }[];
  let id: number;
  if (existing.length && existing[0].status !== 'draft') {
    console.log(`${site}: "${body.slug}" exists as ${existing[0].status} (id ${existing[0].id}); left alone.`);
    return;
  } else if (existing.length) {
    id = existing[0].id;
    await api(`/wp/v2/posts/${id}`, { method: 'POST', body: JSON.stringify(body) });
    console.log(`${site}: updated draft ${id} "${body.title}"`);
  } else {
    id = ((await api('/wp/v2/posts', { method: 'POST', body: JSON.stringify(body) })) as { id: number }).id;
    console.log(`${site}: created draft ${id} "${body.title}"`);
  }
  if (seo.length) console.log(`  ${seo.join(', ')} found: set its canonical URL to ${postUrl(body.slug)} in the post's SEO panel.`);
  else console.log(`  No SEO plugin found, so no rel=canonical; the post links to ${postUrl(body.slug)}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
