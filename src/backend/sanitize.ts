/**
 * Allowlist sanitiser for HTML that came over the wire (Sensei's content.rendered). Parses with DOMParser (which never
 * runs scripts), keeps prose markup, unwraps unknown elements to their text, drops active content with its children,
 * and keeps only a few safe attributes.
 */
const KEEP = new Set([
  'p', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'strong', 'b', 'em', 'i', 'code', 'pre', 'blockquote', 'br',
  'hr', 'figure', 'figcaption', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'kbd', 'sub', 'sup',
]);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'template', 'noscript', 'base']);
const ATTRS: Record<string, string[]> = { a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] };

/** http(s), mailto, or a relative/same-origin URL. Anything with another scheme (javascript:, data:) is refused. */
function safeUrl(v: string): boolean {
  const t = v.replace(/[\u0000- ]/g, '');
  return !/^[a-z][a-z0-9+.-]*:/i.test(t) || /^(https?|mailto):/i.test(t);
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
