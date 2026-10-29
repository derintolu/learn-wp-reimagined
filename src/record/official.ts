import { useCallback, useEffect, useState } from 'preact/hooks';
import { LRS_ORIGIN } from '../badges/badges';
import type { OfficialRecord } from '../shared/official';

/** 'none': the learner has no session yet (or just deleted it), so nothing is recorded. */
export type OfficialRead = OfficialRecord | 'none' | null;

/** The learner's official record from the course server; 'none' with no session; null while it cannot be read. */
export async function fetchOfficial(): Promise<OfficialRead> {
  try {
    const res = await fetch('/api/record', { credentials: 'same-origin' });
    if (res.status === 401) return 'none';
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<OfficialRecord> | null;
    if (!j || !Array.isArray(j.completed) || !Array.isArray(j.testedOut)) return null;
    return j as OfficialRecord;
  } catch {
    return null;
  }
}

/** A link to the LRS's own view of the record, or null unless it is on the LRS origin. */
export async function mintViewUrl(): Promise<string | null> {
  try {
    const res = await fetch('/api/record/view-link', { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return null;
    const url = ((await res.json()) as { url?: unknown }).url;
    if (typeof url !== 'string') return null;
    const u = new URL(url);
    return u.origin === LRS_ORIGIN ? u.href : null;
  } catch {
    return null;
  }
}

/** Save the learner's record export, checking the answer first so an error is never saved as the record. */
export async function downloadOfficial(): Promise<boolean> {
  try {
    const res = await fetch('/api/record/export', { credentials: 'same-origin' });
    if (!res.ok) return false;
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'learn-wp-reimagined-record.json';
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

let shared: { official: OfficialRecord | null; none: boolean; version: number } = { official: null, none: false, version: 0 };
const listeners = new Set<() => void>();
function publish(read: OfficialRead) {
  shared = { official: read === 'none' ? null : read, none: read === 'none', version: shared.version + 1 };
  listeners.forEach((fn) => fn());
}
/** Forget the official record held here, e.g. after the learner's data is deleted. */
let seq = 0;
let inflight = 0;
const notify = () => listeners.forEach((fn) => fn());
export const clearOfficial = (): void => {
  seq++;
  // Only called once the server has deleted the session, so there is nothing recorded now.
  publish('none');
};

/**
 * The official record, re-read when the window regains focus. A read that fails clears what was held,
 * so an old record is never shown as current. Does nothing while `active` is false.
 */
export function useOfficialRecord(active = true): { official: OfficialRecord | null; none: boolean; version: number; loading: boolean; refresh: () => void } {
  const [, force] = useState(0);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const on = active;
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  useEffect(() => {
    if (!on) return;
    const mine = ++seq;
    inflight++;
    notify();
    fetchOfficial().then((r) => {
      inflight--;
      // A newer read, or a delete, has overtaken this one: drop its result but still end its loading.
      if (mine === seq) publish(r);
      else notify();
    });
  }, [on, tick]);
  useEffect(() => {
    if (!on) return;
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [on, refresh]);
  return { official: on ? shared.official : null, none: on && shared.none, version: shared.version, loading: on && inflight > 0, refresh };
}
