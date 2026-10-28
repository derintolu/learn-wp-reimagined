import { useCallback, useEffect, useState } from 'preact/hooks';
import { phaseOn } from '../config';
import { LRS_ORIGIN } from '../badges/badges';
import type { OfficialRecord } from '../shared/official';

/** The learner's official record from the course server, or null while it cannot be read. */
export async function fetchOfficial(): Promise<OfficialRecord | null> {
  try {
    const res = await fetch('/api/record', { credentials: 'same-origin' });
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

let shared: { official: OfficialRecord | null; version: number } = { official: null, version: 0 };
const listeners = new Set<() => void>();
function publish(official: OfficialRecord | null) {
  shared = { official, version: shared.version + 1 };
  listeners.forEach((fn) => fn());
}
/** Forget the official record held here, e.g. after the learner's data is deleted. */
let seq = 0;
export const clearOfficial = (): void => {
  seq++;
  publish(null);
};

/**
 * The official record, re-read when the window regains focus. A read that fails clears what was held,
 * so an old record is never shown as current. Does nothing with the phase off.
 */
export function useOfficialRecord(active = true): { official: OfficialRecord | null; version: number; loading: boolean; refresh: () => void } {
  const [, force] = useState(0);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const on = phaseOn('officialRecord') && active;
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => void listeners.delete(fn);
  }, []);
  useEffect(() => {
    if (!on) return;
    const mine = ++seq;
    setLoading(true);
    fetchOfficial().then((r) => {
      if (mine !== seq) return; // a newer read, or a delete, has overtaken this one
      setLoading(false);
      publish(r);
    });
  }, [on, tick]);
  useEffect(() => {
    if (!on) return;
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [on, refresh]);
  return { official: on ? shared.official : null, version: shared.version, loading, refresh };
}
