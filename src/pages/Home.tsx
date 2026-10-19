import { Bubble } from '../components/Bubble';
import { SketchIcon } from '../components/SketchIcon';
import { Swipe } from '../components/Swipe';
import { content } from '../content';
import type { PathId } from '../shared/types';

const PATH_ORDER: PathId[] = ['learner', 'block-theme', 'vibe-coder'];

// Placeholder home. The live placement chat and full path cards arrive in later tasks.
export function Home() {
  return (
    <>
      <section class="band band--dark hero" aria-labelledby="hero-title">
        <div class="wrap hero__grid">
          <div>
            <h1 id="hero-title" class="hero__title">
              Learn WordPress, <Swipe>your way</Swipe>.
            </h1>
            <p class="lede">
              Short paths built from real Learn WordPress lessons, with a friendly AI tutor that starts where you
              are, not at page one.
            </p>
            <div class="hero__actions">
              <a class="button" href="#paths">Find my path</a>
            </div>
          </div>
          <div class="hero__chat">
            <SketchIcon name="arrow" class="hero__doodle" />
            <div class="hero__chat-head">
              <SketchIcon name="tutor" class="hero__avatar" />
              <span>
                <strong>Your tutor</strong>, running on open models
              </span>
            </div>
            <div class="chat" aria-label="Example conversation">
              <Bubble from="tutor">Not sure where to start? Tell me what you're building.</Bubble>
              <Bubble from="learner">A portfolio for my pottery. I know a little CSS.</Bubble>
              <Bubble from="tutor">
                Lovely. The block theme path fits. Your colours and fonts will live in one theme.json file, and
                we'll skip the bits you already know.
              </Bubble>
            </div>
          </div>
        </div>
      </section>

      <section id="paths" class="band band--light" aria-labelledby="paths-title">
        <div class="wrap split">
          <h2 id="paths-title" class="split__title">
            Three ways <Swipe>in</Swipe>
          </h2>
          <div class="split__body">
            <ul class="path-list">
              {PATH_ORDER.map((id) => {
                const path = content.paths[id];
                return (
                  <li class="path-row" key={id}>
                    <SketchIcon name={id} class="path-row__icon" />
                    <h3 class="path-row__title">{path.title}</h3>
                    <p class="path-row__tagline">{path.tagline}</p>
                    {path.status !== 'live' && <span class="path-row__status">Coming soon</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
