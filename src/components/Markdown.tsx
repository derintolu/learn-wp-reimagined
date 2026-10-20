import type { ComponentChildren, VNode } from 'preact';

/**
 * A small Markdown renderer for authored beats and tutor replies. It builds
 * elements directly (never innerHTML), so model output can't inject markup.
 * Covers paragraphs, headings, lists, fenced code, inline code, bold, italics and links.
 */

const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/))/i;

function inline(text: string, key = 0): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  // `code` | **bold** | *em* or _em_ | [label](url) | a bare https URL
  const re =
    /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|(?<![\w])_([^_\s][^_]*)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = key;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<code key={k++}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={k++}>{inline(m[2], k * 100)}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k++}>{inline(m[3], k * 100)}</em>);
    else if (m[4] !== undefined) out.push(<em key={k++}>{inline(m[4], k * 100)}</em>);
    else if (m[5] !== undefined) {
      const url = m[6];
      out.push(
        SAFE_URL.test(url) ? (
          <a key={k++} href={url} {...(/^https?:/i.test(url) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {inline(m[5], k * 100)}
          </a>
        ) : (
          m[5]
        ),
      );
    }
    else if (m[7] !== undefined) {
      out.push(
        <a key={k++} href={m[7]} target="_blank" rel="noopener noreferrer">
          {m[7].replace(/^https?:\/\//, '')}
        </a>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(src: string): VNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: VNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^\s*(```|~~~)\s*([\w-]*)/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++; // closing fence (or end of a still-streaming block)
      blocks.push(
        <pre key={key++} class="md-pre" tabIndex={0}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      // Inside a lesson the page owns h1/h2, so markdown headings start at h3.
      const level = Math.min(6, h[1].length + 2);
      const Tag = `h${level}` as 'h3';
      blocks.push(<Tag key={key++} class="md-h">{inline(h[2])}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        i++;
        // continuation lines that are indented belong to the item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
          item += ' ' + lines[i].trim();
          i++;
        }
        items.push(item);
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={key++}>
          {items.map((t, j) => (
            <li key={j}>{inline(t)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={key++}>{renderMarkdown(quote.join('\n'))}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|~~~)/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) &&
      !/^\s*>/.test(lines[i])
    ) {
      para.push(lines[i++].trim());
    }
    blocks.push(<p key={key++}>{inline(para.join(' '))}</p>);
  }
  return blocks;
}

export function Markdown({ text, class: className }: { text: string; class?: string }) {
  return <div class={`md ${className ?? ''}`.trim()}>{renderMarkdown(text)}</div>;
}
