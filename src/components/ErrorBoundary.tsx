import { Component, type ComponentChildren } from 'preact';
import { downloadRecord } from '../record/fileTransfer';
import { peekRecordManager } from '../record/useRecord';

/**
 * The last line of defence: if any part of the app throws while rendering, show a friendly page
 * instead of a blank one, with a way to save the learner's record before anything else.
 */
export class ErrorBoundary extends Component<{ children: ComponentChildren }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(e: unknown) {
    console.error('The app hit an error', e instanceof Error ? e.message : e);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    let canDownload = false;
    try {
      canDownload = Boolean(peekRecordManager()?.record);
    } catch {
      canDownload = false;
    }
    return (
      <main id="main" tabIndex={-1} class="app-error">
        <section class="band band--light">
          <div class="wrap split">
            <h1 class="placeholder__title">Something broke on our side.</h1>
            <div class="split__body placeholder__body lede">
              <p>
                Sorry about that. Your progress is still in your browser. Save a copy of your record first, then reload the
                page to carry on.
              </p>
              <div class="app-error__actions">
                {canDownload && (
                  <button
                    type="button"
                    class="button"
                    onClick={() => {
                      const m = peekRecordManager();
                      if (m) downloadRecord(m.record);
                    }}
                  >
                    Download your record
                  </button>
                )}
                <a class="button button--quiet" href="/">
                  Back to the start
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }
}
