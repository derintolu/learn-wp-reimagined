import DOMPurify from 'dompurify';

/**
 * The blog is headless: posts live in the space's WordPress, and Spacefast serves only its
 * /wp-json, /wp-admin and /wp-content, never its front end. So /blog and /blog/:slug are app
 * routes that read published posts over REST. Spacefast hides wp/v2 content from anonymous
 * callers, so the read-only route comes from the lwr-blog-cli plugin
 * (wordpress/mu-plugins/lwr-blog-cli.php).
 */
export const POSTS_ENDPOINT = '/wp-json/lwr-blog/v1/posts';

/** A post as the pages use it: titles and excerpts as plain text, the body as sanitized HTML. */
export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  /** ISO 8601 with offset. */
  date: string;
  author: string | null;
  html: string;
}

/** What GET /wp-json/lwr-blog/v1/posts returns for each published post. */
interface RestPost {
  id: number;
  slug: string;
  title: string;
  date: string;
  modified: string;
  excerpt: string;
  content: string;
  author: string;
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
    title: plainText(p.title),
    excerpt: plainText(p.excerpt),
    date: p.date,
    author: p.author || null,
    html: sanitizePostHtml(p.content),
  };
}

async function getPosts(query: Record<string, string> = {}): Promise<BlogPost[]> {
  const params = new URLSearchParams(query).toString();
  const res = await fetch(params ? `${POSTS_ENDPOINT}?${params}` : POSTS_ENDPOINT, { credentials: 'omit', headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`posts request failed: ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error('posts response is not a list');
  return (body as RestPost[]).map(toPost);
}

/** Published posts, newest first (the route orders them). */
export function listPosts(): Promise<BlogPost[]> {
  return getPosts();
}

/** The published post with this slug, or null. */
export async function getPost(slug: string): Promise<BlogPost | null> {
  const [post] = await getPosts({ slug });
  return post ?? null;
}

/** "27 October 2026", in UTC, from an ISO date (one without an offset is read as UTC). */
export function formatDate(date: string): string {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(date) ? date : `${date}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
