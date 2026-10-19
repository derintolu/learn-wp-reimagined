import { FEATURES } from '../config';
import { PathCards } from '../components/PathCards';
import { PlacementChat } from '../components/PlacementChat';
import { SketchIcon } from '../components/SketchIcon';
import { Sticker } from '../components/Sticker';
import { Swipe } from '../components/Swipe';

const AGENTS = ['Claude', 'ChatGPT', 'Claude Code', 'Cursor', 'Any MCP client'];

export function Home() {
  return (
    <>
      <section class="band band--dark hero" aria-labelledby="hero-title">
        <div class="wrap hero__grid">
          <div class="hero__intro">
            <h1 id="hero-title" class="hero__title">
              Learn WordPress, <Swipe>your way</Swipe>.
            </h1>
            <p class="lede">
              Short paths built from real Learn WordPress lessons, with a friendly AI tutor that starts where you
              are, not at page one.
            </p>
            <div class="hero__actions">
              <a class="button button--quiet" href="#paths">See all three paths</a>
            </div>
          </div>
          <div class="hero__chat">
            <SketchIcon name="arrow" class="hero__doodle" />
            <PlacementChat />
          </div>
        </div>
      </section>

      <section id="paths" class="band band--light" aria-labelledby="paths-title" tabIndex={-1}>
        <div class="wrap split">
          <h2 id="paths-title" class="split__title">
            Three ways <Swipe>in</Swipe>
          </h2>
          <div class="split__body split__body--wide">
            <PathCards />
          </div>
        </div>
      </section>

      <section class="band band--dark-2" aria-labelledby="agent-title">
        <div class="wrap split">
          <h2 id="agent-title" class="split__title">
            Continue in the agent <Swipe>you already use</Swipe>
          </h2>
          <div class="split__body">
            <p class="lede">
              The whole course is also a remote MCP server. Connect it to the AI agent you already pay for and it
              becomes your tutor, with the same lessons, checkpoints and planted bugs.
            </p>
            <ul class="agent-list" aria-label="Works with">
              {AGENTS.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            {FEATURES.agent ? (
              <a class="button" href="/connect">Connect your agent</a>
            ) : (
              <p class="agent-soon">
                <Sticker>coming soon</Sticker>
                <span>The connector is being built. The site works on its own in the meantime.</span>
              </p>
            )}
          </div>
        </div>
      </section>

      <section class="band band--light" aria-labelledby="how-title">
        <div class="wrap split">
          <h2 id="how-title" class="split__title">
            How this <Swipe>works</Swipe>
          </h2>
          <div class="split__body">
            <ol class="how-list">
              <li>
                <h3>Real Learn lessons</h3>
                <p>
                  Every lesson is adapted from <a href="https://learn.wordpress.org/">Learn WordPress</a> or the
                  Developer Handbooks, and names and links its sources.
                </p>
              </li>
              <li>
                <h3>Live open-model AI</h3>
                <p>
                  The tutor runs on open models. If it's slow, down or out of budget, the lessons, checks and your
                  progress all keep working without it.
                </p>
              </li>
              <li>
                <h3>Coding still matters</h3>
                <p>
                  Each path has a moment where the AI's code is wrong on purpose. You read it, find the bug and fix
                  it by hand before you move on.
                </p>
              </li>
            </ol>
          </div>
        </div>
      </section>
    </>
  );
}
