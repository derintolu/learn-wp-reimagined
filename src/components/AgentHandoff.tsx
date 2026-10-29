import { MCP_URL, agentPrompt } from '../shared/course-meta';
import { CopyField } from './CopyField';
import './agent.css';

/** "Continue in your agent": the agent signs the learner in itself, so the hand-off is the URL and a prompt naming the lesson. */
export function AgentHandoff({ lessonTitle }: { lessonTitle: string }) {
  return (
    <div class="agent-handoff">
      <p class="record__confirm-q">Continue “{lessonTitle}” in your AI</p>
      <ol class="agent-handoff__steps">
        <li>
          <CopyField label="Connector URL" value={MCP_URL} />
        </li>
        <li>
          <CopyField label="Message for your AI" value={agentPrompt(lessonTitle)} multiline />
          <p class="agent-handoff__note">Sign in when your agent asks.</p>
        </li>
      </ol>
      <p class="agent-handoff__link">
        <a href="/connect">Set up your AI</a>
      </p>
    </div>
  );
}
