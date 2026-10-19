import { useEffect } from 'preact/hooks';
import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { Home } from './pages/Home';
import { FinalePage, LessonPage, NotFound, PathPage } from './pages/routes';

/**
 * preact-iso turns same-origin links like "/#paths" into pushState, which never
 * scrolls to the hash. Do it ourselves once the routed page has rendered.
 */
function HashTarget() {
  const { url } = useLocation();
  useEffect(() => {
    const hash = url.split('#')[1];
    if (!hash) return;
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(decodeURIComponent(hash));
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
    <LocationProvider>
      <HashTarget />
      <Header />
      <main id="main" tabIndex={-1}>
        <Router>
          <Route path="/" component={Home} />
          <Route path="/path/:pathId" component={PathPage} />
          <Route path="/learn/:lessonId" component={LessonPage} />
          <Route path="/finale" component={FinalePage} />
          <Route default component={NotFound} />
        </Router>
      </main>
      <Footer />
    </LocationProvider>
  );
}
