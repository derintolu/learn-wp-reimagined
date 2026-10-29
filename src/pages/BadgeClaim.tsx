import { useEffect, useRef, useState } from 'preact/hooks';
import { fetchBadges, mintClaimUrl, type BadgeSummary } from '../badges/badges';
import { BADGES_ISSUING, BADGES_NOT_ISSUED } from '../config';
import { usePageTitle } from '../usePageTitle';
import '../styles/consent.css';

export const CLAIM_FAILED = 'We could not make a claim link. Nothing was changed. Try again in a moment.';

type View = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; badge: BadgeSummary };

const badgeId = () => new URLSearchParams(window.location.search).get('badge');

/** /badges/claim?badge=<id>: what the badge is, then a top-level hop to the LRS's claim page. */
export function BadgeClaim() {
  usePageTitle('Claim your badge');
  const [view, setView] = useState<View>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = badgeId();

  useEffect(() => {
    let live = true;
    fetchBadges().then((list) => {
      if (!live) return;
      const badge = id ? list?.find((b) => b.id === id) : undefined;
      setView(badge ? { state: 'ready', badge } : { state: 'missing' });
    });
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    if (view.state !== 'loading') heading.current?.focus();
  }, [view.state]);

  // Back from the LRS can restore this page from the back-forward cache with Claim still busy.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setBusy(false);
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  async function claim(badge: BadgeSummary) {
    setBusy(true);
    setProblem(null);
    const url = await mintClaimUrl(badge.id);
    if (url) {
      window.location.assign(url);
      return;
    }
    setProblem(CLAIM_FAILED);
    setBusy(false);
  }

  if (view.state === 'loading') {
    return (
      <section class="band band--light consent" aria-busy="true">
        <div class="wrap consent__wrap">
          <p role="status">Loading</p>
        </div>
      </section>
    );
  }

  if (view.state === 'missing') {
    return (
      <section class="band band--light consent" aria-labelledby="claim-title">
        <div class="wrap consent__wrap">
          <h1 id="claim-title" class="consent__title" tabIndex={-1} ref={heading}>
            Claim your badge
          </h1>
          {BADGES_ISSUING ? (
            <p>We couldn't find that badge on your record. Finish a path, then open your record menu to find it.</p>
          ) : (
            <p>{BADGES_NOT_ISSUED} There is no badge to claim until they are.</p>
          )}
        </div>
      </section>
    );
  }

  const { badge } = view;
  return (
    <section class="band band--light consent" aria-labelledby="claim-title">
      <div class="wrap consent__wrap">
        <h1 id="claim-title" class="consent__title" tabIndex={-1} ref={heading}>
          Claim the {badge.name} badge
        </h1>
        <p>
          Sensei's certificate is a document: it says you finished. This badge is a verifiable credential. It is an Open
          Badges 3.0 credential signed by the learning record store, so anyone you share it with can check it themselves.
        </p>
        {badge.status === 'claimed' ? (
          <p>You've already claimed this badge.</p>
        ) : (
          <>
            <p>You'll go to the learning record store to take it. The link it gives you works once, for a few minutes.</p>
            {problem && (
              <p role="alert" class="consent__problem">
                {problem}
              </p>
            )}
            <div class="consent__actions">
              <button type="button" class="button" disabled={busy} onClick={() => claim(badge)}>
                Claim on the LRS
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
