// A blog post is one Markdown file: front matter with title, slug and excerpt, then a CommonMark
// subset. It is turned into block markup here, so the same text becomes a WordPress draft on
// learnwp.sqwrlz.com (draft-learnwp.ts) and a cross-post on another WordPress (cross-post.ts).
//
// Supported: ## and ### headings, paragraphs, "- " lists, fenced code, `code`, **bold**, *em*
// and [links](url). Anything else is kept as paragraph text, escaped.

export const BLOG_BASE = 'https://learnwp.sqwrlz.com/blog/';

export interface Post {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
}

const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return JSON.parse(t) as string;
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** Splits a post file into its front matter (title, slug, excerpt) and Markdown body. */
export function parsePost(source: string): Post {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!m) throw new Error('post has no front matter');
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = unquote(kv[2]);
  }
  for (const key of ['title', 'slug', 'excerpt'] as const) {
    if (!meta[key]) throw new Error(`front matter is missing ${key}`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.slug)) throw new Error(`bad slug: ${meta.slug}`);
  return { title: meta.title, slug: meta.slug, excerpt: meta.excerpt, body: m[2].trim() };
}

/** Inline Markdown to HTML. Text is escaped first; only safe link targets become links. */
export function inline(text: string): string {
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out += escapeHtml(text.slice(last, m.index));
    if (m[1] !== undefined) out += `<code>${escapeHtml(m[1])}</code>`;
    else if (m[2] !== undefined) out += `<strong>${inline(m[2])}</strong>`;
    else if (m[3] !== undefined) out += `<em>${inline(m[3])}</em>`;
    else if (SAFE_URL.test(m[5])) out += `<a href="${escapeAttr(m[5])}">${inline(m[4])}</a>`;
    else out += escapeHtml(m[4]);
    last = re.lastIndex;
  }
  return out + escapeHtml(text.slice(last));
}

const paragraph = (html: string) => `<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->`;

/** A Markdown body to serialized blocks (core/heading, paragraph, list, code). */
export function toBlocks(body: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      if (i >= lines.length) throw new Error('unclosed code fence');
      i++;
      blocks.push(`<!-- wp:code -->\n<pre class="wp-block-code"><code>${escapeHtml(code.join('\n'))}</code></pre>\n<!-- /wp:code -->`);
      continue;
    }
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const attrs = level === 2 ? '' : ` {"level":${level}}`;
      blocks.push(`<!-- wp:heading${attrs} -->\n<h${level} class="wp-block-heading">${inline(heading[2].trim())}</h${level}>\n<!-- /wp:heading -->`);
      i++;
      continue;
    }
    if (/^#\s/.test(line)) throw new Error('use ## or ###: the post title is the only h1');
    if (/^- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i])) {
        let item = lines[i++].slice(2).trim();
        // Continuation lines are indented.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*- /.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(`<!-- wp:list-item -->\n<li>${inline(item)}</li>\n<!-- /wp:list-item -->`);
      }
      blocks.push(`<!-- wp:list -->\n<ul class="wp-block-list">${items.join('\n')}</ul>\n<!-- /wp:list -->`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,3}\s|- )/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push(paragraph(inline(para.join(' '))));
  }
  return blocks.join('\n\n');
}

export const postUrl = (slug: string) => `${BLOG_BASE}${slug}/`;

/** The line that heads a cross-post, pointing at the original on the prototype's blog. */
export function originalLine(slug: string): string {
  return paragraph(`<em>Originally published on <a href="${escapeAttr(postUrl(slug))}">Learn WordPress, reimagined</a>.</em>`);
}
