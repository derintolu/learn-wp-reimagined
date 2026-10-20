import { useEffect } from 'preact/hooks';
import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Home } from './pages/Home';
import { Lesson } from './pages/Lesson';
import { PathOverview } from './pages/PathOverview';
import { Finale } from './pages/Finale';
import { NotFound } from './pages/routes';

/**
 * preact-iso turns same-origin links like "/#paths" into pushState, which never
 * scrolls to the hash. Do it ourselves once the routed page has rendered.
 */
function HashTarget() {
  const { url } = useLocation();
  useEffect(() => {
    // preact-iso's url drops the hash on first load, so read it from location.
    const hash = location.hash.slice(1);
    if (!hash) return;
    let target = hash;
    try {
      target = decodeURIComponent(hash);
    } catch {
      // A malformed escape like "%E0%A4%A": look the hash up as written.
    }
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(target);
      if (!el) return;
      el.scrollIntoView();
      if (el.tabIndex >= 0 || el.hasAttribute('tabindex')) el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [url]);
  return null;
}

export function App() {
  return (
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  );
}

function Shell() {
  return (
    <LocationProvider>
      <HashTarget />
      <Header />
      <main id="main" tabIndex={-1}>
        <Router>
          <Route path="/" component={Home} />
          <Route path="/path/:pathId" component={PathOverview} />
          <Route path="/learn/:lessonId" component={Lesson} />
          <Route path="/finale" component={Finale} />
          <Route default component={NotFound} />
        </Router>
      </main>
      <Footer />
    </LocationProvider>
  );
}
