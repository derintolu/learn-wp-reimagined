import { CLIENT_SETUPS } from '../agent/clients';
import { CopyField } from '../components/CopyField';
import { Swipe } from '../components/Swipe';
import { MCP_URL } from '../shared/course-meta';
import { usePageTitle } from '../usePageTitle';
import '../components/agent.css';

/** /connect: the connector URL and the sign-in setup for each agent. */
export function Connect() {
  usePageTitle('Connect your AI');
  return (
    <>
      <section class="band band--light connect" aria-labelledby="connect-title">
        <div class="wrap split">
          <h1 id="connect-title" class="placeholder__title">
            Connect your <Swipe>AI</Swipe>
          </h1>
          <div class="split__body lede">
            <p>
              The whole course is also a remote MCP server. Add it to the AI you already use and it becomes your tutor:
              your subscription does the thinking, and the course supplies the lessons, the checks and the branches.
            </p>
            <div class="connect__url">
              <CopyField label="Connector URL" value={MCP_URL} />
            </div>
            <p class="connect__note">
              Sign in when your agent asks. It opens a sign-in page here, you approve it, and your progress in your AI
              is kept as xAPI statements in your learner record. No name or email is needed. "Disconnect agents" in
              Your record ends every sign-in.
            </p>
          </div>
        </div>
      </section>

      <section class="band band--light connect__clients" aria-labelledby="clients-title">
        <div class="wrap">
          <h2 id="clients-title" class="split__title">Set it up</h2>
          <div class="connect__grid">
            {CLIENT_SETUPS.map((c) => (
              <section class="connect__client" key={c.id} aria-labelledby={`client-${c.id}`}>
                <h3 id={`client-${c.id}`}>{c.name}</h3>
                <p class="connect__plans">{c.plans}</p>
                <ol>
                  {c.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                {c.snippet && <CopyField label={`${c.name} setup`} value={c.snippet} multiline={c.snippet.includes('\n')} />}
                <p class="connect__docs">
                  <a href={c.docsUrl} rel="noopener noreferrer" target="_blank">
                    {c.name} documentation<span class="visually-hidden"> (opens in a new tab)</span>
                  </a>
                </p>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section class="band band--light" aria-labelledby="continue-title">
        <div class="wrap split">
          <h2 id="continue-title" class="split__title">Continue where you left off</h2>
          <div class="split__body">
            <p>
              On any lesson, open <b>Your record</b> and choose <b>Continue in your AI</b>. You get the connector
              URL and a message to paste into your AI. Sign in when your agent asks, and it picks up at that lesson.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
