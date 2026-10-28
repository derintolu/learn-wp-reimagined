/**
 * Sensei's course and lesson content, read anonymously from the same origin through the read-only public route our
 * lwr-backend-view plugin serves (ruling R17): Spacefast empties anonymous wp/v2 post reads, and Sensei's own public
 * pages are unreachable (R13). The route finds posts by Learning Ledger's stable key (else slug) and returns the
 * course's lessons in Sensei's order.
 */
export interface SenseiLessonRef { key: string; title: string }
export interface SenseiCourse { key: string; title: string; html: string; lessons: SenseiLessonRef[] }
export interface SenseiLesson { key: string; title: string; html: string; course: string | null }

const TIMEOUT_MS = 3000;
const BASE = '/wp-json/lwr-backend-view/v1';

/** The parsed body, or null on 404 (WordPress answers, Sensei has no such published post). Any other failure throws. */
async function getJson(path: string): Promise<Record<string, unknown> | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${path}`, { credentials: 'omit', signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (res.status === 404) {
      const body = await res.json().catch(() => null);
      // Only the plugin's own 404 means "absent"; a 404 from elsewhere means the plugin is not answering.
      if (body && (body as { code?: string }).code === 'lwr_not_found') return null;
      throw new Error('route not found');
    }
    if (!res.ok) throw new Error(`Sensei answered ${res.status}`);
    const body = await res.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('unexpected answer');
    return body as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function fetchCourse(key: string): Promise<SenseiCourse | null> {
  const r = await getJson(`course/${encodeURIComponent(key)}`);
  if (!r) return null;
  const lessons = Array.isArray(r.lessons) ? (r.lessons as Record<string, unknown>[]) : [];
  return {
    key: str(r.key),
    title: str(r.title),
    html: str(r.content),
    lessons: lessons.map((l) => ({ key: str(l.key), title: str(l.title) })).filter((l) => l.key),
  };
}

export async function fetchLesson(key: string): Promise<SenseiLesson | null> {
  const r = await getJson(`lesson/${encodeURIComponent(key)}`);
  if (!r) return null;
  return { key: str(r.key), title: str(r.title), html: str(r.content), course: typeof r.course === 'string' ? r.course : null };
}
