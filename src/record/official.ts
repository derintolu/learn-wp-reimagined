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

/** The official record, re-read when the window regains focus. Does nothing with the phase off. */
export function useOfficialRecord(active = true): { official: OfficialRecord | null; loading: boolean; refresh: () => void } {
  const [official, setOfficial] = useState<OfficialRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const on = phaseOn('officialRecord') && active;
  useEffect(() => {
    if (!on) return;
    let live = true;
    setLoading(true);
    fetchOfficial().then((r) => {
      if (!live) return;
      setLoading(false);
      if (r) setOfficial(r);
    });
    return () => {
      live = false;
    };
  }, [on, tick]);
  useEffect(() => {
    if (!on) return;
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [on, refresh]);
  return { official, loading, refresh };
}
