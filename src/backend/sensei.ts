/**
 * Sensei's public REST, read anonymously from the same origin (ruling R13). Sensei registers `course` and `lesson`
 * with show_in_rest, so core's wp/v2 routes serve published ones to anyone. Lessons are looked up by slug (the studio's
 * lesson id); the stable-key meta Learning Ledger keeps (`_lledger_stable_key`) is not exposed over REST.
 */
export interface SenseiPost { id: number; slug: string; title: string; html: string }

const TIMEOUT_MS = 3000;
const FIELDS = '_fields=id,slug,title,content';

interface Raw { id: number; slug: string; title?: { rendered?: string }; content?: { rendered?: string } }

async function getJson(path: string): Promise<Raw[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`/wp-json/wp/v2/${path}`, { credentials: 'omit', signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Sensei answered ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error('Sensei did not answer with a list');
    return body as Raw[];
  } finally {
    clearTimeout(timer);
  }
}

const shape = (r: Raw): SenseiPost => ({ id: r.id, slug: r.slug, title: r.title?.rendered ?? '', html: r.content?.rendered ?? '' });

/** The course whose slug is the path id, or null when Sensei has none. */
export async function fetchCourse(pathId: string): Promise<SenseiPost | null> {
  const rows = await getJson(`course?slug=${encodeURIComponent(pathId)}&${FIELDS}`);
  return rows[0] ? shape(rows[0]) : null;
}

/** The lessons with these slugs, returned in the order asked for; slugs Sensei lacks are left out. */
export async function fetchLessons(slugs: string[]): Promise<SenseiPost[]> {
  if (slugs.length === 0) return [];
  const q = slugs.map((s) => `slug[]=${encodeURIComponent(s)}`).join('&');
  const rows = (await getJson(`lesson?${q}&per_page=100&${FIELDS}`)).map(shape);
  return slugs.map((s) => rows.find((r) => r.slug === s)).filter((r): r is SenseiPost => !!r);
}
