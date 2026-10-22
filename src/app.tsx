import { useEffect } from 'preact/hooks';
import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Home } from './pages/Home';
import { Lesson } from './pages/Lesson';
import { PathOverview } from './pages/PathOverview';
import { Finale } from './pages/Finale';
import { Connect } from './pages/Connect';
import { NotFound } from './pages/routes';
import { content } from './content';

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
      <Frame />
    </LocationProvider>
  );
}

/** /learn/:lessonId for a lesson that exists: the studio, which brings its own course bar. */
function isStudio(path: string): boolean {
  const m = /^\/learn\/([^/]+)\/?$/.exec(path);
  if (!m) return false;
  try {
    return Object.prototype.hasOwnProperty.call(content.lessons, decodeURIComponent(m[1]));
  } catch {
    return false;
  }
}

function Frame() {
  const { path } = useLocation();
  const routes = (
    <Router>
      <Route path="/" component={Home} />
      <Route path="/path/:pathId" component={PathOverview} />
      <Route path="/learn/:lessonId" component={Lesson} />
      <Route path="/finale" component={Finale} />
      <Route path="/finale/:pathId" component={Finale} />
      <Route path="/connect" component={Connect} />
      <Route default component={NotFound} />
    </Router>
  );
  // The studio renders its own skip link: on phones it has to switch panes first.
  if (isStudio(path)) return routes;
  return (
    <>
      <Header />
      <main id="main" tabIndex={-1}>
        {routes}
      </main>
      <Footer />
    </>
  );
}
