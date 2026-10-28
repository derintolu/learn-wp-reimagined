import { useState } from 'preact/hooks';
import { FEATURES } from '../config';
import { ensureSession } from '../record/session';
import { useRecord } from '../record/useRecord';
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

/** A v1 record that holds progress worth carrying: a finished lesson, a saved file or a position. */
export const hasProgress = (r: LearningRecord): boolean =>
  r.version === 1 && (r.completedLessons.length > 0 || Object.keys(r.files).length > 0 || !!r.current);

/** Offers, once, to carry the old local record's progress into the official record. Nothing is sent until the learner agrees. */
export function CarryOverOffer() {
  return FEATURES.officialRecord ? <Offer /> : null;
}

function Offer() {
  const { record } = useRecord();
  const [hidden, setHidden] = useState(remembered);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div role="status" class="carry-over">
        <p class="carry-over__text">{OFFER_DONE}</p>
      </div>
    );
  }
  if (hidden || !hasProgress(record)) return null;

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
