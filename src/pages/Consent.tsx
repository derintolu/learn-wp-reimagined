import { useEffect, useRef, useState } from 'preact/hooks';
import { usePageTitle } from '../usePageTitle';
import '../styles/consent.css';

export const EXPIRED = 'This sign-in request has expired. Start again from your agent.';
const TRY_AGAIN = 'That did not go through. Try again.';

type Ask = { clientName: string | null; redirectHost: string };
type View = { state: 'loading' } | { state: 'ended' } | { state: 'ready'; ask: Ask };

const requestId = () => new URLSearchParams(window.location.search).get('request');

/** /consent: where an agent's OAuth sign-in lands. The learner allows or cancels; no login form. */
export function Consent() {
  usePageTitle('Connect your agent');
  const [view, setView] = useState<View>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = requestId();

  useEffect(() => {
    if (!id) {
      setView({ state: 'ended' });
      return;
    }
    let live = true;
    fetch(`/api/oauth/consent?request=${encodeURIComponent(id)}`, { credentials: 'same-origin' })
      .then(async (res) => {
        const body = res.ok ? await res.json() : null;
        if (!live) return;
        setView(body && typeof body.redirectHost === 'string' ? { state: 'ready', ask: body } : { state: 'ended' });
      })
      .catch(() => live && setView({ state: 'ended' }));
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    if (view.state !== 'loading') heading.current?.focus();
  }, [view.state]);

  async function decide(decision: 'allow' | 'cancel') {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/oauth/consent', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: id, decision }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body && typeof body.redirect === 'string') {
        window.location.assign(body.redirect);
        return;
      }
      if (res.status === 400) setView({ state: 'ended' });
      else setProblem(TRY_AGAIN);
    } catch {
      setProblem(TRY_AGAIN);
    }
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

  if (view.state === 'ended') {
    return (
      <section class="band band--light consent" aria-labelledby="consent-title">
        <div class="wrap consent__wrap">
          <h1 id="consent-title" class="consent__title" tabIndex={-1} ref={heading}>
            Sign-in request
          </h1>
          <p>{EXPIRED}</p>
        </div>
      </section>
    );
  }

  const { clientName, redirectHost } = view.ask;
  return (
    <section class="band band--light consent" aria-labelledby="consent-title">
      <div class="wrap consent__wrap">
        <h1 id="consent-title" class="consent__title" tabIndex={-1} ref={heading}>
          Let {clientName || 'your agent'} continue your course as you?
        </h1>
        <p class="consent__host">It will send you back to {redirectHost}.</p>
        <p>
          It can read your progress and record steps as you take them. It can never change your record by hand. To end
          this at any time, choose "Disconnect agents" in the record menu.
        </p>
        {problem && (
          <p role="alert" class="consent__problem">
            {problem}
          </p>
        )}
        <div class="consent__actions">
          <button type="button" class="button" disabled={busy} onClick={() => decide('allow')}>
            Allow
          </button>
          <button type="button" class="button button--quiet" disabled={busy} onClick={() => decide('cancel')}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
