/**
 * Allowlist sanitiser for HTML that came over the wire (Sensei's content.rendered). Parses with DOMParser (which never
 * runs scripts), keeps prose markup, unwraps unknown elements to their text, drops active content with its children,
 * and keeps only a few safe attributes.
 */
const KEEP = new Set([
  'p', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'strong', 'b', 'em', 'i', 'code', 'pre', 'blockquote', 'br',
  'hr', 'figure', 'figcaption', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'kbd', 'sub', 'sup',
  'u', 's', 'mark', 'abbr', 'cite', 'q', 'dl', 'dt', 'dd',
]);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'template', 'noscript', 'base']);
const ATTRS: Record<string, string[]> = { a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] };

/**
 * http(s), mailto, a fragment, or a file under /wp-content/. Anything with another scheme (javascript:, data:) is
 * refused, and so is any other relative URL: the page is on the app's origin, where only /wp-content/ reaches
 * WordPress, so a relative link to a WordPress page would land on the app's NotFound.
 */
function safeUrl(v: string): boolean {
  const t = v.replace(/[\u0000- ]/g, '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return /^(https?|mailto):/i.test(t);
  return t.startsWith('#') || t.startsWith('/wp-content/');
}

function clean(node: Node, doc: Document): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) continue;
    if (child.nodeType !== 1) {
      node.removeChild(child);
      continue;
    }
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP.has(tag)) {
      node.removeChild(el);
      continue;
    }
    clean(el, doc);
    if (tag === 'h1') {
      // A page has one h1 already; Sensei's become h2.
      const h2 = doc.createElement('h2');
      while (el.firstChild) h2.appendChild(el.firstChild);
      node.replaceChild(h2, el);
      continue;
    }
    if (!KEEP.has(tag)) {
      while (el.firstChild) node.insertBefore(el.firstChild, el);
      node.removeChild(el);
      continue;
    }
    const allowed = ATTRS[tag] ?? [];
    for (const a of Array.from(el.attributes)) {
      if (!allowed.includes(a.name) || ((a.name === 'href' || a.name === 'src') && !safeUrl(a.value))) el.removeAttribute(a.name);
    }
    if (tag === 'a' && el.hasAttribute('href')) el.setAttribute('rel', 'noopener noreferrer');
    if (tag === 'img' && !el.hasAttribute('src')) node.removeChild(el);
  }
}

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  clean(doc.body, doc);
  return doc.body.innerHTML;
}

/** Decode the entities in a rendered title ("A &amp; B") to plain text. */
export function plainText(html: string): string {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body.textContent ?? '';
}
