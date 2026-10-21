import { CLIENT_SETUPS } from '../agent/clients';
import { CopyField } from '../components/CopyField';
import { ImportAgentProgress } from '../components/ImportAgentProgress';
import { Swipe } from '../components/Swipe';
import { MCP_URL } from '../shared/course-meta';
import '../components/agent.css';

/** /connect: setup for each agent, and bringing the agent's progress back. */
export function Connect() {
  return (
    <>
      <section class="band band--light connect" aria-labelledby="connect-title">
        <div class="wrap split">
          <h1 id="connect-title" class="placeholder__title">
            Connect your <Swipe>agent</Swipe>
          </h1>
          <div class="split__body lede">
            <p>
              The whole course is also a remote MCP server. Add it to the AI agent you already use and it becomes your tutor:
              your subscription does the thinking, and the course supplies the lessons, the checks and the branches.
            </p>
            <div class="connect__url">
              <CopyField label="Connector URL" value={MCP_URL} />
            </div>
            <p class="connect__note">
              No sign-in and no personal data. Your progress in the agent is kept as xAPI statements under an anonymous record
              handle that only you hold.
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
                {c.snippet && <CopyField label={`${c.name} setup`} value={c.snippet} multiline />}
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
              On any lesson, open <b>Your record</b> and choose <b>Continue in your agent</b>. You get a record handle and a
              message to paste into your agent, and it picks up at that lesson with your theme files.
            </p>
          </div>
        </div>
      </section>

      <section class="band band--light" id="import" tabIndex={-1} aria-labelledby="import-title">
        <div class="wrap split">
          <h2 id="import-title" class="split__title">Bring your agent's progress back</h2>
          <div class="split__body connect__import">
            <p>
              Paste the record handle, or the JSON your agent exported with <code>get_record</code>. You'll see what changes
              before anything is saved.
            </p>
            <ImportAgentProgress idPrefix="connect-import" />
          </div>
        </div>
      </section>
    </>
  );
}
