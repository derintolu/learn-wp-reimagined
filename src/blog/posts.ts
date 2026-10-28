import DOMPurify from 'dompurify';

/**
 * The blog is headless: posts live in the space's WordPress, and Spacefast serves only its
 * /wp-json, /wp-admin and /wp-content, never its front end. So /blog and /blog/:slug are app
 * routes that read published posts from the REST API.
 */
export const POSTS_ENDPOINT = '/wp-json/wp/v2/posts';

/** A post as the pages use it: titles and excerpts as plain text, the body as sanitized HTML. */
export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  author: string | null;
  html: string;
}

interface RestPost {
  slug: string;
  date_gmt: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  content: { rendered: string };
  _embedded?: { author?: { name?: string }[] };
}

/** Rendered WordPress text (entities, inline tags) as plain text. Never parsed as live HTML. */
export function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

let purifier: ReturnType<typeof DOMPurify> | null = null;

/** Sanitizes a post body. Code blocks become focusable so a keyboard can scroll them. */
export function sanitizePostHtml(html: string): string {
  if (!purifier) {
    purifier = DOMPurify(window);
    purifier.addHook('afterSanitizeAttributes', (node) => {
      if (node.nodeName === 'PRE') node.setAttribute('tabindex', '0');
    });
  }
  return purifier.sanitize(html, { USE_PROFILES: { html: true } });
}

function toPost(p: RestPost): BlogPost {
  return {
    slug: p.slug,
    title: plainText(p.title.rendered),
    excerpt: plainText(p.excerpt.rendered),
    date: p.date_gmt,
    author: p._embedded?.author?.[0]?.name ?? null,
    html: sanitizePostHtml(p.content.rendered),
  };
}

async function getPosts(query: Record<string, string>): Promise<BlogPost[]> {
  const params = new URLSearchParams({ status: 'publish', _embed: 'author', ...query });
  const res = await fetch(`${POSTS_ENDPOINT}?${params}`, { credentials: 'omit', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`posts request failed: ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error('posts response is not a list');
  return (body as RestPost[]).map(toPost);
}

/** Published posts, newest first. */
export function listPosts(): Promise<BlogPost[]> {
  return getPosts({ per_page: '100', orderby: 'date', order: 'desc' });
}

/** The published post with this slug, or null. */
export async function getPost(slug: string): Promise<BlogPost | null> {
  const [post] = await getPosts({ slug });
  return post ?? null;
}

/** "27 October 2026", from WordPress's GMT date. */
export function formatDate(dateGmt: string): string {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(dateGmt) ? dateGmt : `${dateGmt}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
