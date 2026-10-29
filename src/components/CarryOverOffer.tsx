import { useState } from 'preact/hooks';
import { useOfficialRecord } from '../record/official';
import { ensureSession } from '../record/session';
import { useRecord } from '../record/useRecord';
import type { OfficialRecord } from '../shared/official';
import type { LearningRecord } from '../shared/record';
import './agent.css';

export const OFFER_TITLE = 'Bring your progress over';
export const OFFER_DECLINE = 'Not now';
export const OFFER_DONE = 'Your progress is in the official record now.';
const OFFER_KEY = 'lwr-carry-over';

const remembered = (): boolean => {
  try {
    return localStorage.getItem(OFFER_KEY) !== null;
  } catch {
    return false;
  }
};
const remember = (v: 'done' | 'declined') => {
  try {
    localStorage.setItem(OFFER_KEY, v);
  } catch {
    // Without storage the offer simply shows again next visit.
  }
};

/**
 * Lessons finished in this browser that the official record doesn't have (completed, tested out or carried
 * over). Every record is version 1, so the version can't tell an old record from a new one; this can. Files and
 * the position reach the official record through State sync, so they alone are no reason to offer. With no
 * session yet (`official` null), every local completion is missing.
 */
export const missingFromOfficial = (r: LearningRecord, official: OfficialRecord | null): string[] => {
  const known = new Set([...(official?.completed ?? []), ...(official?.testedOut ?? []), ...(official?.carriedOver ?? [])]);
  return r.completedLessons.filter((id) => !known.has(id));
};

/** Offers, once, to carry the old local record's progress into the official record. Nothing is sent until the learner agrees. */
export function CarryOverOffer() {
  return <Offer />;
}

function Offer() {
  const { record } = useRecord();
  const [hidden, setHidden] = useState(remembered);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read the official record only when there is something local to compare.
  const { official, none } = useOfficialRecord(!hidden && !done && record.completedLessons.length > 0);

  if (done) {
    return (
      <div role="status" class="carry-over">
        <p class="carry-over__text">{OFFER_DONE}</p>
      </div>
    );
  }
  // Until the official record has been read (or is known to be empty), there is nothing to compare.
  if (hidden || !(official || none) || missingFromOfficial(record, none ? null : official).length === 0) return null;

  async function bringOver() {
    setBusy(true);
    setError(null);
    try {
      if (!(await ensureSession())) throw new Error('no session');
      const res = await fetch('/api/carry-over', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ completedLessons: record.completedLessons, files: record.files, ...(record.current ? { current: record.current } : {}) }),
      });
      // 409: it was carried over before, so there is nothing left to offer.
      if (!res.ok && res.status !== 409) throw new Error(String(res.status));
      remember('done');
      setDone(true);
    } catch {
      setError("We couldn't bring your progress over. Nothing was changed. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="carry-over" aria-labelledby="carry-over-title">
      <p id="carry-over-title" class="carry-over__title">{OFFER_TITLE}</p>
      <p class="carry-over__text">Your lessons, files and place from this browser can move into your official record. Your old statements stay here.</p>
      <div class="record__actions">
        <button type="button" class="button" onClick={bringOver} disabled={busy}>
          {OFFER_TITLE}
        </button>
        <button
          type="button"
          class="button button--quiet"
          disabled={busy}
          onClick={() => {
            remember('declined');
            setHidden(true);
          }}
        >
          {OFFER_DECLINE}
        </button>
      </div>
      <div role="status" class="record__msg">
        {error && <p class="record__msg-text record__msg-text--error">{error}</p>}
      </div>
    </section>
  );
}
