// Cross-posts a blog post to Derin's site, derintolu.com, as a DRAFT. The site is on WordPress.com
// (site ID 165681337), so this goes through the WordPress.com REST API with an OAuth token:
//
//   npx tsx scripts/blog/cross-post.ts <post.md> --token-file <file> [--site-id 165681337]
//
// The token file holds one line, `token=...` (a WordPress.com OAuth access token with the posts
// scope). It is read, never printed, and never kept in the repo. The learnwp.sqwrlz.com post is the
// original: the cross-post opens with "Originally published on Learn WordPress, reimagined",
// linking to it. Re-running updates the same draft (matched by slug); a post with that slug that
// is no longer a draft is left alone. Nothing is ever published.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { originalLine, parsePost, postUrl, toBlocks } from './markdown.ts';

export const WPCOM_API = 'https://public-api.wordpress.com/wp/v2/sites/';
export const DERINTOLU_SITE_ID = '165681337';
export const DERINTOLU_URL = 'https://derintolu.com';

/** SEO plugins whose REST namespace means a canonical URL could be set. */
export const SEO_NAMESPACES: Record<string, string> = {
  'yoast/v1': 'Yoast SEO',
  'rankmath/v1': 'Rank Math',
  'aioseo/v1': 'All in One SEO',
};

export function readToken(text: string): string {
  const token = /^token=(.*)$/m.exec(text)?.[1].trim();
  if (!token) throw new Error('token file needs a token= line');
  return token;
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
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const file = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  const tokenFile = flag('--token-file');
  const siteId = flag('--site-id') ?? DERINTOLU_SITE_ID;
  if (!file || !tokenFile) throw new Error('usage: cross-post.ts <post.md> --token-file <file> [--site-id <id>]');
  if (!/^\d+$/.test(siteId)) throw new Error('--site-id must be numeric');
  const auth = `Bearer ${readToken(readFileSync(tokenFile, 'utf8'))}`;
  const base = `${WPCOM_API}${siteId}`;
  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${res.status} ${(body as { code?: string })?.code ?? ''}`);
    return body;
  };

  const body = crossPostBody(readFileSync(file, 'utf8'));
  const existing = (await api(
    `/posts?slug=${encodeURIComponent(body.slug)}&status=draft,pending,future,publish,private&context=edit&_fields=id,status`,
  )) as { id: number; status: string }[];
  if (existing.length && existing[0].status !== 'draft') {
    console.log(`site ${siteId}: "${body.slug}" exists as ${existing[0].status} (id ${existing[0].id}); left alone.`);
    return;
  }
  if (existing.length) {
    await api(`/posts/${existing[0].id}`, { method: 'POST', body: JSON.stringify(body) });
    console.log(`site ${siteId}: updated draft ${existing[0].id} "${body.title}"`);
  } else {
    const created = (await api('/posts', { method: 'POST', body: JSON.stringify(body) })) as { id: number };
    console.log(`site ${siteId}: created draft ${created.id} "${body.title}"`);
  }

  // The site's own REST root is public; it says whether an SEO plugin could carry a canonical.
  const root = (await fetch(`${DERINTOLU_URL}/wp-json/`).then((r) => r.json()).catch(() => ({}))) as { namespaces?: string[] };
  const seo = seoPlugins(root.namespaces ?? []);
  if (seo.length) console.log(`  ${seo.join(', ')} found: set its canonical URL to ${postUrl(body.slug)} in the post's SEO panel.`);
  else console.log(`  No SEO plugin found, so no rel=canonical; the post links to ${postUrl(body.slug)}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2));
}
