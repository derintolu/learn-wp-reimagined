import { useEffect, useState } from 'preact/hooks';
import { phaseOn } from '../config';
import type { PathId } from '../shared/types';

export interface BadgeSummary {
  id: string;
  pathId: PathId;
  name: string;
  status: 'pending' | 'claimed';
  testedOut: number;
}

/** Where claim links point: the LRS. A link anywhere else is never followed. */
export const LRS_ORIGIN = 'https://lrs.sqwrlz.com';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** "You tested out of ..." in words: "no lessons", "one lesson", "three lessons". */
export function testedOutInWords(n: number): string {
  const w = WORDS[n] ?? String(n);
  return `${w} ${n === 1 ? 'lesson' : 'lessons'}`;
}

/** The learner's badges, or null while loading or when they cannot be read. Does nothing with the flag off. */
export async function fetchBadges(): Promise<BadgeSummary[] | null> {
  try {
    const res = await fetch('/api/badges', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body) ? (body as BadgeSummary[]) : null;
  } catch {
    return null;
  }
}

/** A fresh claim URL for the badge (the LRS replaces the one before it), or null if none could be made. */
export async function mintClaimUrl(badge: string): Promise<string | null> {
  try {
    const res = await fetch('/api/badges/claim-link', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ badge }),
    });
    if (!res.ok) return null;
    const url = ((await res.json()) as { url?: unknown }).url;
    if (typeof url !== 'string') return null;
    const u = new URL(url);
    return u.origin === LRS_ORIGIN ? u.href : null;
  } catch {
    return null;
  }
}

export function useBadges(active = true): BadgeSummary[] | null {
  const [badges, setBadges] = useState<BadgeSummary[] | null>(null);
  useEffect(() => {
    if (!phaseOn('badges') || !active) return;
    let live = true;
    fetchBadges().then((b) => live && setBadges(b));
    return () => {
      live = false;
    };
  }, [active]);
  return badges;
}
