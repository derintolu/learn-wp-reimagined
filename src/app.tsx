import { LocationProvider, Route, Router } from 'preact-iso';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { Home } from './pages/Home';
import { FinalePage, LessonPage, NotFound, PathPage } from './pages/routes';

export function App() {
  return (
    <LocationProvider>
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
