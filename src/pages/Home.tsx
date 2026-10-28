import { CopyField } from '../components/CopyField';
import { PathCards } from '../components/PathCards';
import { PlacementChat } from '../components/PlacementChat';
import { SketchIcon } from '../components/SketchIcon';
import { Sticker } from '../components/Sticker';
import { Swipe } from '../components/Swipe';
import { MCP_URL } from '../shared/course-meta';
import { usePageTitle } from '../usePageTitle';
import '../components/agent.css';

const AGENTS = ['Claude', 'ChatGPT', 'Claude Code', 'Cursor', 'Any MCP client'];

/** Days an agent record lives without use (functions/_lib/mcp/recordStore.ts; How this works says the same). */
const RELAY_DAYS = 30;

export function Home() {
  usePageTitle(null);
  return (
    <>
      <section class="band band--dark hero" aria-labelledby="hero-title">
        <div class="wrap hero__grid">
          <div class="hero__intro">
            <h1 id="hero-title" class="hero__title">
              Learn WordPress in the AI <Swipe>you already use</Swipe>.
            </h1>
            <p class="lede">
              Connect this course to ChatGPT, Claude or another MCP client. Your AI teaches the lessons, the course server
              checks your code, and your progress is kept as a record you can bring back here.
            </p>
            <div class="hero__actions">
              <a class="button" href="/connect">Connect your AI</a>
              <a class="hero__alt" href="#studio">Or try a lesson in your browser</a>
            </div>
          </div>
          <section class="connect-steps" aria-labelledby="steps-title">
            <h2 id="steps-title" class="connect-steps__title">Three steps to start</h2>
            <ol class="connect-steps__list">
              <li>
                <p>Copy the connector URL.</p>
                <CopyField label="Connector URL" value={MCP_URL} />
              </li>
              <li>
                <p>
                  Add it to your AI as a custom connector, with no sign-in. In Claude that's Customize, then Connectors.
                  ChatGPT needs developer mode, which depends on your plan. Claude Code takes one command.
                </p>
              </li>
              <li>
                <p>Start a new chat and ask it to teach you the course.</p>
              </li>
            </ol>
            <p class="connect-steps__more">
              <a href="/connect">Setup for Claude, ChatGPT, Claude Code and Cursor</a>
            </p>
          </section>
        </div>
      </section>

      <section class="band band--light" aria-labelledby="agent-title">
        <div class="wrap split">
          <h2 id="agent-title" class="split__title">
            Your AI becomes the <Swipe>tutor</Swipe>
          </h2>
          <div class="split__body">
            <ul class="feature-list">
              <li>
                <h3>It teaches</h3>
                <p>
                  The 18 lessons are adapted from <a href="https://learn.wordpress.org/">Learn WordPress</a> and the
                  Developer Handbooks. Your AI gets them from the course one step at a time, with the questions and the
                  planted bugs, and never sees a bug's answer before you find it.
                </p>
              </li>
              <li>
                <h3>It checks your work</h3>
                <p>
                  Code checks run on the course server, so your AI can't pass a fix that doesn't work. For written
                  answers it judges against the lesson's own rubric, and it can only send you down a branch the author
                  wrote.
                </p>
              </li>
              <li>
                <h3>It keeps your record</h3>
                <p>
                  Every step is saved as an xAPI statement, the standard format for learning records. Paste your record
                  handle on the Connect page to bring that progress back to this site.
                </p>
              </li>
            </ul>
            <p class="home-note">
              Already started here? On any lesson, open <b>Your record</b> and choose <b>Continue in your AI</b>. Your AI
              picks up at that lesson, with your files.
            </p>
            <p class="home-note">
              When you take the course into an agent, the server keeps your progress under a random record handle that only
              you hold. It stores no personal data, expires after {RELAY_DAYS} days without use, and you can delete it at any
              time from <a href="/connect#import">Connect your agent</a>.
            </p>
            <ul class="agent-list" aria-label="Set up for">
              {AGENTS.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <p class="home-note home-note--small">
              The connector runs on this site and is tested with the official MCP SDK. It hasn't been tried inside each of
              these apps yet.
            </p>
          </div>
        </div>
      </section>

      <section id="paths" class="band band--light" aria-labelledby="paths-title" tabIndex={-1}>
        <div class="wrap split">
          <div>
            <h2 id="paths-title" class="split__title">
              Three <Swipe>paths</Swipe>
            </h2>
            <p class="split__aside">
              Six lessons each. Every path has at least one moment where AI-written code is wrong on purpose, and you find
              the bug and fix it by hand.
            </p>
          </div>
          <div class="split__body split__body--wide">
            <PathCards />
          </div>
        </div>
      </section>

      <section id="studio" class="band band--dark home-studio" aria-labelledby="studio-title" tabIndex={-1}>
        <div class="wrap hero__grid">
          <div class="hero__intro">
            <h2 id="studio-title" class="split__title">
              Or learn here, in your <Swipe>browser</Swipe>
            </h2>
            <p class="lede">
              No AI account needed. The studio puts each lesson beside a code editor and a live WordPress preview that runs
              in your browser, with a tutor on open models. Tell it what you already know and it suggests where to start.
            </p>
            <p class="home-studio__fallback">
              If the tutor is slow, down or out of budget, the lessons, code checks and your progress keep working without
              it.
            </p>
          </div>
          <div class="hero__chat">
            <SketchIcon name="arrow" class="hero__doodle" />
            <PlacementChat />
          </div>
        </div>
      </section>

      <section class="band band--dark-2" aria-labelledby="next-title">
        <div class="wrap split">
          <h2 id="next-title" class="split__title">
            What's being <Swipe>built</Swipe>
          </h2>
          <div class="split__body">
            <p class="agent-soon">
              <Sticker>not live yet</Sticker>
              <span>None of this runs on the site today.</span>
            </p>
            <ul class="feature-list feature-list--dark">
              <li>
                <h3>An open standard for agent courses</h3>
                <p>
                  The course server moves to course-xapi-mcp, an open specification built on cmi5 and xAPI for courses you
                  take in your own AI. Your AI will sign in through a consent page instead of holding a record handle.
                </p>
              </li>
              <li>
                <h3>A record you can't alter</h3>
                <p>
                  The official record moves to a separate learning record store running the Learning Ledger plugin. Only
                  the course server writes to it. You'll be able to read and download it, never edit it.
                </p>
              </li>
              <li>
                <h3>Open Badges 3.0</h3>
                <p>
                  Finishing a path will earn a badge anyone can verify, issued by this prototype as an Open Badges 3.0
                  credential. It won't be an official WordPress credential.
                </p>
              </li>
              <li>
                <h3>Sensei as the back end</h3>
                <p>
                  The lessons move into Sensei LMS, the plugin Learn WordPress runs on, on this prototype's own WordPress.
                  Finishing a lesson will mark it complete there too.
                </p>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section class="band band--light" aria-labelledby="how-title">
        <div class="wrap split">
          <h2 id="how-title" class="split__title">
            An unofficial <Swipe>concept</Swipe>
          </h2>
          <div class="split__body">
            <p>
              One person made this, as a picture of where Learn WordPress could go. It isn't affiliated with WordPress.org,
              and the lessons haven't been reviewed by the Training Team. Every lesson names and links its sources.
            </p>
            <ul class="read-more">
              <li>
                <a href="/how-it-works">How this works</a>
                <span>What's real, what's concept, and what the AI costs.</span>
              </li>
              <li>
                <a href="/proposal">The proposal</a>
                <span>How Learn could adopt this, one phase at a time.</span>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
